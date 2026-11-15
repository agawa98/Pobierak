const express = require("express");
const path = require("path");
const fs = require("fs");

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";       // domyslnie program jest dostepny tylko z tego komputera; HOST=0.0.0.0 otwiera go na siec domowa


// tu deklarujemy dozwolone wartosci zmiennych w formularzu, uzywane w walidacji
const allowedTypes = ["audio", "video", "separate"];
const allowedAudioFormats = ["mp3", "wav", "m4a", "flac"];
const allowedVideoFormats = ["mp4", "mpeg", "mjpeg", "mkv"];
const allowedBitrates = ["16", "32", "64", "128", "256", "320", "best"];
const allowedResolutions = ["144", "360", "480", "720", "1080", "1440", "2160", "best"];
// rozdzielczosci powyzej 1080p YouTube daje tylko w VP9/AV1, ktorych nie da sie zapisac w mp4 z H.264 - stad tylko mkv
const mkvOnlyResolutions = ["1440", "2160"];
const allowedSampleRates = ["8000", "11025", "12000", "16000", "22050", "24000", "32000", "44100", "48000", "default"];
const allowedChannels = ["mono", "stereo"];

//ustawiamy sciezki do programow

// szuka programu po kolei: zmienna srodowiskowa -> folder bin obok app.js -> sama nazwa (PATH)
// zwraca sciezke (command) i informacje czy program pochodzi z PATH (fromPath)
function resolveBinary(envName, baseName, options = {}) {
    const env = options.env || process.env;
    const binDir = options.binDir || path.join(__dirname, "bin");
    const platform = options.platform || process.platform;

    const envValue = (env[envName] || "").trim();

    if (envValue !== "") {
        return { command: envValue, fromPath: false };
    }

    const fileName = platform === "win32" ? `${baseName}.exe` : baseName;      // jedyne rozgalezienie po systemie: koncowka .exe
    const binPath = path.join(binDir, fileName);

    if (fs.existsSync(binPath)) {
        return { command: binPath, fromPath: false };
    }

    return { command: baseName, fromPath: true };
}

// filtr yt-dlp odrzucajacy trwajace i zaplanowane transmisje
const liveFilter = "!is_live & !is_upcoming";

// komunikat, gdy yt-dlp pominal film przez liveFilter
const liveStreamMessage = "To trwająca albo zaplanowana transmisja. Pobrać można dopiero zapis po jej zakończeniu.";

// linia, ktora yt-dlp wypisuje na stdout (z kodem wyjscia 0), gdy film nie przejdzie --match-filter. sprawdzone na yt-dlp 2026.10.26:
// [download] <tytul> does not pass filter (!is_live & !is_upcoming), skipping ..
function isFilterSkipLine(line) {
    return /^\[download\] .* does not pass filter \(.*\), skipping/.test(String(line).trim());
}

// blad rzucany przez funkcje pobierajace, gdy yt-dlp pominal film przez filtr transmisji
function liveStreamError() {
    return { message: liveStreamMessage, error: "" };
}

// wspolne argumenty kazdego wywolania yt-dlp. gdy ffmpeg jest z PATH, yt-dlp znajdzie go sam
function buildYtDlpBaseArgs(ffmpeg) {
    const baseArgs = [];

    if (!ffmpeg.fromPath) {
        baseArgs.push("--ffmpeg-location", ffmpeg.command);
    }

    baseArgs.push("--no-playlist");      // link z &list= pobiera tylko jeden film, a nie cala playliste
    baseArgs.push("--no-mtime");         // plik dostaje date pobrania, a nie date wrzucenia filmu (inaczej sprzatanie usuwa go od razu)
    baseArgs.push("--newline");          // kazda aktualizacja postepu w osobnej linii (bez tego yt-dlp nadpisuje jedna linie znakiem \r)
    baseArgs.push("--match-filter", liveFilter);   // trwajacej ani zaplanowanej transmisji nie pobieramy (yt-dlp ja pomija)
    baseArgs.push("--playlist-items", "1");        // gdyby link z innego serwisu okazal sie lista, pobiera sie tylko pierwsza pozycja

    return baseArgs;
}

const ytDlpBinary = resolveBinary("YTDLP_PATH", "yt-dlp");
const ffmpegBinary = resolveBinary("FFMPEG_PATH", "ffmpeg");

const ytDlpPath = ytDlpBinary.command;
const ffmpegPath = ffmpegBinary.command;

const ytDlpBaseArgs = buildYtDlpBaseArgs(ffmpegBinary);

//

const downloadsDir = path.join(__dirname, "downloads");


// ustawienia auto czyszczenia plików
const fileMaxAgeMinutes = 30;
const cleanupIntervalMinutes = 10;

//jesli nie ma folderu pobierania, stworz go
//recursive: brak bledu, gdy folder juz jest (np. kilka procesow startuje naraz - testy na swiezej kopii)
fs.mkdirSync(downloadsDir, { recursive: true });

app.use(express.static(path.join(__dirname, "public")));



const logClients = [];

//funkcja przsyłająca logi z ffmpega i ytdlp do frontendu aby wyswietlic je na tle
function sendLogToClients(type, message) {
    // JSON.stringify sam zapisuje znaki konca linii jako \n i \r w tekscie, wiec wiadomosc zawsze miesci sie w jednej linii "data:"
    const payload = JSON.stringify({ type, message: String(message) });

    logClients.forEach((client) => {
        client.write(`data: ${payload}\n\n`);
    });
}

//endpoint dla logów
app.get("/api/logs", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write(`data: ${JSON.stringify({ type: "system", message: "Połączono z logami backendu." })}\n\n`);

    // UL-4: ostrzezenie o starym yt-dlp zaraz po powitaniu (ustala je reportPrograms przy starcie)
    if (ytDlpWarning) {
        res.write(`data: ${JSON.stringify({ type: "warning", message: ytDlpWarning })}\n\n`);
    }

    logClients.push(res);

    req.on("close", () => {
        const index = logClients.indexOf(res);

        if (index !== -1) {
            logClients.splice(index, 1);
        }
    });
});


//funckja wywolywana w razie bledu
function badRequest(res, message) {
    return res.status(400).json({
        success: false,
        message
    });
}

// --- tylko ten sam komputer ---

// czy adres nadawcy to petla zwrotna (127.0.0.0/8, ::1, takze zapis IPv4 w IPv6: ::ffff:127.x.x.x)
function isLoopbackAddress(address) {
    if (typeof address !== "string" || address === "") {
        return false;
    }

    let ip = address.toLowerCase();

    if (ip.startsWith("::ffff:")) {
        ip = ip.slice("::ffff:".length);
    }

    if (ip === "::1" || ip === "0:0:0:0:0:0:0:1") {
        return true;
    }

    return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

// przepuszcza tylko zadania z tego samego komputera. patrzy na adres gniazda (nie na naglowki, ktore da sie podrobic),
// wiec dziala tez przy recznie ustawionym HOST=0.0.0.0. inne adresy dostaja 403
function onlyLocalRequests(req, res, next) {
    const address = req.socket && req.socket.remoteAddress;

    if (isLoopbackAddress(address)) {
        return next();
    }

    return res.status(403).json({
        success: false,
        message: "Ten adres działa tylko z komputera, na którym uruchomiono Pobieraka."
    });
}

// --- okno wyboru folderu ---

const folderPickerTitle = "Wybierz folder docelowy";

// skrypt PowerShell: okno FolderBrowserDialog z niewidocznym wlascicielem TopMost, zeby okno nie schowalo sie pod przegladarka.
// sciezka idzie na wyjscie w UTF-8 (polskie litery); zamkniecie okna bez wyboru = puste wyjscie i kod 0
function buildWindowsFolderPickerScript() {
    return [
        "$ErrorActionPreference = 'Stop'",
        "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
        "Add-Type -AssemblyName System.Windows.Forms",
        "$owner = New-Object System.Windows.Forms.Form",
        "$owner.TopMost = $true",
        "$owner.ShowInTaskbar = $false",
        "$owner.FormBorderStyle = 'None'",
        "$owner.StartPosition = 'CenterScreen'",
        "$owner.Size = New-Object System.Drawing.Size(1, 1)",
        "$owner.Opacity = 0",
        "$owner.Show()",
        "$owner.Activate()",
        "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
        `$dialog.Description = '${folderPickerTitle}'`,
        "$dialog.ShowNewFolderButton = $true",
        "$result = $dialog.ShowDialog($owner)",
        "$owner.Close()",
        "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }"
    ].join("\n");
}

// polecenia, ktorymi da sie otworzyc okno wyboru folderu na danym systemie, w kolejnosci prob.
// pusta lista = na tym systemie nie ma czym otworzyc okna
function buildFolderPickerCommands(platform = process.platform, env = process.env) {
    if (platform === "win32") {
        // -EncodedCommand (UTF-16LE w base64): skrypt bez klopotow z cudzyslowami i polskimi literami w wierszu polecen
        const encoded = Buffer.from(buildWindowsFolderPickerScript(), "utf16le").toString("base64");

        return [{
            command: "powershell.exe",
            args: ["-NoProfile", "-NonInteractive", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded]
        }];
    }

    if (platform === "darwin") {
        return [{
            command: "osascript",
            args: ["-e", `POSIX path of (choose folder with prompt "${folderPickerTitle}")`]
        }];
    }

    // Linux i inne: okno wymaga dzialajacego ekranu (X11 albo Wayland)
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
        return [];
    }

    return [
        { command: "zenity", args: ["--file-selection", "--directory", `--title=${folderPickerTitle}`] },
        { command: "kdialog", args: ["--getexistingdirectory", env.HOME || "/", "--title", folderPickerTitle] }
    ];
}

