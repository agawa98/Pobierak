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
const allowedResolutions = ["144", "360", "480", "720", "1080", "best"];
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
app.use("/downloads", express.static(downloadsDir));



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

//funkcja usuwajaca stare pliki z folderu downloads
// folder mozna podac tylko po to, zeby testy sprzataly folder tymczasowy; program zawsze sprzata downloads
function cleanupOldDownloads(dir = downloadsDir) {
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
function runProcess(command, args, label) {
    return new Promise((resolve, reject) => {       // resolve sie odpala gdy sukces, reject gdy etrror
        console.log(`${label} ARGS:`, args);

        const childProcess = spawn(command, args);

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

            if (code !== 0) {
                reject({
                    message: buildProcessErrorMessage(label, errorOutput, code),
                    error: errorOutput
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
async function runFfmpegAndReplace(ffmpegArgs, label, originalPath, tempPath, processedPath) {
    try {
        await runProcess(ffmpegPath, ffmpegArgs, label);
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
        dir = downloadsDir      // folder z plikami; program zawsze uzywa downloads, inny folder podaja tylko testy
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

        return runFfmpegAndReplace(ffmpegArgs, "FFMPEG VIDEO ONLY", originalPath, tempPath, processedPath);
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

    return runFfmpegAndReplace(ffmpegArgs, "FFMPEG", originalPath, tempPath, processedPath);
}

//funkcja pobierająca i zwracająca plik audio - TUTAJ URUCHAMIAMY YTDLP
async function downloadAudio(url, format, bitrate, jobId) {
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

    const result = await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP AUDIO");     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

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
async function downloadVideo(url, resolution, format, jobId) {
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

    const result = await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP VIDEO");     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

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
async function downloadSeparate(url, resolution, format, jobId) {
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

    const videoResult = await runProcess(ytDlpPath, videoArgs, "YT-DLP VIDEO ONLY");        //odpalamy dwa razy, raz dla wideo raz dla audio

    if (videoResult.skippedByFilter) {      // transmisja: drugiego wywolania nie ma po co uruchamiac
        throw liveStreamError();
    }

    const audioResult = await runProcess(ytDlpPath, audioArgs, "YT-DLP AUDIO ONLY");

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

//funkcja walidująca dane przysylane z frontendu na serwer
function validateRequest(req, res) {
    const { url, type, bitrate, resolution, format, experimental } = req.body;

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

    return {
        url,
        type,
        bitrate,
        resolution,
        format,
        experimental,
        trimStartSeconds,
        trimEndSeconds
    };
}

// adres pliku z folderu downloads. nazwa jest kodowana, bo zawiera tytul filmu, a ten moze miec znaki #, % albo ?
// (bez kodowania przegladarka ucina adres na # i ?, a % daje blad 400)
function buildDownloadUrl(fileName) {
    return `/downloads/${encodeURIComponent(fileName)}`;
}

// lista plikow do odpowiedzi serwera: nazwa pliku i jego adres
function buildDownloadFiles(fileNames) {
    return fileNames.map((name) => ({ name, url: buildDownloadUrl(name) }));
}

// tutaj mamy endpoint na ktorym wszystko sie dzieje
app.post("/api/download", async (req, res) => {
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
        trimEndSeconds
    } = data;

    const jobId = getJobId();

    try {
        if (type === "audio") {
            const downloadedFile = await downloadAudio(url, format, bitrate, jobId);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format,
                bitrate
            });

            return res.json({
                success: true,
                message: "Audio gotowe do pobrania.",
                downloadUrl: buildDownloadUrl(finalFile),
                files: buildDownloadFiles([finalFile]),
                receivedData: data
            });
        }

        if (type === "video") {
            const downloadedFile = await downloadVideo(url, resolution, format, jobId);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "video",
                format,
                bitrate
            });

            return res.json({
                success: true,
                message: "Video gotowe do pobrania.",
                downloadUrl: buildDownloadUrl(finalFile),
                files: buildDownloadFiles([finalFile]),
                receivedData: data
            });
        }

        if (type === "separate") {
            const { videoFile, audioFile } = await downloadSeparate(url, resolution, format, jobId);

            const finalVideoFile = await processDownloadedFile({
                generatedFile: videoFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "videoOnly",
                format,
                bitrate
            });

            const finalAudioFile = await processDownloadedFile({
                generatedFile: audioFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format: "mp3",
                bitrate: "best"
            });

            return res.json({
                success: true,
                message: "Video i audio osobno gotowe do pobrania.",
                downloadUrl: buildDownloadUrl(finalAudioFile),
                downloadUrls: [
                    buildDownloadUrl(finalVideoFile),
                    buildDownloadUrl(finalAudioFile)
                ],
                files: buildDownloadFiles([finalVideoFile, finalAudioFile]),
                receivedData: data
            });
        }

        return badRequest(res, "Nieobsługiwany tryb pobierania.");
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message || "Wystąpił błąd podczas pobierania.",
            error: error.error || error.message || String(error)
        });
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

// sprawdza przy starcie yt-dlp i ffmpeg i wypisuje ich wersje albo informacje, ktorego brakuje. brak programu nie zatrzymuje serwera
async function reportPrograms() {
    const programs = [
        { name: "yt-dlp", command: ytDlpPath, args: ["--version"] },
        { name: "ffmpeg", command: ffmpegPath, args: ["-version"] }
    ];

    const results = await Promise.all(programs.map(program => checkProgramVersion(program.command, program.args)));

    programs.forEach((program, index) => {
        buildProgramReport(program.name, program.command, results[index]).forEach(line => console.log(line));
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
    buildDownloadUrl,
    buildDownloadFiles,
    downloadsDir
};
