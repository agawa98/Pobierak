// Testy zadania B5: jawna jakosc przy przetwarzaniu audio (buildAudioQualityArgs, processDownloadedFile - galaz "audio").
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. Czesc testow podmienia spawn na atrape, ktora zapisuje argumenty.
// Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana.
// Ostatnia czesc uruchamia prawdziwy ffmpeg na probce z generatora (bez internetu); gdy ffmpeg albo ffprobe nie ma, te testy sa pomijane.

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
const { buildAudioQualityArgs, buildAudioFilters, processDownloadedFile } = appModule;

const sliderBitrates = ["16", "32", "64", "128", "256", "320"];

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

// ---------- buildAudioQualityArgs ----------

test("B5: mp3 + best -> -q:a 0", () => {
    assert.deepEqual(buildAudioQualityArgs("mp3", "best"), ["-q:a", "0"]);
});

test("B5: m4a + best -> -b:a 256k", () => {
    assert.deepEqual(buildAudioQualityArgs("m4a", "best"), ["-b:a", "256k"]);
});

for (const bitrate of sliderBitrates) {
    test(`B5: mp3 + ${bitrate} -> -b:a ${bitrate}K`, () => {
        assert.deepEqual(buildAudioQualityArgs("mp3", bitrate), ["-b:a", `${bitrate}K`]);
    });

    test(`B5: m4a + ${bitrate} -> -b:a ${bitrate}K`, () => {
        assert.deepEqual(buildAudioQualityArgs("m4a", bitrate), ["-b:a", `${bitrate}K`]);
    });
}

for (const format of ["wav", "flac"]) {
    test(`B5: ${format} -> zadnych argumentow jakosci, przy kazdym bitrate`, () => {
        for (const bitrate of ["best", ...sliderBitrates]) {
            assert.deepEqual(buildAudioQualityArgs(format, bitrate), []);
        }
    });
}

// ---------- to, co naprawde dostaje ffmpeg (processDownloadedFile) ----------

// zwraca argumenty jedynego wywolania ffmpeg. atrapa spawn niczego nie tworzy
async function ffmpegArgsFor(processOptions) {
    calls.length = 0;

    await processDownloadedFile({ trimStartSeconds: null, trimEndSeconds: null, ...processOptions });

    assert.equal(calls.length, 1, "ffmpeg ma byc uruchomiony jeden raz");
    assert.equal(calls[0].command, appModule.ffmpegPath);

    return calls[0].args;
}

// wyciaga z argumentow wszystkie pary opcji jakosci audio, np. [["-q:a", "0"]]
function qualityPairs(args) {
    const pairs = [];

    args.forEach((arg, index) => {
        if (arg === "-q:a" || arg === "-b:a" || arg === "-ab" || arg === "-aq") {
            pairs.push([arg, args[index + 1]]);
        }
    });

    return pairs;
}

// efekty, z ktorych kazdy osobno wymusza przejscie przez ffmpeg
const effects = {
    "normalizacja": options({ normalize: true }),
    "mono": options({ channels: "mono" }),
    "bitcrush": options({ bitcrush: 5 }),
    "sample rate": options({ sampleRate: "22050" })
};

for (const [effectName, experimental] of Object.entries(effects)) {
    test(`B5: audio mp3 best + ${effectName} - ffmpeg dostaje -q:a 0 i nic wiecej o jakosci`, async () => {
        const args = await ffmpegArgsFor({
            generatedFile: "brak takiego pliku [b5test00].mp3", experimental, mediaType: "audio", format: "mp3", bitrate: "best"
        });

        assert.deepEqual(qualityPairs(args), [["-q:a", "0"]]);
    });

    test(`B5: audio m4a best + ${effectName} - ffmpeg dostaje -b:a 256k`, async () => {
        const args = await ffmpegArgsFor({
            generatedFile: "brak takiego pliku [b5test00].m4a", experimental, mediaType: "audio", format: "m4a", bitrate: "best"
        });

        assert.deepEqual(qualityPairs(args), [["-b:a", "256k"]]);
    });

    test(`B5: audio m4a 256 + ${effectName} - ffmpeg dostaje -b:a 256K`, async () => {
        const args = await ffmpegArgsFor({
            generatedFile: "brak takiego pliku [b5test00].m4a", experimental, mediaType: "audio", format: "m4a", bitrate: "256"
        });

        assert.deepEqual(qualityPairs(args), [["-b:a", "256K"]]);
    });

    test(`B5: audio mp3 320 + ${effectName} - ffmpeg dostaje -b:a 320K (jak wczesniej)`, async () => {
        const args = await ffmpegArgsFor({
            generatedFile: "brak takiego pliku [b5test00].mp3", experimental, mediaType: "audio", format: "mp3", bitrate: "320"
        });

        assert.deepEqual(qualityPairs(args), [["-b:a", "320K"]]);
    });

    for (const format of ["wav", "flac"]) {
        test(`B5: audio ${format} + ${effectName} - ffmpeg nie dostaje zadnej opcji jakosci`, async () => {
            for (const bitrate of ["best", "128"]) {
                const args = await ffmpegArgsFor({
                    generatedFile: `brak takiego pliku [b5test00].${format}`, experimental, mediaType: "audio", format, bitrate
                });

                assert.deepEqual(qualityPairs(args), []);
            }
        });
    }
}

