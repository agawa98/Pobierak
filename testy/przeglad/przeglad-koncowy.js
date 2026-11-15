// Pelny przeglad programu (zadania K1 i K2): prawdziwe pobrania filmu testowego w kazdym trybie.
// Uruchamianie: node testy/przeglad/przeglad-koncowy.js [--wyczysc] [--bez-przegladarki]
//   --wyczysc           usuwa pliki z folderu downloads przed startem (bez tej opcji skrypt wymaga pustego folderu)
//   --bez-przegladarki  pomija czesc w przegladarce Edge (np. na Macu, gdzie Edge nie ma)
// NIE jest czescia "npm test" ani "npm run test:przegladarka": pobiera film z YouTube, wiec wymaga internetu,
// yt-dlp, ffmpeg i ffprobe. Trwa kilka minut.
// Skrypt uruchamia prawdziwy "node app.js" na wolnym porcie, zbiera jego konsole, robi pobrania przez
// POST /api/download, mierzy wyniki przez ffprobe, a na koniec przechodzi strone w przegladarce
// od wklejenia linku do pobrania pliku.

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const projectDir = path.join(__dirname, "..", "..");
const downloadsDir = path.join(projectDir, "downloads");
const videoUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";
const fullDuration = 33;        // dlugosc filmu testowego w sekundach
const pinUrl = "https://pl.pinterest.com/pin/1028720739878379354/";      // UL-8c: pin z filmem (Pinterest)
const pinDuration = 5;          // dlugosc filmu z pina w sekundach
const trimStart = "5";
const trimEnd = "0:12";
const trimDuration = 7;

const cleanFirst = process.argv.includes("--wyczysc");
const skipBrowser = process.argv.includes("--bez-przegladarki");

const results = [];     // { name, ok, details }

function check(name, ok, details = "") {
    results.push({ name, ok: Boolean(ok), details });
    console.log(`${ok ? "OK  " : "BLAD"} ${name}${details ? ` (${details})` : ""}`);
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();

        probe.on("error", reject);
        probe.listen(0, "127.0.0.1", () => {
            const { port } = probe.address();

            probe.close(() => resolve(port));
        });
    });
}

// uruchamia prawdziwy program i czeka, az wypisze swoj adres
function startProgram(port) {
    return new Promise((resolve, reject) => {
        const program = { stdout: "", stderr: "", exitCode: null, child: null };
        const child = spawn(process.execPath, ["app.js"], {
            cwd: projectDir,
            env: { ...process.env, PORT: String(port) }
        });
        const timer = setTimeout(() => reject(new Error("Program nie wystartowal w 30 s.")), 30000);

        program.child = child;

        child.stdout.on("data", (data) => {
            program.stdout += data.toString();

            if (program.stdout.includes(`http://localhost:${port}`)) {
                clearTimeout(timer);
                resolve(program);
            }
        });
        child.stderr.on("data", (data) => { program.stderr += data.toString(); });
        child.on("error", reject);
        child.on("close", (code) => { program.exitCode = code; });
    });
}

function stopProgram(program) {
    return new Promise((resolve) => {
        if (program.exitCode !== null) {
            return resolve();
        }

        program.child.on("close", () => resolve());
        program.child.kill();
    });
}

function probe(filePath) {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", filePath], { encoding: "utf8" });

    if (result.status !== 0) {
        return null;
    }

    const data = JSON.parse(result.stdout);
    const streams = data.streams || [];

    return {
        container: data.format.format_name,
        duration: Number(data.format.duration),
        video: streams.find(stream => stream.codec_type === "video") || null,
        audio: streams.find(stream => stream.codec_type === "audio") || null
    };
}

// pelne dekodowanie pliku; zwraca to, co ffmpeg wypisal jako bledy (pusty napis = bez bledow)
function decodeErrors(filePath) {
    const result = spawnSync("ffmpeg", ["-v", "error", "-i", filePath, "-f", "null", "-"], { encoding: "utf8" });

    return `${result.status === 0 ? "" : `kod ${result.status} `}${result.stderr || ""}`.trim();
}