const folderPickerUnavailableMessage = "Nie udało się otworzyć okna wyboru folderu. Wklej ścieżkę folderu ręcznie.";

// zamienia wynik procesu okna ({ code, stdout, stderr, error }) na jedna z trzech odpowiedzi:
// { result: "selected", folder }, { result: "cancelled" } albo { result: "unavailable", message }
function interpretFolderPickerResult(platform, processResult) {
    const { code, stdout = "", stderr = "", error } = processResult;
    const unavailable = { result: "unavailable", message: folderPickerUnavailableMessage };

    if (error) {
        return unavailable;
    }

    let folder = String(stdout).replace(/[\r\n]+$/, "");

    if (code === 0 && folder === "") {
        return { result: "cancelled" };
    }

    if (code === 0) {
        // osascript i zenity koncza sciezke ukosnikiem; zostawiamy go tylko dla samego korzenia dysku albo "/"
        const pathTools = platform === "win32" ? path.win32 : path.posix;
        const root = pathTools.parse(folder).root;

        if (folder.length > root.length) {
            folder = folder.replace(/[\\/]+$/, "");
        }

        if (!pathTools.isAbsolute(folder)) {
            return unavailable;
        }

        return { result: "selected", folder };
    }

    // macOS: zamkniecie okna to kod 1 i blad -128 ("User canceled")
    if (platform === "darwin") {
        return code === 1 && /-128/.test(String(stderr)) ? { result: "cancelled" } : unavailable;
    }

    // zenity i kdialog: kod 1 = zamkniecie okna bez wyboru. Windows: kazdy kod inny niz 0 to blad skryptu
    if (platform !== "win32" && code === 1) {
        return { result: "cancelled" };
    }

    return unavailable;
}

// uruchamia jedno polecenie okna i zbiera jego wyjscie. nie odrzuca obietnicy: bledy startu wracaja w polu error
function runFolderPickerCommand(spawnImpl, command, args) {
    return new Promise((resolve) => {
        let child;

        try {
            child = spawnImpl(command, args, { windowsHide: true });
        } catch (error) {
            resolve({ error });
            return;
        }

        let stdout = "";
        let stderr = "";
        let finished = false;

        const finish = (result) => {
            if (!finished) {
                finished = true;
                resolve(result);
            }
        };

        if (child.stdout) {
            child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
        }

        if (child.stderr) {
            child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
        }

        child.on("error", (error) => finish({ error }));
        child.on("close", (code) => finish({ code, stdout, stderr }));
    });
}

// otwiera okno wyboru folderu. options sluzy testom (system, zmienne srodowiskowe, atrapa spawn).
// gdy programu nie ma (ENOENT), probuje nastepnego z listy (Linux: zenity, potem kdialog)
async function pickFolder(options = {}) {
    const platform = options.platform || process.platform;
    const env = options.env || process.env;
    const spawnImpl = options.spawnImpl || spawn;

    for (const { command, args } of buildFolderPickerCommands(platform, env)) {
        const processResult = await runFolderPickerCommand(spawnImpl, command, args);

        if (processResult.error && processResult.error.code === "ENOENT") {
            continue;
        }

        return interpretFolderPickerResult(platform, processResult);
    }

    return { result: "unavailable", message: folderPickerUnavailableMessage };
}

// ustawienia pickFolder dla adresu /api/folder/wybierz. puste = prawdziwy system; testy podstawiaja tu atrape spawn
const folderPickerOptions = {};

// wszystkie adresy /api/folder/... tylko z tego samego komputera
app.use("/api/folder", onlyLocalRequests);

// otwiera systemowe okno wyboru folderu. odpowiedz (zawsze 200): result "selected" z polem folder,
// "cancelled" (okno zamkniete bez wyboru) albo "unavailable" z message (strona pokaze pole do recznego wpisania)
app.post("/api/folder/wybierz", async (req, res) => {
    const outcome = await pickFolder(folderPickerOptions);

    res.json({ success: outcome.result === "selected", ...outcome });
});

// --- pokaz w folderze (zadanie UL-2d) ---

// pelne sciezki plikow, ktore serwer sam zapisal w folderach docelowych od ostatniego startu.
// /api/folder/pokaz otwiera tylko pliki z tej listy - zadna inna sciezka z zadania nie trafi do Eksploratora
const savedFiles = new Set();

// zapamietuje pliki z udanego pobrania (lista { name, path } z odpowiedzi /api/download)
function rememberSavedFiles(files) {
    for (const file of files) {
        if (file && typeof file.path === "string") {
            savedFiles.add(path.resolve(file.path));
        }
    }
}

// czy serwer zapisal ten plik w tym uruchomieniu
function isSavedFile(filePath) {
    return typeof filePath === "string" && filePath !== "" && path.isAbsolute(filePath) && savedFiles.has(path.resolve(filePath));
}

// polecenie, ktore otwiera folder z pobranym plikiem. Windows i macOS zaznaczaja plik, Linux otwiera sam folder.
// Windows: explorer czyta /select,"<plik>" po swojemu, wiec argument idzie dokladnie w tej postaci (windowsVerbatimArguments).
// cudzyslowu nie ma w nazwach plikow na Windowsie, wiec sciezka nie moze z niego wyjsc
function buildShowInFolderCommand(filePath, platform = process.platform) {
    if (platform === "win32") {
        return { command: "explorer.exe", args: [`/select,"${filePath}"`], options: { windowsVerbatimArguments: true } };
    }

    if (platform === "darwin") {
        return { command: "open", args: ["-R", filePath], options: {} };
    }

    return { command: "xdg-open", args: [path.posix.dirname(filePath)], options: {} };
}

// uruchamia polecenie z buildShowInFolderCommand i nie czeka na jego koniec (Eksplorator zyje dalej sam).
// zwraca { ok: true } po starcie procesu albo { ok: false, error }, gdy programu nie da sie uruchomic.
// kodu wyjscia nie sprawdzamy: explorer.exe konczy sie kodem 1 takze wtedy, gdy okno sie otworzylo.
// options sluzy testom (system, atrapa spawn)
function showInFolder(filePath, options = {}) {
    const platform = options.platform || process.platform;
    const spawnImpl = options.spawnImpl || spawn;
    const { command, args, options: extra } = buildShowInFolderCommand(filePath, platform);

    return new Promise((resolve) => {
        let child;

        try {
            // windowsHide: false - inaczej Windows moglby otworzyc okno Eksploratora ukryte
            child = spawnImpl(command, args, { detached: true, stdio: "ignore", windowsHide: false, ...extra });
        } catch (error) {
            resolve({ ok: false, error });
            return;
        }

        child.once("spawn", () => {
            if (typeof child.unref === "function") {
                child.unref();
            }

            resolve({ ok: true });
        });

        child.once("error", (error) => resolve({ ok: false, error }));
    });
}

// ustawienia showInFolder dla adresu /api/folder/pokaz. puste = prawdziwy system; testy podstawiaja tu atrape spawn
const showInFolderOptions = {};

// otwiera folder z plikiem pobranym w tym uruchomieniu. cialo: { path: "<pelna sciezka pliku z odpowiedzi /api/download>" }.
// 400 - brak sciezki, 403 - plik spoza listy zapisanych, 404 - pliku juz nie ma, 500 - nie da sie uruchomic Eksploratora
app.post("/api/folder/pokaz", async (req, res) => {
    const filePath = req.body && req.body.path;

    if (typeof filePath !== "string" || filePath.trim() === "") {
        return badRequest(res, "Brak ścieżki pliku do pokazania.");
    }

    if (!isSavedFile(filePath)) {
        return res.status(403).json({
            success: false,
            message: "Pobierak pokazuje w folderze tylko pliki, które sam zapisał od ostatniego uruchomienia."
        });
    }

    const resolved = path.resolve(filePath);

    if (!fs.existsSync(resolved)) {
        return res.status(404).json({ success: false, message: `Plik już nie istnieje: ${resolved}` });
    }

    const outcome = await showInFolder(resolved, showInFolderOptions);

    if (!outcome.ok) {
        console.error(outcome.error);

        return res.status(500).json({ success: false, message: "Nie udało się otworzyć folderu z plikiem." });
    }

    return res.json({ success: true });
});

// zadania w toku: jobId -> obiekt zadania. endpoint /api/download dodaje wpis na starcie i usuwa go w finally.
// obiekt zadania (a nie samo jobId), zeby mozna bylo przy nim trzymac np. aktualny proces i znacznik anulowania
const activeJobs = new Map();

// czy plik nalezy do zadania w toku: nazwy plikow zadania zawieraja "[<jobId>]" (takze pliki .part i tmp- z ffmpeg)
function isActiveJobFile(fileName, jobs = activeJobs) {
    for (const jobId of jobs.keys()) {
        if (fileName.includes(`[${jobId}]`)) {
            return true;
        }
    }

    return false;
}

// blad rzucany przez runProcess, gdy zadanie zostalo anulowane. endpoint nie wysyla po nim odpowiedzi
function cancelledError() {
    return { cancelled: true, message: "Zadanie anulowane.", error: "" };
}

// rzuca blad anulowania, jesli zadanie zostalo anulowane (sprawdzane przed wyslaniem odpowiedzi)
function throwIfCancelled(job) {
    if (job && job.cancelled) {
        throw cancelledError();
    }
}

// opcje spawn dla yt-dlp i ffmpeg. poza Windowsem proces startuje jako lider wlasnej grupy,
// zeby anulowanie moglo wyslac sygnal calej grupie (yt-dlp sam uruchamia ffmpeg)
function buildSpawnOptions(platform = process.platform) {
    if (platform === "win32") {
        return {};
    }

    return { detached: true };
}

// ile czekamy miedzy SIGTERM a SIGKILL (macOS i Linux)
const killGraceMs = 2000;

