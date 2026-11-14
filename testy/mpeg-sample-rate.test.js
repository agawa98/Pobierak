// Testy zadania B7: MPEG przy niskim sample rate (addVideoCodecArgs, galaz "mpeg"; przekazanie sample rate z processDownloadedFile).
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
const { addVideoCodecArgs, processDownloadedFile } = appModule;

// wszystkie wartosci, ktore przepuszcza walidacja serwera (allowedSampleRates w app.js)
const lowSampleRates = ["8000", "11025", "12000", "16000", "22050", "24000"];
const highSampleRates = ["32000", "44100", "48000", "default"];

function expectedBitrate(sampleRate) {
    return lowSampleRates.includes(sampleRate) ? "128k" : "192k";
}

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

// wyciaga z argumentow wszystkie pary opcji bitrate/jakosci audio, np. [["-b:a", "128k"]]
function audioBitratePairs(args) {
    const pairs = [];

    args.forEach((arg, index) => {
        if (arg === "-b:a" || arg === "-q:a" || arg === "-ab" || arg === "-aq") {
            pairs.push([arg, args[index + 1]]);
        }
    });

    return pairs;
}

// ---------- addVideoCodecArgs ----------

test("B7: lista sample rate w tescie to dokladnie lista dopuszczana przez serwer", () => {
    const source = fs.readFileSync(appPath, "utf8");
    const match = source.match(/const allowedSampleRates = (\[[^\]]*\]);/);

    assert.ok(match, "nie znaleziono allowedSampleRates w app.js");
    assert.deepEqual(JSON.parse(match[1]).sort(), [...lowSampleRates, ...highSampleRates].sort());
});

for (const sampleRate of lowSampleRates) {
    test(`B7: mpeg + sample rate ${sampleRate} -> mp2 128k`, () => {
        const args = [];
        addVideoCodecArgs(args, "mpeg", "video", sampleRate);

        assert.deepEqual(args, ["-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "128k", "-f", "mpeg"]);
    });
}

for (const sampleRate of highSampleRates) {
    test(`B7: mpeg + sample rate ${sampleRate} -> mp2 192k (jak wczesniej)`, () => {
        const args = [];
        addVideoCodecArgs(args, "mpeg", "video", sampleRate);

        assert.deepEqual(args, ["-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "192k", "-f", "mpeg"]);
    });
}

test("B7: mpeg bez podanego sample rate -> mp2 192k", () => {
    const args = [];
    addVideoCodecArgs(args, "mpeg", "video");

    assert.deepEqual(args, ["-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "192k", "-f", "mpeg"]);
});

test("B7: mpeg bez dzwieku (tryb osobno) - zadnego bitrate audio, przy kazdym sample rate", () => {
    for (const sampleRate of [...lowSampleRates, ...highSampleRates]) {
        const args = [];
        addVideoCodecArgs(args, "mpeg", "videoOnly", sampleRate);

        assert.deepEqual(args, ["-c:v", "mpeg2video", "-q:v", "5", "-an", "-f", "mpeg"]);
    }
});

test("B7: pozostale formaty nie zaleza od sample rate", () => {
    const expected = {
        mp4: ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"],
        mjpeg: ["-c:v", "mjpeg", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "avi"],
        mkv: ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]
    };

    for (const [format, expectedArgs] of Object.entries(expected)) {
        for (const sampleRate of ["8000", "24000", "48000", "default"]) {
            const args = [];
            addVideoCodecArgs(args, format, "video", sampleRate);

            assert.deepEqual(args, expectedArgs, `${format} + ${sampleRate}`);
        }
    }
});

test("B7: funkcja dopisuje do przekazanej tablicy i nie rusza tego, co juz w niej bylo", () => {
    const args = ["-y", "-i", "wejscie.mp4"];
    addVideoCodecArgs(args, "mpeg", "video", "16000");

    assert.deepEqual(args, ["-y", "-i", "wejscie.mp4", "-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "128k", "-f", "mpeg"]);
});

// ---------- to, co naprawde dostaje ffmpeg (processDownloadedFile) ----------

// zwraca argumenty jedynego wywolania ffmpeg. atrapa spawn niczego nie tworzy
async function ffmpegArgsFor(processOptions) {
    calls.length = 0;

    await processDownloadedFile({ trimStartSeconds: null, trimEndSeconds: null, bitrate: "best", ...processOptions });

    assert.equal(calls.length, 1, "ffmpeg ma byc uruchomiony jeden raz");
    assert.equal(calls[0].command, appModule.ffmpegPath);

    return calls[0].args;
}

for (const sampleRate of [...lowSampleRates, ...highSampleRates]) {
    test(`B7: film mpeg + sample rate ${sampleRate} - ffmpeg dostaje -b:a ${expectedBitrate(sampleRate)} i nic wiecej o bitrate audio`, async () => {
        const args = await ffmpegArgsFor({
            generatedFile: "brak takiego pliku [b7test00].mp4",
            experimental: options({ sampleRate }),
            mediaType: "video",
            format: "mpeg"
        });

        assert.deepEqual(audioBitratePairs(args), [["-b:a", expectedBitrate(sampleRate)]]);
        assert.equal(args[args.indexOf("-c:a") + 1], "mp2");

        if (sampleRate === "default") {
            assert.equal(args.indexOf("-af"), -1);
        } else {
            assert.equal(args[args.indexOf("-af") + 1], `aresample=${sampleRate},aformat=sample_fmts=s16`);
        }
    });
}

test("B7: film mpeg + niski sample rate razem z innymi efektami - dalej 128k", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b7test00].mp4",
        experimental: options({ sampleRate: "16000", normalize: true, channels: "mono", bitcrush: 4 }),
        mediaType: "video",
        format: "mpeg"
    });

    assert.deepEqual(audioBitratePairs(args), [["-b:a", "128k"]]);
});

test("B7: film mpeg + normalizacja bez wybranego sample rate (wynik 48000 Hz) - 192k", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b7test00].mp4",
        experimental: options({ normalize: true }),
        mediaType: "video",
        format: "mpeg"
    });

    assert.deepEqual(audioBitratePairs(args), [["-b:a", "192k"]]);
});