function near(value, expected, tolerance) {
    return Number.isFinite(value) && Math.abs(value - expected) <= tolerance;
}

// sprawdza jeden plik wynikowy. expected: { ext, video: kodek albo null, audio: kodek albo null, duration, tolerance, sampleRate, channels, maxHeight }
function checkFile(label, fileName, expected) {
    const filePath = path.join(downloadsDir, fileName);

    check(`${label}: plik istnieje w downloads`, fs.existsSync(filePath), fileName);

    if (!fs.existsSync(filePath)) {
        return;
    }

    check(`${label}: nazwa bez tmp- i processed-, z rozszerzeniem .${expected.ext}`,
        !fileName.startsWith("tmp-") && !fileName.startsWith("processed-") && fileName.endsWith(`.${expected.ext}`), fileName);
    check(`${label}: nazwa ma 8-znakowy identyfikator`, /\[[0-9a-f]{8}\]\.[a-z0-9]+$/.test(fileName));

    const info = probe(filePath);

    check(`${label}: ffprobe czyta plik`, info !== null);

    if (!info) {
        return;
    }

    check(`${label}: dlugosc ${expected.duration} s`, near(info.duration, expected.duration, expected.tolerance), `${info.duration.toFixed(3)} s`);

    if (expected.video) {
        check(`${label}: obraz ${expected.video}`, info.video && info.video.codec_name === expected.video, info.video ? `${info.video.codec_name} ${info.video.width}x${info.video.height}` : "brak obrazu");

        if (info.video && expected.maxHeight) {
            // film testowy jest pionowy, wiec limit rozdzielczosci dotyczy krotszego boku
            check(`${label}: rozdzielczosc najwyzej ${expected.maxHeight}p`, Math.min(info.video.width, info.video.height) <= expected.maxHeight, `${info.video.width}x${info.video.height}`);
        }
    } else {
        check(`${label}: bez obrazu`, info.video === null || info.video.disposition?.attached_pic === 1);
    }

    if (expected.audio) {
        check(`${label}: dzwiek ${expected.audio}`, info.audio && info.audio.codec_name === expected.audio, info.audio ? info.audio.codec_name : "brak dzwieku");

        if (info.audio && expected.sampleRate) {
            check(`${label}: sample rate ${expected.sampleRate}`, Number(info.audio.sample_rate) === expected.sampleRate, info.audio.sample_rate);
        }

        if (info.audio && expected.channels) {
            check(`${label}: liczba kanalow ${expected.channels}`, info.audio.channels === expected.channels, String(info.audio.channels));
        }

        if (info.audio && info.audio.duration) {
            check(`${label}: dlugosc sciezki dzwieku ${expected.duration} s`, near(Number(info.audio.duration), expected.duration, expected.tolerance), `${Number(info.audio.duration).toFixed(3)} s`);
        }
    } else {
        check(`${label}: bez dzwieku`, info.audio === null);
    }

    if (info.video && info.video.duration) {
        check(`${label}: dlugosc sciezki obrazu ${expected.duration} s`, near(Number(info.video.duration), expected.duration, expected.tolerance), `${Number(info.video.duration).toFixed(3)} s`);
    }

    const errors = decodeErrors(filePath);

    check(`${label}: ffmpeg dekoduje caly plik bez bledow`, errors === "", errors.slice(0, 200));
}

// pobiera plik spod adresu z odpowiedzi i porownuje rozmiar z plikiem w downloads
async function checkUrl(label, baseUrl, file) {
    const response = await fetch(`${baseUrl}${file.url}`);
    const body = Buffer.from(await response.arrayBuffer());
    const filePath = path.join(downloadsDir, file.name);
    const size = fs.existsSync(filePath) ? fs.statSync(filePath).size : -1;

    check(`${label}: GET pod adres z odpowiedzi zwraca 200 i caly plik`, response.status === 200 && body.length === size && size > 0, `HTTP ${response.status}, ${body.length} B`);
}