// zabija proces razem z procesami, ktore sam uruchomil.
// Windows: taskkill /T /F (cale drzewo - samo child.kill() zostawiloby ffmpeg uruchomiony przez yt-dlp).
// macOS i Linux: SIGTERM do grupy procesu, a po chwili SIGKILL, jesli cos jeszcze zyje.
// options sluzy tylko testom (inny system, atrapy spawn i process.kill)
function killProcessTree(child, options = {}) {
    const platform = options.platform || process.platform;
    const spawnImpl = options.spawnImpl || spawn;
    const killImpl = options.killImpl || ((pid, signal) => process.kill(pid, signal));
    const graceMs = options.graceMs === undefined ? killGraceMs : options.graceMs;
    const pid = child ? child.pid : undefined;

    if (!pid) {      // proces nie wystartowal (np. brak programu)
        return;
    }

    if (platform === "win32") {
        // gdyby nie dalo sie uruchomic taskkill, zabijamy chociaz sam proces
        const killChildOnly = () => {
            try {
                child.kill();
            } catch (error) {
                console.log("Nie udało się zabić procesu:", error.message);
            }
        };

        try {
            const killer = spawnImpl("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });

            killer.on("error", killChildOnly);
        } catch {
            killChildOnly();
        }

        return;
    }

    // ujemny pid = cala grupa procesow. blad oznacza, ze grupy juz nie ma
    const sendToGroup = (signal) => {
        try {
            killImpl(-pid, signal);
            return true;
        } catch {
            return false;
        }
    };

    if (!sendToGroup("SIGTERM")) {
        return;
    }

    setTimeout(() => {
        if (sendToGroup(0)) {       // sygnal 0 niczego nie wysyla, tylko sprawdza, czy w grupie cos jeszcze zyje
            sendToGroup("SIGKILL");
        }
    }, graceMs).unref();
}

// anuluje zadanie: ustawia znacznik (kolejny program juz nie wystartuje) i zabija aktualnie dzialajacy proces.
// pliki zadania usuwa endpoint, gdy proces sie zakonczy
function cancelJob(job) {
    if (job.cancelled) {
        return;
    }

    job.cancelled = true;
    console.log(`Zadanie ${job.jobId} anulowane — strona zamknęła połączenie.`);

    if (job.process) {
        killProcessTree(job.process);
    }
}

// ile razy i co ile milisekund ponawiamy usuwanie plikow anulowanego zadania (na Windowsie plik bywa chwile zablokowany)
const removeJobFilesAttempts = 5;
const removeJobFilesDelayMs = 400;

// usuwa z folderu wszystkie pliki z "[<jobId>]" w nazwie (.part, oryginaly, tmp-, gotowe wyniki).
// zwraca nazwy plikow, ktorych nie udalo sie usunac - te zabierze zwykle sprzatanie po 30 minutach.
// folder i options podaja tylko testy
async function removeJobFiles(jobId, dir = downloadsDir, options = {}) {
    const attempts = options.attempts || removeJobFilesAttempts;
    const delayMs = options.delayMs === undefined ? removeJobFilesDelayMs : options.delayMs;

    let leftFiles = [];

    for (let attempt = 1; attempt <= attempts; attempt++) {
        let files;

        try {
            files = fs.readdirSync(dir);
        } catch (error) {
            console.log("Nie udalo sie odczytac folderu pobierania:", error.message);
            return [];
        }

        leftFiles = [];

        for (const fileName of files) {
            if (!fileName.includes(`[${jobId}]`)) {
                continue;
            }

            try {
                fs.unlinkSync(path.join(dir, fileName));
            } catch (error) {
                if (error.code !== "ENOENT") {
                    leftFiles.push(fileName);
                }
            }
        }

        if (leftFiles.length === 0) {
            return [];
        }

        if (attempt < attempts) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    console.log(`Nie udalo sie usunac plikow anulowanego zadania ${jobId} (usunie je zwykle sprzatanie):`, leftFiles.join(", "));

    return leftFiles;
}

//funkcja usuwajaca stare pliki z folderu downloads. pliki zadan w toku zostaja, nawet gdy sa starsze niz limit
// folder i zbior zadan mozna podac tylko po to, zeby testy sprzataly folder tymczasowy; program zawsze sprzata downloads
function cleanupOldDownloads(dir = downloadsDir, jobs = activeJobs) {
    const maxAgeMs = fileMaxAgeMinutes * 60 * 1000;
    const now = Date.now();

    let files;

    try {
        files = fs.readdirSync(dir);
    } catch (error) {
        console.log("Nie udalo sie odczytac folderu pobierania:", error.message);
        return;
    }

    files.forEach((fileName) => {
        // caly krok dla jednego pliku jest w try: yt-dlp w kazdej chwili moze zmienic nazwe pliku albo go usunac
        try {
            if (isActiveJobFile(fileName, jobs)) {
                return;
            }

            const filePath = path.join(dir, fileName);
            const fileStats = fs.statSync(filePath);

            if (!fileStats.isFile()) {
                return;
            }

            const fileAgeMs = now - fileStats.mtimeMs;

            if (fileAgeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
                console.log("Usunieto stary plik:", fileName);
            }
        } catch (error) {
            if (error.code === "ENOENT") {
                console.log("Pominieto plik, ktory zniknal w trakcie sprzatania:", fileName);
            } else {
                console.log("Nie udalo sie usunac starego pliku:", fileName, error.message);
            }
        }
    });
}


//funkcja parsujaca czas wpisywany w "przytnij", z formatu GG:MM:SS do sekund
function parseTimeToSeconds(value) {
    const trimmedValue = value.trim();

    if (trimmedValue === "") {
        return null;
    }

    // tylko cyfry i najwyzej dwa dwukropki (SS, MM:SS, GG:MM:SS). odpada np. 1::2, 0x10, 1e3, -5, 1.5
    // to samo sprawdzenie jest w public/script.js - obie funkcje maja dawac identyczne wyniki
    if (!/^\d+(:\d+){0,2}$/.test(trimmedValue)) {
        return NaN;
    }

    const parts = trimmedValue.split(":").map(Number);

    if (parts.some(Number.isNaN)) {
        return NaN;
    }

    if (parts.some(part => part < 0)) {
        return NaN;
    }

    if (parts.length === 1) {
        return parts[0];
    }

    if (parts.length === 2) {
        if (parts[1] > 59) {
            return NaN;
        }

        return parts[0] * 60 + parts[1];
    }

    if (parts.length === 3) {
        if (parts[1] > 59 || parts[2] > 59) {
            return NaN;
        }

        return parts[0] * 3600 + parts[1] * 60 + parts[2];
    }

    return NaN;
}

// ile znakow konca stderr trzymamy w pamieci. przyczyna bledu jest zawsze na koncu, a caly stderr dlugiego pobierania to megabajty
const stderrTailLimit = 8000;

// wyciaga z koncowki stderr konkretna przyczyne bledu i sklada komunikat "<etykieta>: <przyczyna>"
// yt-dlp: ostatnia linia zaczynajaca sie od "ERROR:" (bez samego slowa ERROR:). ffmpeg: ostatnia niepusta linia
function buildProcessErrorMessage(label, stderrTail, code) {
    const lines = String(stderrTail || "")
        .split(/\r\n|\n|\r/)
        .map(line => line.trim())
        .filter(line => line !== "");

    const errorLines = lines.filter(line => line.startsWith("ERROR:"));

    let reason = "";

    if (errorLines.length > 0) {
        reason = errorLines[errorLines.length - 1].slice("ERROR:".length).trim();
    }

    // brak linii ERROR: (ffmpeg) albo sama linia "ERROR:" bez tresci
    if (reason === "" && lines.length > 0) {
        reason = lines[lines.length - 1];
    }

    if (reason === "") {
        reason = `program zakończył pracę błędem (kod ${code}).`;
    }

    return `${label}: ${reason}`;
}

// komunikat gdy programu w ogole nie da sie uruchomic, bo nie ma takiego pliku (blad ENOENT)
function buildMissingProgramMessage(label, command) {
    return `${label}: nie znaleziono programu "${command}". Zainstaluj go albo wrzuć do folderu bin (patrz README).`;
}

// ta funkcja uruchamia komendy w ffmpeg albo ytdlp. command - sciezka do programu, args - argumenty, label - jak ma widniec w logach
// job - obiekt zadania z activeJobs (moze go nie byc): zadanie pamieta swoj dzialajacy proces, a anulowane nie uruchamia nastepnego
function runProcess(command, args, label, job = null) {
    return new Promise((resolve, reject) => {       // resolve sie odpala gdy sukces, reject gdy etrror
        if (job && job.cancelled) {
            reject(cancelledError());
            return;
        }

        console.log(`${label} ARGS:`, args);

        const childProcess = spawn(command, args, buildSpawnOptions());

        if (job) {
            job.process = childProcess;
        }

        // proces sie skonczyl: zadanie juz go nie pamieta. zwraca true, gdy zadanie zostalo w miedzyczasie anulowane
        const finishForJob = () => {
            if (!job) {
                return false;
            }

            if (job.process === childProcess) {
                job.process = null;
            }

            return job.cancelled === true;
        };

        let errorOutput = "";       // tylko koncowka stderr (stderrTailLimit znakow)
        let stdoutPartialLine = "";  // niedokonczona ostatnia linia stdout (linia moze przyjsc w kilku kawalkach)
        let skippedByFilter = false; // yt-dlp wypisal, ze film nie przeszedl --match-filter (stdout nie jest zbierany, tylko sprawdzany)

        childProcess.stdout.on("data", (data) => {
            const text = data.toString();
            const lines = (stdoutPartialLine + text).split(/\r\n|\n|\r/);

            stdoutPartialLine = lines.pop().slice(-stderrTailLimit);

            if (lines.some(isFilterSkipLine)) {
                skippedByFilter = true;
            }

            console.log(text);
            sendLogToClients(label, text);
        });

        childProcess.stderr.on("data", (data) => {
            const text = data.toString();

            errorOutput = (errorOutput + text).slice(-stderrTailLimit);
            console.error(text);
            sendLogToClients(label, text);
        });
        childProcess.on("error", (error) => {
            if (finishForJob()) {
                reject(cancelledError());
                return;
            }

            if (error.code === "ENOENT") {
                reject({
                    message: buildMissingProgramMessage(label, command),
                    error: error.message
                });
                return;
            }

            reject({
                message: `Nie udało się uruchomić ${label}.`,
                error: error.message
            });
        });

        childProcess.on("close", (code) => {
            console.log(`${label} CLOSE CODE:`, code);

            if (finishForJob()) {
                reject(cancelledError());
                return;
            }

            if (code !== 0) {
                reject({
                    message: buildProcessErrorMessage(label, errorOutput, code),
                    error: errorOutput,
                    label,              // UL-4: po bledzie yt-dlp serwer przypomina o aktualizacji (isYtDlpExitError)
                    exitCode: code
                });
                return;
            }

            if (isFilterSkipLine(stdoutPartialLine)) {     // ostatnia linia bez znaku konca linii
                skippedByFilter = true;
            }

            const result = { errorOutput };

            if (skippedByFilter) {     // pole tylko przy pominieciu, zwykly wynik wyglada jak dotad
                result.skippedByFilter = true;
            }

            resolve(result);
        });
    });
}

//generowanie randomowego ID do nazwy filmu
function getJobId() {
    return randomUUID().slice(0, 8);
}

//funkcja zwracająca bitrate
function getAudioQuality(bitrate) {
    if (bitrate === "best") {
        return "0";
    }

    return `${bitrate}K`;
}

// funkcja budujaca argumenty jakosci audio dla ffmpega. jakosc ustawiamy zawsze jawnie,
// bo bez tego ffmpeg bierze swoja domyslna (ok. 128 kb/s) i efekty po cichu psuja jakosc
function buildAudioQualityArgs(format, bitrate) {
    if (format === "mp3") {
        if (bitrate === "best") {
            return ["-q:a", "0"];       // najwyzsza jakosc VBR
        }

        return ["-b:a", getAudioQuality(bitrate)];
    }

    if (format === "m4a") {
        if (bitrate === "best") {
            return ["-b:a", "256k"];
        }

        return ["-b:a", getAudioQuality(bitrate)];
    }

    return [];      // wav i flac sa bezstratne, nic nie ustawiamy
}

//funkcja szukajaca pliku w folderze z pobranymi plikami, aby go wyslac nastepnie do frontendu
function findGeneratedFile(jobId, extraText = "") {
    // szuka dokladnej koncowki nazwy: "<etykieta> [<jobId>]." (pobieranie oddzielne) albo "[<jobId>]." (bez etykiety).
    // etykieta nie jest szukana gdziekolwiek w nazwie, bo slowo "video" albo "audio" moze byc tez w tytule filmu
    const ending = extraText === "" ? `[${jobId}].` : `${extraText} [${jobId}].`;

    return fs
        .readdirSync(downloadsDir)
        .find(fileName => fileName.includes(ending));
}

// funkcja tworząca nazwę pliku.  wykorzyustuje id oraz nazwe czy to jest wideo czy audio
function buildOutputTemplate(jobId, label = "") {
    const cleanLabel = label ? `${label} ` : "";
    return path.join(downloadsDir, `%(title).150B ${cleanLabel}[${jobId}].%(ext)s`);
}

// usuwa oryginalny plik po przetworzeniu
function deleteOriginalFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        console.log("Nie udało się usunąć oryginału:", error.message);
    }
}