test("B7: bitrate stoi po pliku wejsciowym i przed plikiem wynikowym", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b7test00].mp4",
        experimental: options({ sampleRate: "8000" }),
        mediaType: "video",
        format: "mpeg"
    });

    const bitrateIndex = args.indexOf("-b:a");

    assert.ok(bitrateIndex > args.indexOf("-i") + 1);
    assert.ok(bitrateIndex + 1 < args.length - 1);
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, "tmp-brak takiego pliku [b7test00].mpeg"));
});

test("B7: film mjpeg + niski sample rate - bez zmian (mp3 192k)", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b7test00].mp4",
        experimental: options({ sampleRate: "8000" }),
        mediaType: "video",
        format: "mjpeg"
    });

    assert.deepEqual(audioBitratePairs(args), [["-b:a", "192k"]]);
});

test("B7: film mp4 i mkv + niski sample rate - bez zmian (aac 192k)", async () => {
    for (const format of ["mp4", "mkv"]) {
        const args = await ffmpegArgsFor({
            generatedFile: `brak takiego pliku [b7test00].${format}`,
            experimental: options({ sampleRate: "8000" }),
            mediaType: "video",
            format
        });

        assert.deepEqual(audioBitratePairs(args), [["-b:a", "192k"]], format);
    }
});

test("B7: tryb osobno, wideo mpeg + niski sample rate - bez dzwieku i bez bitrate audio", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku video [b7test00].mp4",
        experimental: options({ sampleRate: "8000" }),
        mediaType: "videoOnly",
        format: "mpeg"
    });

    assert.deepEqual(audioBitratePairs(args), []);
    assert.ok(args.includes("-an"));
});

// ---------- cala droga przez POST /api/download (yt-dlp i ffmpeg to atrapy) ----------