const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const withEffects = { bitcrush: 8, sampleRate: "22050", channels: "mono", normalize: true, trimStart, trimEnd };

// lista pobran: po jednym w kazdym trybie bez efektow i po jednym z efektami i przycieciem
const downloads = [
    {
        label: "audio mp3 bez efektow",
        body: { url: videoUrl, type: "audio", bitrate: "best", resolution: "720", format: "mp3", experimental: noEffects },
        files: [{ ext: "mp3", video: null, audio: "mp3", duration: fullDuration, tolerance: 1 }]
    },
    {
        label: "film mp4 720p bez efektow",
        body: { url: videoUrl, type: "video", bitrate: "best", resolution: "720", format: "mp4", experimental: noEffects },
        files: [{ ext: "mp4", video: "h264", audio: "aac", duration: fullDuration, tolerance: 1, maxHeight: 720 }]
    },
    {
        label: "osobno mp4 720p bez efektow",
        body: { url: videoUrl, type: "separate", bitrate: "best", resolution: "720", format: "mp4", experimental: noEffects },
        files: [
            { ext: "mp4", video: "h264", audio: null, duration: fullDuration, tolerance: 1, maxHeight: 720 },
            { ext: "mp3", video: null, audio: "mp3", duration: fullDuration, tolerance: 1 }
        ]
    },
    {
        label: "audio mp3 256 z efektami i przycieciem",
        effects: true,
        body: { url: videoUrl, type: "audio", bitrate: "256", resolution: "720", format: "mp3", experimental: withEffects },
        files: [{ ext: "mp3", video: null, audio: "mp3", duration: trimDuration, tolerance: 0.15, sampleRate: 22050, channels: 1 }]
    },
    {
        label: "film mp4 720p z efektami i przycieciem",
        effects: true,
        body: { url: videoUrl, type: "video", bitrate: "best", resolution: "720", format: "mp4", experimental: withEffects },
        files: [{ ext: "mp4", video: "h264", audio: "aac", duration: trimDuration, tolerance: 0.15, maxHeight: 720, sampleRate: 22050, channels: 1 }]
    },
    {
        label: "osobno mp4 720p z efektami i przycieciem",
        effects: true,
        body: { url: videoUrl, type: "separate", bitrate: "best", resolution: "720", format: "mp4", experimental: withEffects },
        files: [
            { ext: "mp4", video: "h264", audio: null, duration: trimDuration, tolerance: 0.15, maxHeight: 720 },
            { ext: "mp3", video: null, audio: "mp3", duration: trimDuration, tolerance: 0.15, sampleRate: 22050, channels: 1 }
        ]
    },
    {
        // UL-8c: jedno pobranie pina z Pinteresta (film 576x688, ok. 5 s, z dzwiekiem)
        label: "pin z Pinteresta: film mp4 bez efektow",
        body: { url: pinUrl, type: "video", bitrate: "best", resolution: "best", format: "mp4", experimental: noEffects },
        files: [{ ext: "mp4", video: "h264", audio: "aac", duration: pinDuration, tolerance: 1 }]
    }
];