test("B5: opcja jakosci stoi przed plikiem wynikowym (ostatni argument) i po -i", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b5test00].mp3",
        experimental: options({ normalize: true, channels: "mono" }),
        mediaType: "audio",
        format: "mp3",
        bitrate: "best"
    });

    const qualityIndex = args.indexOf("-q:a");

    assert.ok(qualityIndex > args.indexOf("-i") + 1, "opcja jakosci ma byc opcja wyjscia, czyli po pliku wejsciowym");
    assert.ok(qualityIndex + 1 < args.length - 1, "opcja jakosci ma byc przed plikiem wynikowym");
    assert.equal(args[args.length - 1], path.join(appModule.downloadsDir, "tmp-brak takiego pliku [b5test00].mp3"));
    assert.equal(args[args.indexOf("-af") + 1], "loudnorm,aresample=48000");
    assert.equal(args[args.indexOf("-ac") + 1], "1");
});

test("B5: audio bez efektow - ffmpeg w ogole nie jest uruchamiany (jakosc zostaje z yt-dlp)", async () => {
    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        calls.length = 0;

        const result = await processDownloadedFile({
            generatedFile: `brak takiego pliku [b5test00].${format}`,
            experimental: options({}),
            trimStartSeconds: null,
            trimEndSeconds: null,
            mediaType: "audio",
            format,
            bitrate: "best"
        });

        assert.equal(calls.length, 0);
        assert.equal(result, `brak takiego pliku [b5test00].${format}`);
    }
});

test("B5: film mp4 + normalizacja - dzwiek filmu bez zmian (aac 192k), bez -q:a", async () => {
    const args = await ffmpegArgsFor({
        generatedFile: "brak takiego pliku [b5test00].mp4",
        experimental: options({ normalize: true }),
        mediaType: "video",
        format: "mp4",
        bitrate: "best"
    });

    assert.deepEqual(qualityPairs(args), [["-b:a", "192k"]]);
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

function ffmpegCalls() {
    return calls.filter(call => call.command === appModule.ffmpegPath);
}

const endpointCases = [
    { format: "mp3", bitrate: "best", expected: [["-q:a", "0"]] },
    { format: "mp3", bitrate: "128", expected: [["-b:a", "128K"]] },
    { format: "m4a", bitrate: "best", expected: [["-b:a", "256k"]] },
    { format: "m4a", bitrate: "256", expected: [["-b:a", "256K"]] },
    { format: "m4a", bitrate: "64", expected: [["-b:a", "64K"]] },
    { format: "wav", bitrate: "best", expected: [] },
    { format: "flac", bitrate: "320", expected: [] }
];

for (const { format, bitrate, expected } of endpointCases) {
    test(`B5: POST /api/download audio ${format} ${bitrate} + normalizacja + mono - jakosc w ffmpeg: ${JSON.stringify(expected)}`, async (t) => {
        calls.length = 0;
        fakeDownloads(t, () => format);

        const { status, json } = await postDownload(t, {
            url: testUrl, type: "audio", bitrate, resolution: "best", format,
            experimental: options({ normalize: true, channels: "mono" })
        });

        assert.equal(status, 200, JSON.stringify(json));
        assert.equal(ffmpegCalls().length, 1);
        assert.deepEqual(qualityPairs(ffmpegCalls()[0].args), expected);
    });
}

test("B5: POST /api/download tryb osobno + normalizacja - sciezka audio (mp3) dostaje -q:a 0, takze gdy suwak bitrate jest na 16", async (t) => {
    calls.length = 0;
    fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mkv"));

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "separate", bitrate: "16", resolution: "best", format: "mkv",
        experimental: options({ normalize: true })
    });

    assert.equal(status, 200, JSON.stringify(json));

    // wideo mkv w trybie osobno nie wymaga ffmpeg, wiec jedyne wywolanie ffmpeg to sciezka audio
    const audioCalls = ffmpegCalls().filter(call => call.args[call.args.length - 1].endsWith(".mp3"));

    assert.equal(audioCalls.length, 1);
    assert.deepEqual(qualityPairs(audioCalls[0].args), [["-q:a", "0"]]);
});

// ---------- prawdziwy ffmpeg na probce z generatora ----------

function programWorks(program, versionArg) {
    const result = childProcess.spawnSync(program, [versionArg], { stdio: "ignore" });

    return !result.error && result.status === 0;
}

