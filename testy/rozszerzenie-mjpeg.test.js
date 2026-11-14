// Testy zadania B10: MJPEG z rozszerzeniem .avi (buildProcessedFileName).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. Czesc testow podmienia spawn na atrape, ktora zapisuje argumenty.
// Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana.
// Ostatnia czesc uruchamia prawdziwy ffmpeg z argumentami zlozonymi przez processDownloadedFile na probce z generatora
// (bez internetu); gdy ffmpeg albo ffprobe nie ma, te testy sa pomijane.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn (app.js bierze spawn przy require)
function loadApp() {
    const calls = [];
    const originalSpawn = childProcess.spawn;

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();
        setImmediate(() => fake.emit("close", 0));

        return fake;
    };

    delete require.cache[require.resolve(appPath)];

    try {
        return { appModule: require(appPath), calls };
    } finally {
        childProcess.spawn = originalSpawn;
    }
}

const { appModule, calls } = loadApp();
const { buildProcessedFileName, processDownloadedFile } = appModule;

// B13g: ffmpeg pisze do pliku "tmp-<nazwa>", a program po sukcesie zmienia mu nazwe na koncowa.
// atrapa spawn niczego nie tworzy, wiec zmiana nazwy w folderze downloads jest tu podstawiana (nic nie jest zapisywane)
const originalRenameSync = fs.renameSync;

fs.renameSync = (from, to) => {
    if (path.resolve(path.dirname(String(from))) === path.resolve(appModule.downloadsDir)) {
        return;
    }

    return originalRenameSync(from, to);
};

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

// ---------- buildProcessedFileName ----------

test("B10: film mjpeg -> plik wynikowy z rozszerzeniem .avi", () => {
    assert.equal(buildProcessedFileName("tytul [abcd1234].mp4", "mjpeg", "video"), "tytul [abcd1234].avi");
});

test("B10: tryb osobno, wideo mjpeg -> plik wynikowy z rozszerzeniem .avi", () => {
    assert.equal(buildProcessedFileName("tytul video [abcd1234].mp4", "mjpeg", "videoOnly"), "tytul video [abcd1234].avi");
    assert.equal(buildProcessedFileName("tytul video [abcd1234].webm", "mjpeg", "videoOnly"), "tytul video [abcd1234].avi");
});

test("B10: pozostale formaty wideo dostaja rozszerzenie rowne nazwie formatu (bez zmian)", () => {
    for (const mediaType of ["video", "videoOnly"]) {
        for (const format of ["mp4", "mpeg", "mkv"]) {
            assert.equal(
                buildProcessedFileName("tytul [abcd1234].webm", format, mediaType),
                `tytul [abcd1234].${format}`,
                `${format} + ${mediaType}`
            );
        }
    }
});

test("B10: audio zachowuje nazwe pobranego pliku (bez zmian)", () => {
    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        assert.equal(buildProcessedFileName(`tytul [abcd1234].${format}`, format, "audio"), `tytul [abcd1234].${format}`);
    }
});

test("B10: kropki i slowo mjpeg w tytule nie psuja nazwy - zmienia sie tylko ostatnie rozszerzenie", () => {
    assert.equal(
        buildProcessedFileName("film.mjpeg v1.2 [abcd1234].mp4", "mjpeg", "video"),
        "film.mjpeg v1.2 [abcd1234].avi"
    );
    assert.equal(
        buildProcessedFileName("film.mjpeg v1.2 [abcd1234].mp4", "mp4", "video"),
        "film.mjpeg v1.2 [abcd1234].mp4"
    );
});

test("B10: lista formatow i walidacja bez zmian - wartosc dalej nazywa sie mjpeg, avi nie jest formatem", () => {
    const source = fs.readFileSync(appPath, "utf8");
    const match = source.match(/const allowedVideoFormats = (\[[^\]]*\]);/);

    assert.ok(match, "nie znaleziono allowedVideoFormats w app.js");
    assert.deepEqual(JSON.parse(match[1]), ["mp4", "mpeg", "mjpeg", "mkv"]);

    const pageSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");
    const pageMatch = pageSource.match(/const videoFormats = (\[[^\]]*\]);/);

    assert.ok(pageMatch, "nie znaleziono videoFormats w public/script.js");
    assert.deepEqual(JSON.parse(pageMatch[1]), ["mp4", "mpeg", "mjpeg", "mkv"]);
});

// ---------- to, co naprawde dostaje ffmpeg (processDownloadedFile) ----------

// zwraca argumenty jedynego wywolania ffmpeg i nazwe zwrocona przez funkcje. atrapa spawn niczego nie tworzy
async function runProcessing(processOptions) {
    calls.length = 0;

    const finalFile = await processDownloadedFile({ trimStartSeconds: null, trimEndSeconds: null, bitrate: "best", ...processOptions });

    assert.equal(calls.length, 1, "ffmpeg ma byc uruchomiony jeden raz");
    assert.equal(calls[0].command, appModule.ffmpegPath);

    return { args: calls[0].args, finalFile };
}