async function runDownload(baseUrl, program, download, expectedNames) {
    const stdoutBefore = program.stdout.length;
    const response = await fetch(`${baseUrl}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(download.body)
    });
    const result = await response.json().catch(() => null);
    const files = result && Array.isArray(result.files) ? result.files : [];

    check(`${download.label}: odpowiedz 200 z success`, response.status === 200 && result && result.success === true, result ? String(result.message) : `HTTP ${response.status}`);
    check(`${download.label}: liczba plikow w odpowiedzi ${download.files.length}`, files.length === download.files.length, String(files.length));

    for (let index = 0; index < Math.min(files.length, download.files.length); index++) {
        const label = download.files.length > 1 ? `${download.label} [plik ${index + 1}]` : download.label;

        expectedNames.push(files[index].name);
        checkFile(label, files[index].name, download.files[index]);
        await checkUrl(label, baseUrl, files[index]);
    }

    if (download.effects) {
        // bitcrusha nie widac w ffprobe, wiec sprawdzamy filtr w poleceniu ffmpeg wypisanym przez serwer
        const log = program.stdout.slice(stdoutBefore);

        check(`${download.label}: ffmpeg dostal filtry loudnorm, acrusher i aresample=22050`,
            log.includes("loudnorm") && log.includes("acrusher=bits=") && log.includes("aresample=22050"));
    }
}

// strona w przegladarce Edge: od wklejenia linku do pobrania pliku
async function runBrowser(baseUrl, expectedNames) {
    const { chromium } = require("playwright-core");
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    const saveDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-przeglad-"));

    try {
        const page = await browser.newPage({ acceptDownloads: true });
        const pageErrors = [];

        page.on("pageerror", error => pageErrors.push(error.message));
        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent.includes("Połączono z logami backendu.")));

        // zapisuje kazdy napis, jaki pojawil sie na przycisku
        await page.evaluate(() => {
            const label = document.querySelector(".button-text");

            window.buttonTexts = [];
            new MutationObserver(() => window.buttonTexts.push(label.textContent))
                .observe(label, { childList: true, characterData: true, subtree: true });
        });

        // 1) tryb domyslny (audio mp3 best): link, klik, czekanie na "Gotowe"
        await browserDownload(page, "strona: audio mp3", saveDir, expectedNames, async () => {
            await page.fill("#url", videoUrl);
        }, [{ ext: "mp3", video: null, audio: "mp3", duration: fullDuration, tolerance: 1 }]);

        const texts = await page.evaluate(() => window.buttonTexts);

        check("strona: na przycisku byl procent pobierania", texts.some(text => /^Pobieram\.\.\. \d+%$/.test(text)), texts.slice(0, 6).join(" | "));
        check("strona: po pobraniu przycisk wraca do Pobierz i jest aktywny",
            (await page.textContent(".button-text")) === "Pobierz" && !(await page.isDisabled("#downloadButton")));

        // 2) film z dzwiekiem + panel EXPERIMENTAL: normalizacja i przyciecie 5-12
        await page.evaluate(() => { window.buttonTexts = []; });
        await browserDownload(page, "strona: film mp4 z normalizacja i przycieciem", saveDir, expectedNames, async () => {
            await page.click('.choice:has(input[value="video"]) span');
            await page.selectOption("#resolution", "720");
            await page.selectOption("#format", "mp4");
            await page.click("#experimentalToggle");
            await page.waitForFunction(() => document.querySelector("#workspace").classList.contains("is-experimental-open"));
            await page.check("#normalize");
            await page.fill("#trimStart", trimStart);
            await page.fill("#trimEnd", trimEnd);
        }, [{ ext: "mp4", video: "h264", audio: "aac", duration: trimDuration, tolerance: 0.15, maxHeight: 720 }]);

        check("strona: przy efektach na przycisku bylo Przetwarzam...", (await page.evaluate(() => window.buttonTexts)).includes("Przetwarzam..."));
        check("strona: brak bledow skryptu", pageErrors.length === 0, pageErrors.join("; "));
        check("strona: w tle nie ma linii [error]", !(await page.evaluate(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent.startsWith("[error]")))));
    } finally {
        await browser.close();
        fs.rmSync(saveDir, { recursive: true, force: true });
    }
}

// jedno pobranie na stronie: ustawienie formularza, klik "Pobierz", pole statusu, plik zapisany przez przegladarke
async function browserDownload(page, label, saveDir, expectedNames, fillForm, expectedFiles) {
    await fillForm();

    const downloadEvent = page.waitForEvent("download", { timeout: 300000 });

    await page.click("#downloadButton");

    const browserFile = await downloadEvent;
    const savedPath = path.join(saveDir, browserFile.suggestedFilename());

    await browserFile.saveAs(savedPath);
    await page.waitForFunction(() => document.querySelector("#statusBox p")?.textContent === "Gotowe");

    const links = await page.$$eval("#statusBox a", anchors => anchors.map(anchor => ({ name: anchor.textContent, href: anchor.getAttribute("href") })));

    check(`${label}: pole statusu pokazuje Gotowe i ${expectedFiles.length} link`, links.length === expectedFiles.length && !(await page.evaluate(() => document.querySelector("#statusBox").classList.contains("hidden"))));

    if (links.length === 0) {
        return;
    }

    expectedNames.push(links[0].name);
    checkFile(label, links[0].name, expectedFiles[0]);
    check(`${label}: przegladarka zapisala plik pod nazwa z pola statusu`, browserFile.suggestedFilename() === links[0].name, browserFile.suggestedFilename());
    check(`${label}: plik zapisany przez przegladarke jest taki sam jak w downloads`,
        fs.readFileSync(savedPath).equals(fs.readFileSync(path.join(downloadsDir, links[0].name))));
}

// szuka w konsoli serwera sladow nieobsluzonych wyjatkow
function checkConsole(program) {
    const text = `${program.stdout}\n${program.stderr}`;
    const patterns = [/unhandled/i, /uncaught/i, /^\s+at .+:\d+:\d+\)?\s*$/m, /\b(TypeError|ReferenceError|RangeError|SyntaxError)\b/, /Traceback \(most recent call last\)/];
    const found = patterns.filter(pattern => pattern.test(text)).map(String);

    check("konsola serwera: brak nieobsluzonych wyjatkow i sladow stosu", found.length === 0, found.join(", "));
    check("konsola serwera: program dziala do konca przegladu", program.exitCode === null, program.exitCode === null ? "" : `kod wyjscia ${program.exitCode}`);
    check("konsola serwera: kazde wywolanie yt-dlp i ffmpeg skonczylo sie kodem 0", !/CLOSE CODE: (?!0\b)/.test(program.stdout));
}

async function main() {
    fs.mkdirSync(downloadsDir, { recursive: true });

    if (cleanFirst) {
        fs.readdirSync(downloadsDir).forEach(name => fs.rmSync(path.join(downloadsDir, name), { force: true }));
    }

    const leftovers = fs.readdirSync(downloadsDir);

    if (leftovers.length > 0) {
        console.error(`Folder downloads nie jest pusty (${leftovers.length} plikow). Oproznij go albo uruchom skrypt z opcja --wyczysc.`);
        process.exit(2);
    }

    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const program = await startProgram(port);
    const expectedNames = [];

    try {
        for (const download of downloads) {
            await runDownload(baseUrl, program, download, expectedNames);
        }

        if (skipBrowser) {
            console.log("POMINIETO czesc w przegladarce (--bez-przegladarki)");
        } else {
            await runBrowser(baseUrl, expectedNames);
        }

        const present = fs.readdirSync(downloadsDir).sort();

        check("downloads: sa tylko pliki wynikowe (bez oryginalow, plikow tymczasowych i .part)",
            JSON.stringify(present) === JSON.stringify([...expectedNames].sort()), `${present.length} plikow, oczekiwane ${expectedNames.length}`);
        checkConsole(program);
    } catch (error) {
        check("przeglad doszedl do konca", false, error.stack || String(error));
    } finally {
        await stopProgram(program);
        fs.writeFileSync(path.join(os.tmpdir(), "pobierak-przeglad-konsola.log"), `--- stdout ---\n${program.stdout}\n--- stderr ---\n${program.stderr}`);
    }

    const failed = results.filter(result => !result.ok);

    console.log(`\nSprawdzen: ${results.length}, bledow: ${failed.length}. Konsola serwera: ${path.join(os.tmpdir(), "pobierak-przeglad-konsola.log")}`);
    failed.forEach(result => console.log(`BLAD ${result.name}${result.details ? ` (${result.details})` : ""}`));
    process.exit(failed.length === 0 ? 0 : 1);
}

main();