const ffmpeg = appModule.ffmpegPath;
const haveFfmpeg = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version");
const skip = haveFfmpeg ? false : "brak ffmpeg albo ffprobe";

function run(program, args) {
    const result = childProcess.spawnSync(program, args, { encoding: "utf8" });

    assert.equal(result.status, 0, `${program} ${args.join(" ")}\n${result.stderr}`);

    return result.stdout;
}

function probe(filePath, entry) {
    return run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", entry, "-of", "csv=p=0", filePath]).trim();
}

// robi probke (rozowy szum stereo, 10 s - szum nie daje sie latwo skompresowac, wiec VBR nie zaniza bitrate),
// przepuszcza ja przez ffmpeg z argumentami takimi, jakie sklada galaz "audio" i zwraca bitrate wyniku w kb/s
function bitrateAfterProcessing(format, bitrate, experimental, useQualityArgs = true) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b5-"));

    try {
        const source = path.join(workDir, "probka.wav");
        const result = path.join(workDir, `wynik.${format}`);

        // dwa niezalezne szumy jako lewy i prawy kanal (ten sam szum w obu kanalach mp3 koduje duzo taniej)
        run(ffmpeg, [
            "-y", "-nostdin", "-v", "error",
            "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:duration=10:seed=1",
            "-f", "lavfi", "-i", "anoisesrc=color=pink:sample_rate=44100:duration=10:seed=2",
            "-filter_complex", "[0:a][1:a]amerge=inputs=2",
            source
        ]);

        const args = ["-y", "-nostdin", "-v", "error", "-i", source];
        const filters = buildAudioFilters(experimental);

        if (filters.length > 0) {
            args.push("-af", filters.join(","));
        }

        if (experimental.channels === "mono") {
            args.push("-ac", "1");
        }

        if (useQualityArgs) {
            args.push(...buildAudioQualityArgs(format, bitrate));
        }

        run(ffmpeg, [...args, result]);

        return {
            kbps: Number(probe(result, "format=bit_rate")) / 1000,
            channels: probe(result, "stream=channels")
        };
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

test("B5: prawdziwy ffmpeg - bez opcji jakosci mp3 i m4a wychodza ok. 128 kb/s (to jest naprawiany blad)", { skip }, () => {
    const mp3 = bitrateAfterProcessing("mp3", "best", options({ normalize: true }), false);
    const m4a = bitrateAfterProcessing("m4a", "best", options({ normalize: true }), false);

    assert.ok(mp3.kbps < 150, `mp3 bez opcji jakosci: ${mp3.kbps} kb/s`);
    assert.ok(m4a.kbps < 150, `m4a bez opcji jakosci: ${m4a.kbps} kb/s`);
});

test("B5: prawdziwy ffmpeg - mp3 best + normalizacja ma bitrate wyraznie powyzej 128 kb/s", { skip }, () => {
    const { kbps, channels } = bitrateAfterProcessing("mp3", "best", options({ normalize: true }));

    assert.ok(kbps > 180, `mp3 best + normalizacja: ${kbps} kb/s`);
    assert.equal(channels, "2");
});

test("B5: prawdziwy ffmpeg - mp3 320 + normalizacja ma ok. 320 kb/s", { skip }, () => {
    const { kbps } = bitrateAfterProcessing("mp3", "320", options({ normalize: true }));

    assert.ok(kbps > 300 && kbps < 340, `mp3 320 + normalizacja: ${kbps} kb/s`);
});

test("B5: prawdziwy ffmpeg - mp3 64 + normalizacja ma ok. 64 kb/s (suwak dziala tez w dol)", { skip }, () => {
    const { kbps } = bitrateAfterProcessing("mp3", "64", options({ normalize: true }));

    assert.ok(kbps > 55 && kbps < 75, `mp3 64 + normalizacja: ${kbps} kb/s`);
});

test("B5: prawdziwy ffmpeg - m4a best + normalizacja ma ok. 256 kb/s", { skip }, () => {
    const { kbps } = bitrateAfterProcessing("m4a", "best", options({ normalize: true }));

    assert.ok(kbps > 200 && kbps < 300, `m4a best + normalizacja: ${kbps} kb/s`);
});

test("B5: prawdziwy ffmpeg - m4a 256 + mono: jeden kanal, bitrate powyzej domyslnego dla mono (ok. 69 kb/s)", { skip }, () => {
    const withQuality = bitrateAfterProcessing("m4a", "256", options({ channels: "mono" }));
    const withoutQuality = bitrateAfterProcessing("m4a", "256", options({ channels: "mono" }), false);

    assert.equal(withQuality.channels, "1");
    assert.ok(withQuality.kbps > 128, `m4a 256 + mono: ${withQuality.kbps} kb/s`);
    assert.ok(withQuality.kbps > withoutQuality.kbps * 1.5, `z opcja ${withQuality.kbps} kb/s, bez opcji ${withoutQuality.kbps} kb/s`);
});