// usuwa plik tymczasowy, ktory zostal po nieudanym ffmpegu. jesli ffmpeg nie zdazyl go utworzyc, nic sie nie dzieje
function deleteTempFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error.code !== "ENOENT") {
            console.log("Nie udało się usunąć pliku tymczasowego:", error.message);
        }
    }
}

//funkcja budujaca arugment do ffmpega zawieraajaaca resolution
function buildVideoFormat(resolution, format) {                             //pobieranie filmu z dzwiekiem (razem)
    if (format === "mp4" || format === "mpeg" || format === "mjpeg") {
        if (resolution === "best") {
            // na koncu wariant zapasowy bez wymogu kodeka - gdy film nie ma H.264, yt-dlp bierze to, co jest
            return "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b";
        }

        return `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][height<=${resolution}]/bv*[height<=${resolution}]+ba/b[height<=${resolution}]`;
    }

    if (resolution === "best") {
        return "bv*+ba/b";
    }   //best video(bv) + best audio(ba)

    return `bv*[height<=${resolution}]+ba/b[height<=${resolution}]`;
}

//jak wyzej tylko do innego trybu
function buildVideoOnlyFormat(resolution, format) {
    if (format === "mp4" || format === "mpeg" || format === "mjpeg") {
        if (resolution === "best") {                                    //pobieranie filmu i audio osobno
            // na koncu wariant zapasowy bez wymogu kodeka
            return "bv*[ext=mp4][vcodec^=avc1]/bv*";
        }

        return `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]/bv*[height<=${resolution}]`;
    }

    if (resolution === "best") {                                    //pobieranie filmu i audio osobno
        return "bv*";
    }       //best video ONLY

    return `bv*[height<=${resolution}]`;
}

// yt-dlp nie umie sensownie mergowac prosto do mpeg/mjpeg, wiec najpierw pobieramy do bezpiecznego mp4, a potem ffmpeg konwertuje do mpeg/mjpeg
function getYtDlpMergeFormat(format) {
    if (format === "mpeg" || format === "mjpeg") {
        return "mp4";
    }

    return format;
}

//funckja budujaca nazwe przeprocesowanego pliku: nazwa oryginalu z wlasciwym rozszerzeniem, bez zadnego przedrostka
function buildProcessedFileName(generatedFile, format, mediaType) {
    const parsedFile = path.parse(generatedFile);

    if (mediaType === "video" || mediaType === "videoOnly") {
        // mjpeg zapisujemy w kontenerze avi (-f avi), wiec plik dostaje rozszerzenie .avi; sama opcja dalej nazywa sie mjpeg
        const extension = format === "mjpeg" ? "avi" : format;

        return `${parsedFile.name}.${extension}`;
    }
    return generatedFile;
}

// nazwa tymczasowa, pod ktora ffmpeg zapisuje wynik, zanim plik dostanie koncowa nazwe
function buildTempFileName(processedFile) {
    return `tmp-${processedFile}`;
}

// uruchamia ffmpeg, ktory pisze do pliku tymczasowego. po sukcesie usuwa oryginal i nadaje wynikowi koncowa nazwe,
// przy bledzie ffmpeg usuwa plik tymczasowy. zwraca nazwe pliku, pod ktora lezy wynik
async function runFfmpegAndReplace(ffmpegArgs, label, originalPath, tempPath, processedPath, job = null) {
    try {
        await runProcess(ffmpegPath, ffmpegArgs, label, job);
    } catch (error) {
        deleteTempFile(tempPath);
        throw error;
    }

    deleteOriginalFile(originalPath);

    try {
        fs.renameSync(tempPath, processedPath);
    } catch (error) {
        // wynik jest poprawny, tylko nie dalo sie zmienic mu nazwy (np. oryginal jest zablokowany) - oddajemy go pod nazwa tymczasowa
        console.log("Nie udało się zmienić nazwy pliku tymczasowego:", error.message);

        // zadanie pamieta te nazwe, zeby przy przenoszeniu do folderu docelowego zdjac z niej przedrostek "tmp-"
        if (job && job.tempNamedFiles) {
            job.tempNamedFiles.add(path.basename(tempPath));
        }

        return path.basename(tempPath);
    }

    return path.basename(processedPath);
}

// funkcja budujaca argumenty do ffmpega, opisujace zastosowane filtry
function buildAudioFilters(experimental) {
    const { bitcrush, sampleRate, normalize } = experimental;

    const audioFilters = [];        // filtry budujemy w postaci tablicy, do której dodajemy potrzebne argumenty

    if (bitcrush > 0) {
        const crusherBits = Math.max(1, 16 - bitcrush);
        const crusherSamples = Math.min(30, 1 + bitcrush * 2);

        audioFilters.push(`volume=3,acrusher=bits=${crusherBits}:samples=${crusherSamples}:mix=1:mode=lin:aa=0,volume=0.5`);
    }

    if (normalize) {
        audioFilters.push("loudnorm");
    }

    if (sampleRate !== "default") {
        audioFilters.push(`aresample=${sampleRate}`);
    } else if (normalize) {
        audioFilters.push("aresample=48000");   // loudnorm sam podbija sample rate do 192 kHz, wiec bez wybranej wartosci wracamy do 48 kHz
    }

    if (bitcrush > 0 || sampleRate !== "default") {
        audioFilters.push("aformat=sample_fmts=s16");
    }

    return audioFilters;    // zwraca tablice
}