// podstawia liste plikow folderu downloads: pliki "pobrane" przez atrape yt-dlp powstaja z szablonu -o
function fakeDownloads(t, extension) {
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) !== path.resolve(appModule.downloadsDir)) {
            return originalReaddirSync(target, ...rest);
        }

        return calls
            .filter(call => call.command === appModule.ytDlpPath)
            .map(call => {
                const template = path.basename(call.args[call.args.indexOf("-o") + 1]);

                return template.replace("%(title).150B", "tytul").replace("%(ext)s", extension);
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

for (const sampleRate of ["8000", "16000", "24000", "32000", "default"]) {
    test(`B7: POST /api/download film mpeg + sample rate ${sampleRate} - ffmpeg dostaje -b:a ${expectedBitrate(sampleRate)}`, async (t) => {
        calls.length = 0;
        fakeDownloads(t, "mp4");

        const { status, json } = await postDownload(t, {
            url: testUrl, type: "video", bitrate: "best", resolution: "best", format: "mpeg",
            experimental: options({ sampleRate })
        });

        assert.equal(status, 200, JSON.stringify(json));

        const ffmpegCalls = calls.filter(call => call.command === appModule.ffmpegPath);

        assert.equal(ffmpegCalls.length, 1);
        assert.deepEqual(audioBitratePairs(ffmpegCalls[0].args), [["-b:a", expectedBitrate(sampleRate)]]);
        assert.match(json.downloadUrl, /\.mpeg$/);
    });
}

// ---------- prawdziwy ffmpeg na probce z generatora ----------

function programWorks(program, versionArg) {
    const result = childProcess.spawnSync(program, [versionArg], { stdio: "ignore" });

    return !result.error && result.status === 0;
}

const ffmpeg = appModule.ffmpegPath;
const haveFfmpeg = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version");
const skip = haveFfmpeg ? false : "brak ffmpeg albo ffprobe";

function probe(filePath, stream, entry) {
    const result = childProcess.spawnSync(
        "ffprobe",
        ["-v", "error", "-select_streams", stream, "-show_entries", entry, "-of", "csv=p=0", filePath],
        { encoding: "utf8" }
    );

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim().split(/\r?\n/)[0].replace(/,+$/, "");
}

let sampleDir = null;
let samplePath = null;

// probka: 2 s obrazu testowego 320x240 z dzwiekiem stereo 44100 Hz (h264 + aac w mp4, jak plik z yt-dlp)
test.before(() => {
    if (!haveFfmpeg) {
        return;
    }

    sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b7-"));
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

// bierze argumenty zlozone przez processDownloadedFile (atrapa spawn), podmienia w nich plik wejsciowy i wynikowy
// na pliki w folderze tymczasowym i uruchamia prawdziwy ffmpeg
async function runRealFfmpeg(experimental, name, changeArgs = (args) => args) {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b7test00].mp4",
        experimental,
        mediaType: "video",
        format: "mpeg"
    });

    const realArgs = [...args];
    const resultPath = path.join(sampleDir, `${name}.mpeg`);

    realArgs[realArgs.indexOf("-i") + 1] = samplePath;
    realArgs[realArgs.length - 1] = resultPath;

    const result = childProcess.spawnSync(ffmpeg, changeArgs(realArgs), { encoding: "utf8" });

    return { status: result.status, stderr: result.stderr, resultPath };
}

test("B7: prawdziwy ffmpeg - stare 192k przy sample rate 16000 konczy sie bledem (to jest naprawiany blad)", { skip }, async () => {
    const { status, stderr } = await runRealFfmpeg(options({ sampleRate: "16000" }), "stary", (args) => {
        const changed = [...args];
        changed[changed.indexOf("-b:a") + 1] = "192k";

        return changed;
    });

    assert.notEqual(status, 0);
    assert.match(stderr, /not allowed in mp2/);
});

for (const sampleRate of [...lowSampleRates, ...highSampleRates]) {
    test(`B7: prawdziwy ffmpeg - film mpeg + sample rate ${sampleRate} konczy sie sukcesem i daje mpeg2video + mp2`, { skip }, async () => {
        const { status, stderr, resultPath } = await runRealFfmpeg(options({ sampleRate }), `wynik-${sampleRate}`);

        assert.equal(status, 0, stderr);
        assert.equal(probe(resultPath, "v:0", "stream=codec_name"), "mpeg2video");
        assert.equal(probe(resultPath, "a:0", "stream=codec_name"), "mp2");
        assert.equal(probe(resultPath, "a:0", "stream=bit_rate"), expectedBitrate(sampleRate) === "128k" ? "128000" : "192000");

        const duration = Number(probe(resultPath, "a:0", "format=duration"));

        assert.ok(duration > 1.5 && duration < 2.6, `dlugosc ${duration} s`);
    });
}

test("B7: prawdziwy ffmpeg - film mpeg + sample rate 16000 + mono + normalizacja + bitcrush konczy sie sukcesem", { skip }, async () => {
    const { status, stderr, resultPath } = await runRealFfmpeg(
        options({ sampleRate: "16000", channels: "mono", normalize: true, bitcrush: 4 }),
        "wynik-efekty"
    );

    assert.equal(status, 0, stderr);
    assert.equal(probe(resultPath, "a:0", "stream=codec_name"), "mp2");
    assert.equal(probe(resultPath, "a:0", "stream=sample_rate"), "16000");
    assert.equal(probe(resultPath, "a:0", "stream=channels"), "1");
});