test("B10: film mjpeg - ffmpeg pisze do pliku .avi w kontenerze avi z kodekiem mjpeg, funkcja zwraca te sama nazwe", async () => {
    const { args, finalFile } = await runProcessing({
        generatedFile: "brak takiego pliku [b10test0].mp4",
        experimental: options(),
        mediaType: "video",
        format: "mjpeg"
    });

    assert.equal(finalFile, "brak takiego pliku [b10test0].avi");
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, `tmp-${finalFile}`));
    assert.equal(args[args.indexOf("-f") + 1], "avi");
    assert.equal(args[args.indexOf("-c:v") + 1], "mjpeg");
    assert.equal(args[args.indexOf("-i") + 1], path.join(appModule.downloadsDir, "brak takiego pliku [b10test0].mp4"));
});

test("B10: film mjpeg z efektami audio - dalej .avi", async () => {
    const { args, finalFile } = await runProcessing({
        generatedFile: "brak takiego pliku [b10test0].mp4",
        experimental: options({ normalize: true, channels: "mono", bitcrush: 4, sampleRate: "16000" }),
        mediaType: "video",
        format: "mjpeg"
    });

    assert.equal(finalFile, "brak takiego pliku [b10test0].avi");
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, `tmp-${finalFile}`));
});

test("B10: tryb osobno, wideo mjpeg - ffmpeg pisze do pliku .avi bez dzwieku", async () => {
    const { args, finalFile } = await runProcessing({
        generatedFile: "brak takiego pliku video [b10test0].mp4",
        experimental: options(),
        mediaType: "videoOnly",
        format: "mjpeg"
    });

    assert.equal(finalFile, "brak takiego pliku video [b10test0].avi");
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, `tmp-${finalFile}`));
    assert.equal(args[args.indexOf("-f") + 1], "avi");
    assert.ok(args.includes("-an"));
});

test("B10: film mpeg dalej dostaje rozszerzenie .mpeg", async () => {
    const { args, finalFile } = await runProcessing({
        generatedFile: "brak takiego pliku [b10test0].mp4",
        experimental: options(),
        mediaType: "video",
        format: "mpeg"
    });

    assert.equal(finalFile, "brak takiego pliku [b10test0].mpeg");
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, `tmp-${finalFile}`));
});

// ---------- cala droga przez POST /api/download (yt-dlp i ffmpeg to atrapy) ----------

// podstawia liste plikow folderu downloads: pliki "pobrane" przez atrape yt-dlp powstaja z szablonu -o
function fakeDownloads(t, extensionFor) {
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) !== path.resolve(appModule.downloadsDir)) {
            return originalReaddirSync(target, ...rest);
        }

        return calls
            .filter(call => call.command === appModule.ytDlpPath)
            .map(call => {
                const template = path.basename(call.args[call.args.indexOf("-o") + 1]);

                return template.replace("%(title).150B", "tytul").replace("%(ext)s", extensionFor(call.args));
            });
    });
}

async function postDownload(t, body) {
    const server = await new Promise((resolve) => {
        const created = appModule.app.listen(0, "127.0.0.1", () => resolve(created));
    });

    t.after(() => server.close());

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)      // gdyby serwer nie odpowiedzial, test pada zamiast wisiec
    });

    return { status: response.status, json: await response.json() };
}

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

test("B10: POST /api/download film mjpeg - adres w odpowiedzi konczy sie na .avi, yt-dlp dalej laczy do mp4", async (t) => {
    calls.length = 0;
    fakeDownloads(t, () => "mp4");

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "video", bitrate: "best", resolution: "best", format: "mjpeg",
        experimental: options()
    });

    assert.equal(status, 200, JSON.stringify(json));
    // B2: nazwa pliku w adresie jest zakodowana, wiec przed porownaniem jest odkodowywana
    assert.match(decodeURIComponent(json.downloadUrl), /^\/downloads\/tytul \[[0-9a-f]{8}\]\.avi$/);
    assert.equal(json.receivedData.format, "mjpeg");

    const ytDlpCalls = calls.filter(call => call.command === appModule.ytDlpPath);
    const ffmpegCalls = calls.filter(call => call.command === appModule.ffmpegPath);

    assert.equal(ytDlpCalls.length, 1);
    assert.equal(ytDlpCalls[0].args[ytDlpCalls[0].args.indexOf("--merge-output-format") + 1], "mp4");
    assert.equal(ffmpegCalls.length, 1);
    assert.match(ffmpegCalls[0].args[ffmpegCalls[0].args.length - 1], /\.avi$/);
});