//funkcja sprawdzajaca czy plik potrzebuje dalszego procesowania przez ffmpeg, np w przypadku efektow lub przycinania. zwraca bool
function shouldProcessMedia(experimental, trimStartSeconds, trimEndSeconds, mediaType, format, generatedFile) {
    const audioFilters = buildAudioFilters(experimental);

    const needsAudioProcessing = audioFilters.length > 0 || experimental.channels === "mono";

    const needsTrim = trimStartSeconds !== null || trimEndSeconds !== null;

    const needsSeparateMp4Encoding = mediaType === "videoOnly" && format === "mp4";     // od B12 to tylko przepakowanie (-c copy), nie kodowanie

    const needsVideoConversion =
        (mediaType === "video" || mediaType === "videoOnly") &&
        (
            format === "mpeg" ||
            format === "mjpeg" ||
            path.extname(generatedFile).replace(".", "").toLowerCase() !== format
        );

    if (mediaType === "videoOnly") {
        return needsTrim || needsVideoConversion || needsSeparateMp4Encoding;
    }

    return needsAudioProcessing || needsTrim || needsVideoConversion;       // jesli ktorekolwiek jest true, zwraca true (bramka OR)
}


//funkcja budujaca argumenty do kodowania. po processingu albo  wprzypadku innych formatow niz mp4, ffmpeg musi przeprocesowac jeszcze raz wideo, i czesto byly problemy z kodekami,
// wiec wrzucilem taka funkcje zeby bylo ekstra bezpiecznie. niestety przez to troche dluzej zajmuje pobieranie
function addVideoCodecArgs(ffmpegArgs, format, mediaType, sampleRate) {
    if (format === "mp4") {
        if (mediaType === "videoOnly") {
            // pobrany obraz juz jest w H.264, wiec zamiast kodowac go od nowa tylko przepakowujemy kontener (sekundy zamiast minut, bez straty jakosci).
            // +faststart przenosi indeks na poczatek pliku, zeby plik dalo sie odtwarzac i przewijac od razu; -an jak dotad: plik wideo bez dzwieku
            ffmpegArgs.push("-c", "copy","-an","-movflags", "+faststart");

            return;
        }

        ffmpegArgs.push("-c:v", "copy");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "aac","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        return;
    }

    if (format === "mpeg") {
        ffmpegArgs.push("-c:v", "mpeg2video","-q:v", "5");

        if (mediaType === "video") {
            // enkoder mp2 nie dopuszcza 192k przy niskim sample rate (24000 i mniej), wiec wtedy 128k
            const lowSampleRate = sampleRate !== "default" && Number(sampleRate) <= 24000;

            ffmpegArgs.push("-c:a", "mp2","-b:a", lowSampleRate ? "128k" : "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        ffmpegArgs.push("-f", "mpeg");
        return;
    }

    if (format === "mjpeg") {
        ffmpegArgs.push("-c:v", "mjpeg","-q:v", "5");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "libmp3lame","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        ffmpegArgs.push("-f", "avi");
        return;
    }

    if (format === "mkv") {
        ffmpegArgs.push("-c:v", "copy");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "aac","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        return;
    }

    ffmpegArgs.push("-c:v", "copy");

    if (mediaType === "video") {
        ffmpegArgs.push("-c:a", "aac");
    } else {
        ffmpegArgs.push("-an");
    }
}

// argumenty kodowania obrazu przy przycinaniu. kopiowanie strumienia (-c copy) umie ciac tylko na klatkach kluczowych,
// wiec poczatek wypadal do kilku sekund za wczesnie i obraz rozjezdzal sie z dzwiekiem. kodowanie od nowa tnie co do klatki
function buildTrimVideoArgs() {
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];
}

//funkcja procesujaca plik, jesli tego potrzebuje - TUTAJ URUCHAMIAMY FFMPEG
async function processDownloadedFile(options) {
    const {
        generatedFile,
        experimental,
        trimStartSeconds,
        trimEndSeconds,
        mediaType,
        format,
        bitrate,
        dir = downloadsDir,     // folder z plikami; program zawsze uzywa downloads, inny folder podaja tylko testy
        job = null              // obiekt zadania z activeJobs (anulowanie)
    } = options;

    if (!shouldProcessMedia(experimental, trimStartSeconds, trimEndSeconds, mediaType, format, generatedFile)) {
        console.log("FFMPEG SKIP: nie trzeba procesowac pliku");
        return generatedFile;
    }

    const originalPath = path.join(dir, generatedFile);
    const processedFile = buildProcessedFileName(generatedFile, format, mediaType);
    const processedPath = path.join(dir, processedFile);
    const tempPath = path.join(dir, buildTempFileName(processedFile));      // ffmpeg pisze tutaj, koncowa nazwe plik dostaje po sukcesie

    const ffmpegArgs = ["-y", "-nostdin"]; // y - nadpisz plik, nostdin - nie czekaj na input z klawiatury

    const needsTrim = trimStartSeconds !== null || trimEndSeconds !== null;

    // -ss i -to stoja przed -i: ffmpeg skacze do zadanego miejsca w pliku wejsciowym, a oba czasy licza sie od poczatku filmu
    if (trimStartSeconds !== null) {
        ffmpegArgs.push("-ss", String(trimStartSeconds));
    }

    if (trimEndSeconds !== null) {
        ffmpegArgs.push("-to", String(trimEndSeconds));
    }

    ffmpegArgs.push("-i", originalPath);

    if (mediaType === "videoOnly") {                                                    //TYLKO WIDEO W TRYBIE ODDZIELNYM
        if (format === "mpeg" || format === "mjpeg") {
            addVideoCodecArgs(ffmpegArgs, format, mediaType, experimental.sampleRate);      // te formaty i tak koduja obraz od nowa
        } else if (needsTrim) {
            ffmpegArgs.push(...buildTrimVideoArgs(), "-an");        // przycinanie: obraz kodowany od nowa, zeby ciecie bylo co do klatki
        } else if (format === "mp4") {
            addVideoCodecArgs(ffmpegArgs, format, mediaType, experimental.sampleRate);
        } else {
            ffmpegArgs.push("-c", "copy");
        }

        ffmpegArgs.push(tempPath);

        return runFfmpegAndReplace(ffmpegArgs, "FFMPEG VIDEO ONLY", originalPath, tempPath, processedPath, job);
    }

    const audioFilters = buildAudioFilters(experimental);

    if (mediaType === "video") {                                                        //TRYB ŁĄCZNY
        if (audioFilters.length > 0) {
            ffmpegArgs.push("-af", audioFilters.join(","));
        }

        if (experimental.channels === "mono") {
            ffmpegArgs.push("-ac", "1");
        }

        if (format === "mpeg" || format === "mjpeg") {
            addVideoCodecArgs(ffmpegArgs, format, mediaType, experimental.sampleRate);
        } else if (needsTrim) {
            // przycinanie: obraz i dzwiek kodowane od nowa, zeby ciecie bylo dokladne i obraz nie rozjezdzal sie z dzwiekiem
            ffmpegArgs.push(...buildTrimVideoArgs());
            ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
        } else if (audioFilters.length > 0 || experimental.channels === "mono") {
            ffmpegArgs.push("-c:v", "copy");

            if (format === "mp4" || format === "mkv") {
                ffmpegArgs.push("-c:a", "aac");
                ffmpegArgs.push("-b:a", "192k");
            }
        } else {
            ffmpegArgs.push("-c", "copy");
        }
    }

    if (mediaType === "audio") {                                                        // TRYB AUDIO
        if (audioFilters.length > 0) {
            ffmpegArgs.push("-af", audioFilters.join(","));
        }

        if (experimental.channels === "mono") {
            ffmpegArgs.push("-ac", "1");
        }

        ffmpegArgs.push(...buildAudioQualityArgs(format, bitrate));
    }

    ffmpegArgs.push(tempPath);

    return runFfmpegAndReplace(ffmpegArgs, "FFMPEG", originalPath, tempPath, processedPath, job);
}

//funkcja pobierająca i zwracająca plik audio - TUTAJ URUCHAMIAMY YTDLP
async function downloadAudio(url, format, bitrate, jobId, job = null) {
    const outputTemplate = buildOutputTemplate(jobId);
    const audioQuality = getAudioQuality(bitrate);

    const ytDlpArgs = [
        ...ytDlpBaseArgs,
        "-x",
        "--audio-format", format,
        "--audio-quality", audioQuality,
        "-o", outputTemplate,
        url
    ];

    const result = await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP AUDIO", job);     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

    if (result.skippedByFilter) {
        throw liveStreamError();
    }

    const generatedFile = findGeneratedFile(jobId);

    if (!generatedFile) {
        throw {
            message: "Pobieranie zakończone, ale nie znaleziono pliku audio.",
            error: ""
        };
    }

    return generatedFile;
}

//funkcja pobierajaca wideo z audio
async function downloadVideo(url, resolution, format, jobId, job = null) {
    const outputTemplate = buildOutputTemplate(jobId);
    const videoFormat = buildVideoFormat(resolution, format);
    const mergeFormat = getYtDlpMergeFormat(format);

    const ytDlpArgs = [
        ...ytDlpBaseArgs,
        "-f", videoFormat,
        "--merge-output-format", mergeFormat,
        "-o", outputTemplate,
        url
    ];

    const result = await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP VIDEO", job);     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

    if (result.skippedByFilter) {
        throw liveStreamError();
    }

    const generatedFile = findGeneratedFile(jobId);

    if (!generatedFile) {
        throw {
            message: "Pobieranie video zakończone, ale nie znaleziono pliku.",
            error: ""
        };
    }

    return generatedFile;
}

//funkcja pobierajaca wideo i audio oddzielnie
async function downloadSeparate(url, resolution, format, jobId, job = null) {
    const videoOutputTemplate = buildOutputTemplate(jobId, "video");
    const audioOutputTemplate = buildOutputTemplate(jobId, "audio");

    const videoOnlyFormat = buildVideoOnlyFormat(resolution, format);

    const videoArgs = [
        ...ytDlpBaseArgs,
        "-f", videoOnlyFormat,
        "-o", videoOutputTemplate,
        url
    ];

    const audioArgs = [
        ...ytDlpBaseArgs,
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", audioOutputTemplate,
        url
    ];

    const videoResult = await runProcess(ytDlpPath, videoArgs, "YT-DLP VIDEO ONLY", job);        //odpalamy dwa razy, raz dla wideo raz dla audio

    if (videoResult.skippedByFilter) {      // transmisja: drugiego wywolania nie ma po co uruchamiac
        throw liveStreamError();
    }

    const audioResult = await runProcess(ytDlpPath, audioArgs, "YT-DLP AUDIO ONLY", job);

    if (audioResult.skippedByFilter) {
        throw liveStreamError();
    }

    const videoFile = findGeneratedFile(jobId, "video");
    const audioFile = findGeneratedFile(jobId, "audio");

    if (!videoFile || !audioFile) {
        throw {
            message: "Pobieranie osobnych plików zakończone, ale nie znaleziono video albo audio.",
            error: ""
        };
    }

    return {
        videoFile,
        audioFile
    };
}

//funkcja sprawdzajaca link YouTube przed pobieraniem: null = link przyjety, tekst = komunikat bledu.
// przyjmuje tylko link do jednego filmu, odrzuca playlisty, kanaly i inne strony YouTube.
// linki z innych serwisow (i takie, ktorych nie da sie odczytac) przepuszcza bez oceny - ocenia je yt-dlp albo reszta walidacji.
// ta sama funkcja jest w public/script.js - obie kopie maja dawac identyczne wyniki
function sprawdzLinkYoutube(url) {
    const youtubeHosts = [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
        "youtu.be"
    ];
    const playlistMessage = "To link do playlisty. Wklej link do jednego filmu.";
    const channelMessage = "To link do kanału. Wklej link do jednego filmu.";
    const notVideoMessage = "To nie jest link do filmu.";

    let parsedUrl;

    try {
        parsedUrl = new URL(url);
    } catch {
        return null;
    }

    if (!youtubeHosts.includes(parsedUrl.hostname)) {
        return null;
    }

    // czesci sciezki bez pustych (ukosnik na koncu i podwojne ukosniki nie maja znaczenia)
    const parts = parsedUrl.pathname.split("/").filter(part => part !== "");
    const first = parts.length > 0 ? parts[0] : "";
    const videoId = parsedUrl.searchParams.get("v");
    const listId = parsedUrl.searchParams.get("list");

    if (parsedUrl.hostname === "youtu.be") {
        return parts.length === 1 ? null : notVideoMessage;
    }

    if (parts.length === 1 && first === "watch") {
        if (videoId) {
            return null;
        }

        return listId ? playlistMessage : notVideoMessage;
    }

    if (parts.length === 1 && first === "playlist" && listId) {
        return playlistMessage;
    }

    if (parts.length === 2 && ["shorts", "live", "embed"].includes(first)) {
        return null;
    }

    // kanal z dowolna podstrona (np. /videos, /shorts, /streams, /live)
    if ((first.startsWith("@") && first.length > 1) || (["channel", "c", "user"].includes(first) && parts.length >= 2)) {
        return channelMessage;
    }

    return notVideoMessage;
}

// sprawdza folder docelowy z zadania pobrania. zwraca null, gdy folder jest dobry, albo komunikat bledu.
// zapis sprawdzamy naprawde (plik probny tworzony i od razu usuwany), bo na Windowsie fs.access nie widzi uprawnien folderu
function sprawdzFolderDocelowy(folder) {
    if (typeof folder !== "string" || folder.trim() === "") {
        return "Nie wybrano folderu docelowego.";
    }

    if (!path.isAbsolute(folder)) {
        return `Folder docelowy musi być pełną ścieżką: ${folder}`;
    }

    let stats;

    try {
        stats = fs.statSync(folder);
    } catch {
        return `Folder docelowy nie istnieje: ${folder}`;
    }

    if (!stats.isDirectory()) {
        return `Folder docelowy nie istnieje: ${folder}`;
    }

    const probePath = path.join(folder, `.pobierak-proba-${randomUUID().slice(0, 8)}`);

    try {
        fs.closeSync(fs.openSync(probePath, "wx"));
    } catch {
        return `Nie można zapisywać w folderze docelowym: ${folder}`;
    }

    try {
        fs.unlinkSync(probePath);
    } catch (error) {
        console.log("Nie udało się usunąć pliku próbnego:", error.message);
    }

    return null;
}

// nazwa, pod ktora gotowy plik trafi do folderu docelowego, gdy plik o zwyklej nazwie juz tam jest:
// numer przed rozszerzeniem - "nazwa (2).mp3", "nazwa (3).mp3"...
function buildTargetFileName(fileName, number = 1) {
    if (number <= 1) {
        return fileName;
    }

    const extension = path.extname(fileName);

    return `${fileName.slice(0, fileName.length - extension.length)} (${number})${extension}`;
}

// ile numerow probujemy, zanim uznamy, ze nie da sie znalezc wolnej nazwy
const targetNameAttempts = 1000;

// przenosi gotowy plik z folderu roboczego do folderu docelowego i zwraca { name, path } (pelna sciezka na dysku).
// istniejacego pliku nie nadpisuje - dodaje numer do nazwy. ten sam dysk: zmiana nazwy; inny dysk (EXDEV): kopiowanie i usuniecie.
// sciezka trafia do job.movedFiles, zeby anulowanie albo blad przy kolejnym pliku mogly usunac to, co juz przeniesione
async function moveToTargetFolder(fileName, targetDir, job = null, dir = downloadsDir) {
    const sourcePath = path.join(dir, fileName);

    // wynik ffmpeg, ktoremu nie udalo sie nadac koncowej nazwy, lezy w folderze roboczym pod nazwa "tmp-...".
    // w folderze uzytkownika plikow tmp- nie ma byc, wiec przedrostek znika (tytul filmu zaczynajacy sie od "tmp-" zostaje)
    const tempNamed = Boolean(job && job.tempNamedFiles && job.tempNamedFiles.has(fileName));
    const baseName = tempNamed ? fileName.slice("tmp-".length) : fileName;

    for (let number = 1; number <= targetNameAttempts; number++) {
        const name = buildTargetFileName(baseName, number);
        const targetPath = path.join(targetDir, name);

        if (fs.existsSync(targetPath)) {
            continue;
        }

        try {
            await fs.promises.rename(sourcePath, targetPath);
        } catch (error) {
            if (error.code !== "EXDEV") {
                throw error;
            }

            try {
                // COPYFILE_EXCL: jesli plik o tej nazwie pojawil sie w miedzyczasie, kopiowanie go nie nadpisze
                await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
            } catch (copyError) {
                if (copyError.code === "EEXIST") {
                    continue;
                }

                // niedokonczona kopia nie zostaje w folderze uzytkownika
                await fs.promises.rm(targetPath, { force: true }).catch(() => {});
                throw copyError;
            }

            if (job) {
                job.movedFiles.push(targetPath);
            }

            await fs.promises.unlink(sourcePath);

            return { name, path: targetPath };
        }

        if (job) {
            job.movedFiles.push(targetPath);
        }

        return { name, path: targetPath };
    }

    throw new Error(`Nie udało się znaleźć wolnej nazwy pliku w folderze docelowym: ${targetDir}`);
}

// przenosi gotowe pliki zadania do folderu docelowego, po kolei. zwraca liste { name, path } do odpowiedzi serwera
async function moveFilesToTargetFolder(fileNames, targetDir, job = null, dir = downloadsDir) {
    const files = [];

    for (const fileName of fileNames) {
        throwIfCancelled(job);      // anulowane zadanie niczego juz nie przenosi
        files.push(await moveToTargetFolder(fileName, targetDir, job, dir));
    }

    return files;
}

// usuwa z folderu docelowego pliki, ktore to zadanie samo tam przenioslo (po anulowaniu albo bledzie w trakcie przenoszenia).
// dotyka tylko sciezek z job.movedFiles - niczego innego w folderze uzytkownika program nie usuwa
function removeMovedFiles(job) {
    for (const filePath of job.movedFiles) {
        try {
            fs.unlinkSync(filePath);
        } catch (error) {
            if (error.code !== "ENOENT") {
                console.log("Nie udało się usunąć pliku z folderu docelowego:", error.message);
            }
        }
    }

    job.movedFiles = [];
}

//funkcja walidująca dane przysylane z frontendu na serwer
function validateRequest(req, res) {
    const { url, type, bitrate, resolution, format, experimental, folder } = req.body;

    if (!url || !type || !format) {
        badRequest(res, "Brakuje podstawowych danych.");
        return null;
    }

    try {
        new URL(url);
    } catch {
        badRequest(res, "Nieprawidłowy URL.");
        return null;
    }

    const linkError = sprawdzLinkYoutube(url);

    if (linkError) {
        badRequest(res, linkError);
        return null;
    }

    if (!allowedTypes.includes(type)) {
        badRequest(res, "Nieprawidłowy tryb pobierania.");
        return null;
    }

    if (type === "audio") {
        if (!allowedAudioFormats.includes(format)) {
            badRequest(res, "Nieprawidłowy format audio.");
            return null;
        }

        if (!allowedBitrates.includes(bitrate)) {
            badRequest(res, "Nieprawidłowy bitrate.");
            return null;
        }
    }

    if (type === "video" || type === "separate") {
        if (!allowedVideoFormats.includes(format)) {
            badRequest(res, "Nieprawidłowy format wideo.");
            return null;
        }

        if (!allowedResolutions.includes(resolution)) {
            badRequest(res, "Nieprawidłowa rozdzielczość.");
            return null;
        }

        if (mkvOnlyResolutions.includes(resolution) && format !== "mkv") {
            badRequest(res, "Ta rozdzielczość jest dostępna tylko w formacie MKV.");
            return null;
        }
    }

    if (!experimental || typeof experimental !== "object" || Array.isArray(experimental)) {
        badRequest(res, "Brakuje opcji eksperymentalnych.");
        return null;
    }

    const { bitcrush, sampleRate, channels, normalize, trimStart, trimEnd } = experimental;

    if (!Number.isInteger(bitcrush) || bitcrush < 0 || bitcrush > 15) {
        badRequest(res, "Nieprawidłowy bitcrush.");
        return null;
    }

    if (!allowedSampleRates.includes(sampleRate)) {
        badRequest(res, "Nieprawidłowy sample rate.");
        return null;
    }

    if (!allowedChannels.includes(channels)) {
        badRequest(res, "Nieprawidłowy tryb kanałów.");
        return null;
    }

    if (typeof normalize !== "boolean") {
        badRequest(res, "Nieprawidłowa wartość normalizacji.");
        return null;
    }

    if (typeof trimStart !== "string" || typeof trimEnd !== "string") {
        badRequest(res, "Nieprawidłowe czasy przycinania.");
        return null;
    }

    const trimStartSeconds = parseTimeToSeconds(trimStart);
    const trimEndSeconds = parseTimeToSeconds(trimEnd);

    if (Number.isNaN(trimStartSeconds) || Number.isNaN(trimEndSeconds)) {
        badRequest(res, "Nieprawidłowy format czasu przycinania.");
        return null;
    }

    if (trimStartSeconds !== null && trimStartSeconds < 0) {
        badRequest(res, "Początek przycinania nie może być mniejszy od zera.");
        return null;
    }

    if (trimEndSeconds !== null && trimEndSeconds < 0) {
        badRequest(res, "Koniec przycinania nie może być mniejszy od zera.");
        return null;
    }

    if (trimStartSeconds !== null && trimEndSeconds !== null && trimStartSeconds >= trimEndSeconds) {
        badRequest(res, "Początek przycinania musi być mniejszy niż koniec.");
        return null;
    }

    // folder sprawdzamy na koncu: najpierw bledy formularza, potem folder (serwer go nie pamieta, przychodzi w kazdym zadaniu)
    const folderError = sprawdzFolderDocelowy(folder);

    if (folderError) {
        badRequest(res, folderError);
        return null;
    }

    return {
        url,
        type,
        bitrate,
        resolution,
        format,
        experimental,
        trimStartSeconds,
        trimEndSeconds,
        folder: path.resolve(folder)
    };
}

// tutaj mamy endpoint na ktorym wszystko sie dzieje
app.post("/api/download", onlyLocalRequests, async (req, res) => {
    console.log(req.body);

    const data = validateRequest(req, res);

    if (!data) {
        return;
    }

    const {
        url,
        type,
        bitrate,
        resolution,
        format,
        experimental,
        trimStartSeconds,
        trimEndSeconds,
        folder
    } = data;

    const jobId = getJobId();

    // process - aktualnie dzialajacy yt-dlp albo ffmpeg tego zadania, cancelled - znacznik anulowania
    // movedFiles - sciezki plikow, ktore zadanie przenioslo juz do folderu docelowego,
    // tempNamedFiles - wyniki ffmpeg, ktore zostaly w folderze roboczym pod nazwa "tmp-..."
    const job = { jobId, startedAt: Date.now(), process: null, cancelled: false, movedFiles: [], tempNamedFiles: new Set() };

    let finished = false;       // gotowe pliki sa w folderze docelowym i idzie odpowiedz z sukcesem

    activeJobs.set(jobId, job);

    // przycisku "Anuluj" nie ma: przerwanie to zerwanie polaczenia (zamkniecie albo odswiezenie karty).
    // "close" przychodzi tez po zwyklym wyslaniu odpowiedzi - wtedy writableEnded jest true i nic nie robimy
    res.on("close", () => {
        if (!res.writableEnded) {
            cancelJob(job);
        }
    });

    try {
        if (type === "audio") {
            const downloadedFile = await downloadAudio(url, format, bitrate, jobId, job);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format,
                bitrate,
                job
            });

            // dopiero gotowy plik trafia do folderu docelowego
            const files = await moveFilesToTargetFolder([finalFile], folder, job);

            throwIfCancelled(job);      // anulowane zadanie nie wysyla odpowiedzi

            finished = true;
            rememberSavedFiles(files);      // tylko te pliki da sie potem pokazac w folderze (/api/folder/pokaz)

            return res.json({
                success: true,
                message: "Audio gotowe do pobrania.",
                files,
                receivedData: data
            });
        }

        if (type === "video") {
            const downloadedFile = await downloadVideo(url, resolution, format, jobId, job);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "video",
                format,
                bitrate,
                job
            });

            // dopiero gotowy plik trafia do folderu docelowego
            const files = await moveFilesToTargetFolder([finalFile], folder, job);

            throwIfCancelled(job);      // anulowane zadanie nie wysyla odpowiedzi

            finished = true;
            rememberSavedFiles(files);      // tylko te pliki da sie potem pokazac w folderze (/api/folder/pokaz)

            return res.json({
                success: true,
                message: "Video gotowe do pobrania.",
                files,
                receivedData: data
            });
        }

        if (type === "separate") {
            const { videoFile, audioFile } = await downloadSeparate(url, resolution, format, jobId, job);

            const finalVideoFile = await processDownloadedFile({
                generatedFile: videoFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "videoOnly",
                format,
                bitrate,
                job
            });

            const finalAudioFile = await processDownloadedFile({
                generatedFile: audioFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format: "mp3",
                bitrate: "best",
                job
            });

            // dopiero gotowe pliki trafiaja do folderu docelowego: najpierw obraz, potem dzwiek
            const files = await moveFilesToTargetFolder([finalVideoFile, finalAudioFile], folder, job);

            throwIfCancelled(job);      // anulowane zadanie nie wysyla odpowiedzi

            finished = true;
            rememberSavedFiles(files);      // tylko te pliki da sie potem pokazac w folderze (/api/folder/pokaz)

            return res.json({
                success: true,
                message: "Video i audio osobno gotowe do pobrania.",
                files,
                receivedData: data
            });
        }

        return badRequest(res, "Nieobsługiwany tryb pobierania.");
    } catch (error) {
        if (job.cancelled) {        // polaczenie jest zerwane, nie ma komu odpowiadac
            return;
        }

        console.error(error);

        let message = error.message || "Wystąpił błąd podczas pobierania.";

        // UL-4: yt-dlp zakonczyl prace bledem, a jego wersja jest stara: ostrzezenie jeszcze raz (ostatnia linia w tle)
        // i zdanie o aktualizacji w komunikacie pod przyciskiem
        if (ytDlpWarning && isYtDlpExitError(error)) {
            sendLogToClients("warning", ytDlpWarning);
            message += buildYtDlpUpdateSentence();
        }

        return res.status(500).json({
            success: false,
            message,
            error: error.error || error.message || String(error)
        });
    } finally {
        // anulowane zadanie: procesy sa juz zabite, usuwamy wszystkie jego pliki z folderu roboczego
        if (job.cancelled) {
            await removeJobFiles(jobId);
        }

        // anulowanie albo blad w trakcie przenoszenia: w folderze docelowym nie zostaje polowa wyniku
        if (!finished) {
            removeMovedFiles(job);
        }

        // po bledzie: resztki w folderze roboczym sprzata zwykly licznik 30 minut (od zapisania pliku)
        activeJobs.delete(jobId);
    }
});

// podpowiedz, jak zainstalowac brakujace programy - dobrana do systemu, na ktorym dziala program
function buildInstallHint(platform = process.platform) {
    if (platform === "win32") {
        return "Jak zainstalowac: winget install yt-dlp.yt-dlp (ten pakiet doinstalowuje tez ffmpeg). Szczegoly w README.";
    }

    if (platform === "darwin") {
        return "Jak zainstalowac: brew install yt-dlp ffmpeg. Szczegoly w README.";
    }

    return "Jak zainstalowac: uzyj menedzera pakietow swojego systemu (np. apt, dnf, pacman). Szczegoly w README.";
}

// wyciaga numer wersji z tego, co program wypisal: pierwsza niepusta linia.
// yt-dlp wypisuje sam numer, ffmpeg linie "ffmpeg version <numer> Copyright ..." - wtedy bierzemy sam numer
function extractVersion(output) {
    const firstLine = String(output || "")
        .split(/\r\n|\n|\r/)
        .map(line => line.trim())
        .find(line => line !== "");

    if (!firstLine) {
        return "";
    }

    const match = firstLine.match(/\bversion\s+(\S+)/i);

    return match ? match[1] : firstLine;
}

// uruchamia program z argumentem wypisujacym wersje. nigdy nie rzuca bledu:
// zwraca { ok: true, version } albo { ok: false, missing, reason } (missing = nie ma takiego pliku)
function checkProgramVersion(command, args) {
    return new Promise((resolve) => {
        let childProcess;

        try {
            childProcess = spawn(command, args);
        } catch (error) {
            resolve({ ok: false, missing: false, reason: error.message });
            return;
        }

        let output = "";        // wystarczy poczatek stdout, wersja jest w pierwszej linii

        childProcess.stdout.on("data", (data) => {
            output = (output + data.toString()).slice(0, 2000);
        });

        childProcess.stderr.on("data", () => {});       // stderr trzeba czytac, inaczej program moze stanac na pelnym buforze

        childProcess.on("error", (error) => {
            resolve({ ok: false, missing: error.code === "ENOENT", reason: error.message });
        });

        childProcess.on("close", (code) => {
            const version = extractVersion(output);

            if (code !== 0 || version === "") {
                resolve({ ok: false, missing: false, reason: `program zakonczyl prace z kodem ${code}` });
                return;
            }

            resolve({ ok: true, version });
        });
    });
}