test("B10: POST /api/download tryb osobno mjpeg - wideo .avi, audio dalej .mp3", async (t) => {
    calls.length = 0;
    fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mp4"));

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "separate", bitrate: "best", resolution: "best", format: "mjpeg",
        experimental: options()
    });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.downloadUrls.length, 2);
    // B2: nazwy plikow w adresach sa zakodowane, wiec przed porownaniem sa odkodowywane
    assert.match(decodeURIComponent(json.downloadUrls[0]), /^\/downloads\/tytul video \[[0-9a-f]{8}\]\.avi$/);
    assert.match(decodeURIComponent(json.downloadUrls[1]), /^\/downloads\/tytul audio \[[0-9a-f]{8}\]\.mp3$/);
});

test("B10: POST /api/download z formatem avi jest odrzucany (avi to tylko rozszerzenie, nie opcja)", async (t) => {
    calls.length = 0;

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "video", bitrate: "best", resolution: "best", format: "avi",
        experimental: options()
    });

    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(calls.length, 0);
});

// ---------- prawdziwy ffmpeg na probce z generatora ----------

function programWorks(program, versionArg) {
    const result = childProcess.spawnSync(program, [versionArg], { stdio: "ignore" });

    return !result.error && result.status === 0;
}

const ffmpeg = appModule.ffmpegPath;
const haveFfmpeg = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version");
const skip = haveFfmpeg ? false : "brak ffmpeg albo ffprobe";

function probe(filePath, args) {
    const result = childProcess.spawnSync("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0", filePath], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim().split(/\r?\n/)[0].replace(/,+$/, "");
}

let sampleDir = null;
let samplePath = null;

// probka: 2 s obrazu testowego 320x240 z dzwiekiem stereo 44100 Hz w mp4 (jak plik z yt-dlp)
test.before(() => {
    if (!haveFfmpeg) {
        return;
    }

    sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b10-"));
    samplePath = path.join(sampleDir, "probka.mp4");

    const result = childProcess.spawnSync(ffmpeg, [
        "-y", "-nostdin", "-v", "error",
        "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
        "-filter_complex", "[1:a]pan=stereo|c0=c0|c1=c0[a]",
        "-map", "0:v", "-map", "[a]",
        "-c:v", "mpeg4", "-c:a", "aac", "-shortest",
        samplePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
});

test.after(() => {
    if (sampleDir) {
        fs.rmSync(sampleDir, { recursive: true, force: true });
    }
});

// bierze argumenty zlozone przez processDownloadedFile (atrapa spawn), przenosi plik wejsciowy i wynikowy
// do folderu tymczasowego (nazwa pliku wynikowego zostaje taka, jaka nadal program: "tmp-<koncowa nazwa>") i uruchamia prawdziwy ffmpeg
async function runRealFfmpeg(mediaType, generatedFile) {
    const { args, finalFile } = await runProcessing({
        generatedFile,
        experimental: options(),
        mediaType,
        format: "mjpeg"
    });

    const realArgs = [...args];
    const resultPath = path.join(sampleDir, path.basename(realArgs[realArgs.length - 1]));

    assert.equal(path.basename(resultPath), `tmp-${finalFile}`);

    realArgs[realArgs.indexOf("-i") + 1] = samplePath;
    realArgs[realArgs.length - 1] = resultPath;

    const result = childProcess.spawnSync(ffmpeg, realArgs, { encoding: "utf8" });

    return { status: result.status, stderr: result.stderr, resultPath };
}

test("B10: prawdziwy ffmpeg - film mjpeg daje plik .avi: kontener avi, kodek mjpeg, dzwiek mp3", { skip }, async () => {
    const { status, stderr, resultPath } = await runRealFfmpeg("video", "brak takiego pliku [b10test0].mp4");

    assert.equal(status, 0, stderr);
    assert.equal(path.extname(resultPath), ".avi");
    assert.ok(fs.existsSync(resultPath));
    assert.equal(probe(resultPath, ["-show_entries", "format=format_name"]), "avi");
    assert.equal(probe(resultPath, ["-select_streams", "v:0", "-show_entries", "stream=codec_name"]), "mjpeg");
    assert.equal(probe(resultPath, ["-select_streams", "a:0", "-show_entries", "stream=codec_name"]), "mp3");

    const duration = Number(probe(resultPath, ["-show_entries", "format=duration"]));

    assert.ok(duration > 1.5 && duration < 2.6, `dlugosc ${duration} s`);
});

test("B10: prawdziwy ffmpeg - tryb osobno, wideo mjpeg daje plik .avi: kontener avi, kodek mjpeg, bez dzwieku", { skip }, async () => {
    const { status, stderr, resultPath } = await runRealFfmpeg("videoOnly", "brak takiego pliku video [b10test0].mp4");

    assert.equal(status, 0, stderr);
    assert.equal(path.extname(resultPath), ".avi");
    assert.equal(probe(resultPath, ["-show_entries", "format=format_name"]), "avi");
    assert.equal(probe(resultPath, ["-select_streams", "v:0", "-show_entries", "stream=codec_name"]), "mjpeg");
    assert.equal(probe(resultPath, ["-select_streams", "a", "-show_entries", "stream=codec_name"]), "");
});