// linie do wypisania w konsoli dla jednego programu: wersja albo informacja o braku z podpowiedzia instalacji
function buildProgramReport(name, command, result, platform = process.platform) {
    if (result.ok) {
        return [`${name}: wersja ${result.version}`];
    }

    const problem = result.missing
        ? `BRAK PROGRAMU ${name}: nie znaleziono "${command}". Bez niego pobieranie nie zadziala.`
        : `PROGRAM ${name} NIE DZIALA: nie udalo sie uruchomic "${command}" (${result.reason}). Bez niego pobieranie nie zadziala.`;

    return [problem, buildInstallHint(platform)];
}

// UL-4: numer wersji yt-dlp to data wydania (np. 2026.10.26, nocne wydania maja jeszcze czwarta czesc: 2026.10.26.232946).
// starsza niz tyle dni wersja dostaje ostrzezenie - YouTube czesto cos zmienia i stare yt-dlp przestaje pobierac
const ytDlpMaxAgeDays = 90;

// data z numeru wersji jako { year, month, day } albo null, gdy numer nie jest data (inny format = bez ostrzezenia)
function parseYtDlpVersionDate(version) {
    const match = String(version || "").trim().match(/^(\d{4})\.(\d{2})\.(\d{2})(?:\.\d+)?$/);

    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));

    // np. 2026.02.31 - Date przesunalby to na marzec, a to nie jest prawdziwa data
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
        return null;
    }

    return { year, month, day };
}

// ile dni minelo od daty wersji do "dzisiaj" (dzien z lokalnego kalendarza; godzina nie ma znaczenia)
function ytDlpAgeDays(versionDate, today) {
    const versionDay = Date.UTC(versionDate.year, versionDate.month - 1, versionDate.day);
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());

    return Math.round((todayDay - versionDay) / (24 * 60 * 60 * 1000));
}

// komenda aktualizacji zgodna z tym, jak README i skrypty startowe kaza instalowac yt-dlp na danym systemie
function buildYtDlpUpdateCommand(platform = process.platform) {
    if (platform === "win32") {
        return "winget upgrade --id yt-dlp.yt-dlp -e";
    }

    if (platform === "darwin") {
        return "brew upgrade yt-dlp";
    }

    // Linux: README kaze brac oficjalny plik do folderu systemowego (stad sudo) albo pipx
    return "sudo yt-dlp -U (oficjalny plik) albo pipx upgrade yt-dlp (pipx)";
}

// tresc ostrzezenia albo null, gdy wersja jest swieza (90 dni i mniej) albo jej numer nie jest data
function buildYtDlpAgeWarning(version, today = new Date(), platform = process.platform) {
    const versionDate = parseYtDlpVersionDate(version);

    if (!versionDate) {
        return null;
    }

    const days = ytDlpAgeDays(versionDate, today);

    if (days <= ytDlpMaxAgeDays) {
        return null;
    }

    const dateText = [versionDate.year, versionDate.month, versionDate.day]
        .map(part => String(part).padStart(2, "0"))
        .join(".");

    return `UWAGA: yt-dlp jest z ${dateText} (${days} dni). Jeśli pobieranie nie działa, zaktualizuj: ${buildYtDlpUpdateCommand(platform)}`;
}

// czerwony kolor kodami ANSI tylko w terminalu; przekierowane wyjscie (plik, potok) dostaje sam tekst
function colorRedForConsole(text, isTerminal = Boolean(process.stdout.isTTY)) {
    return isTerminal ? `\x1b[31m${text}\x1b[0m` : text;
}

// ostrzezenie o starym yt-dlp ustalone przy starcie (null = brak). wysylane kazdej stronie przy polaczeniu z logami
// i po kazdym pobraniu, ktore yt-dlp zakonczyl bledem
let ytDlpWarning = null;
let ytDlpUpdateCommand = null;

// ustawia ostrzezenie dla odczytanej wersji yt-dlp i je zwraca (null = brak). version null = wersji nie udalo sie odczytac
function setYtDlpVersion(version, today = new Date(), platform = process.platform) {
    ytDlpWarning = version === null ? null : buildYtDlpAgeWarning(version, today, platform);
    ytDlpUpdateCommand = ytDlpWarning ? buildYtDlpUpdateCommand(platform) : null;

    return ytDlpWarning;
}

function getYtDlpWarning() {
    return ytDlpWarning;
}

// blad zakonczonego procesu yt-dlp (kod wyjscia rozny od 0) - nie brak programu, nie ffmpeg, nie anulowanie
function isYtDlpExitError(error) {
    return Boolean(error) && typeof error.exitCode === "number" && String(error.label || "").startsWith("YT-DLP");
}

// zdanie dopisywane do komunikatu pod przyciskiem po bledzie yt-dlp, gdy wersja jest stara ("" gdy swieza)
function buildYtDlpUpdateSentence() {
    return ytDlpUpdateCommand
        ? ` Twój yt-dlp jest stary - zaktualizuj go (${ytDlpUpdateCommand}) i spróbuj ponownie.`
        : "";
}

// sprawdza przy starcie yt-dlp i ffmpeg i wypisuje ich wersje albo informacje, ktorego brakuje. brak programu nie zatrzymuje serwera
async function reportPrograms() {
    const programs = [
        { name: "yt-dlp", command: ytDlpPath, args: ["--version"] },
        { name: "ffmpeg", command: ffmpegPath, args: ["-version"] }
    ];

    const results = await Promise.all(programs.map(program => checkProgramVersion(program.command, program.args)));

    programs.forEach((program, index) => {
        buildProgramReport(program.name, program.command, results[index]).forEach(line => console.log(line));

        // UL-4: pod linia z wersja yt-dlp czerwone ostrzezenie, gdy wersja ma ponad 90 dni
        if (program.name === "yt-dlp") {
            const warning = setYtDlpVersion(results[index].ok ? results[index].version : null);

            if (warning) {
                console.log(colorRedForConsole(warning));
            }
        }
    });
}

// zdanie wypisywane zamiast sladu stosu, gdy port jest juz zajety
function buildPortInUseMessage(port) {
    return `Port ${port} jest zajety - pewnie program juz dziala w innym oknie. Zamknij tamto okno albo ustaw inny port w zmiennej srodowiskowej PORT (np. PORT=3001) i uruchom program jeszcze raz. Szczegoly w README.`;
}

// uruchamia nasluchiwanie. po starcie wypisuje gotowy adres i sprawdza programy
function startServer(port = PORT, host = HOST) {
    const server = app.listen(port, host);

    server.on("listening", () => {
        console.log(`Pobierak dziala. Otworz w przegladarce: http://localhost:${server.address().port}`);

        reportPrograms();
    });

    // bez tej obslugi Node wypisuje slad stosu i nic z niego nie wynika
    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(buildPortInUseMessage(port));
        } else {
            console.error(`Nie udalo sie uruchomic serwera na ${host}:${port}: ${error.message}`);
        }

        process.exitCode = 1;       // nic wiecej nie trzyma programu, wiec sam sie konczy
    });

    return server;
}

// serwer i sprzatanie startuja tylko przy uruchomieniu "node app.js"; przy require (testy) plik tylko udostepnia funkcje
if (require.main === module) {
    cleanupOldDownloads();

    // unref: sam zegar sprzatania nie trzyma programu przy zyciu, gdy serwer nie wystartowal (np. zajety port)
    setInterval(() => {
        cleanupOldDownloads();
    }, cleanupIntervalMinutes * 60 * 1000).unref();

    startServer();
}

module.exports = {
    app,
    sendLogToClients,
    cleanupOldDownloads,
    activeJobs,
    isActiveJobFile,
    buildSpawnOptions,
    killProcessTree,
    cancelJob,
    removeJobFiles,
    fileMaxAgeMinutes,
    resolveBinary,
    buildYtDlpBaseArgs,
    ytDlpBaseArgs,
    liveFilter,
    liveStreamMessage,
    isFilterSkipLine,
    ytDlpPath,
    ffmpegPath,
    downloadAudio,
    downloadVideo,
    downloadSeparate,
    parseTimeToSeconds,
    sprawdzLinkYoutube,
    runProcess,
    buildProcessErrorMessage,
    buildMissingProgramMessage,
    stderrTailLimit,
    PORT,
    HOST,
    buildInstallHint,
    extractVersion,
    checkProgramVersion,
    buildProgramReport,
    reportPrograms,
    ytDlpMaxAgeDays,
    parseYtDlpVersionDate,
    buildYtDlpUpdateCommand,
    buildYtDlpAgeWarning,
    colorRedForConsole,
    setYtDlpVersion,
    getYtDlpWarning,
    isYtDlpExitError,
    buildYtDlpUpdateSentence,
    buildPortInUseMessage,
    startServer,
    getJobId,
    findGeneratedFile,
    buildOutputTemplate,
    buildVideoFormat,
    buildVideoOnlyFormat,
    buildAudioFilters,
    buildAudioQualityArgs,
    addVideoCodecArgs,
    buildProcessedFileName,
    buildTempFileName,
    buildTrimVideoArgs,
    shouldProcessMedia,
    processDownloadedFile,
    sprawdzFolderDocelowy,
    buildTargetFileName,
    moveToTargetFolder,
    moveFilesToTargetFolder,
    removeMovedFiles,
    downloadsDir,
    isLoopbackAddress,
    onlyLocalRequests,
    buildWindowsFolderPickerScript,
    buildFolderPickerCommands,
    interpretFolderPickerResult,
    runFolderPickerCommand,
    pickFolder,
    folderPickerOptions,
    folderPickerUnavailableMessage,
    savedFiles,
    rememberSavedFiles,
    isSavedFile,
    buildShowInFolderCommand,
    showInFolder,
    showInFolderOptions
};
