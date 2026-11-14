// Testy zadania B6: normalizacja bez 192 kHz (buildAudioFilters).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. Czesc testow podmienia spawn na atrape, ktora zapisuje argumenty.
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
const { buildAudioFilters, processDownloadedFile } = appModule;

const chosenSampleRates = ["8000", "11025", "12000", "16000", "22050", "24000", "32000", "44100", "48000"];
const crusher5 = "volume=3,acrusher=bits=11:samples=11:mix=1:mode=lin:aa=0,volume=0.5";

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

// ---------- buildAudioFilters ----------

test("B6: normalizacja + sample rate default - po loudnorm stoi aresample=48000", () => {
    assert.deepEqual(buildAudioFilters(options({ normalize: true })), ["loudnorm", "aresample=48000"]);
});

for (const sampleRate of chosenSampleRates) {
    test(`B6: normalizacja + wybrany sample rate ${sampleRate} - zostaje aresample z wybrana wartoscia, bez 48000`, () => {
        const expected = ["loudnorm", `aresample=${sampleRate}`, "aformat=sample_fmts=s16"];

        assert.deepEqual(buildAudioFilters(options({ normalize: true, sampleRate })), expected);
    });
}

test("B6: z normalizacja zawsze jest dokladnie jeden aresample i stoi po loudnorm", () => {
    for (const sampleRate of ["default", ...chosenSampleRates]) {
        for (const bitcrush of [0, 5, 15]) {
            const filters = buildAudioFilters(options({ normalize: true, sampleRate, bitcrush }));
            const resamplers = filters.filter(filter => filter.startsWith("aresample"));

            assert.equal(resamplers.length, 1, `sample rate ${sampleRate}, bitcrush ${bitcrush}: ${filters.join(",")}`);
            assert.equal(resamplers[0], `aresample=${sampleRate === "default" ? "48000" : sampleRate}`);
            assert.ok(filters.indexOf("loudnorm") >= 0);
            assert.ok(filters.indexOf(resamplers[0]) > filters.indexOf("loudnorm"), "aresample ma byc po loudnorm");
        }
    }
});

test("B6: bez normalizacji i z sample rate default nie ma aresample", () => {
    assert.deepEqual(buildAudioFilters(options({})), []);
    assert.deepEqual(buildAudioFilters(options({ bitcrush: 5 })), [crusher5, "aformat=sample_fmts=s16"]);
});

test("B6: bez normalizacji wybrany sample rate dziala jak wczesniej", () => {
    assert.deepEqual(buildAudioFilters(options({ sampleRate: "22050" })), ["aresample=22050", "aformat=sample_fmts=s16"]);
    assert.deepEqual(
        buildAudioFilters(options({ sampleRate: "8000", bitcrush: 5 })),
        [crusher5, "aresample=8000", "aformat=sample_fmts=s16"]
    );
});

test("B6: bitcrush + normalizacja + sample rate default - kolejnosc: bitcrush, loudnorm, aresample=48000, aformat", () => {
    assert.deepEqual(
        buildAudioFilters(options({ normalize: true, bitcrush: 5 })),
        [crusher5, "loudnorm", "aresample=48000", "aformat=sample_fmts=s16"]
    );
});

// ---------- to, co naprawde dostaje ffmpeg ----------

// atrapa spawn niczego nie tworzy; processDownloadedFile konczy sie zwyklym zwroceniem nazwy
async function audioFilterPassedToFfmpeg(processOptions) {
    calls.length = 0;

    await processDownloadedFile({ trimStartSeconds: null, trimEndSeconds: null, bitrate: "best", ...processOptions });

    assert.equal(calls.length, 1, "ffmpeg ma byc uruchomiony jeden raz");
    assert.equal(calls[0].command, appModule.ffmpegPath);

    const args = calls[0].args;

    return args.includes("-af") ? args[args.indexOf("-af") + 1] : null;
}

for (const format of ["flac", "wav", "mp3", "m4a"]) {
    test(`B6: audio ${format} + normalizacja - ffmpeg dostaje -af loudnorm,aresample=48000`, async () => {
        const filter = await audioFilterPassedToFfmpeg({
            generatedFile: `brak takiego pliku [b6test00].${format}`,
            experimental: options({ normalize: true }),
            mediaType: "audio",
            format
        });

        assert.equal(filter, "loudnorm,aresample=48000");
    });
}

test("B6: audio flac + normalizacja + wybrany sample rate - ffmpeg dostaje wybrana wartosc", async () => {
    const filter = await audioFilterPassedToFfmpeg({
        generatedFile: "brak takiego pliku [b6test00].flac",
        experimental: options({ normalize: true, sampleRate: "44100" }),
        mediaType: "audio",
        format: "flac"
    });

    assert.equal(filter, "loudnorm,aresample=44100,aformat=sample_fmts=s16");
});

test("B6: film mp4 + normalizacja - ffmpeg dostaje -af loudnorm,aresample=48000", async () => {
    const filter = await audioFilterPassedToFfmpeg({
        generatedFile: "brak takiego pliku [b6test00].mp4",
        experimental: options({ normalize: true }),
        mediaType: "video",
        format: "mp4"
    });

    assert.equal(filter, "loudnorm,aresample=48000");
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

function probeSampleRate(filePath) {
    return run("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate", "-of", "csv=p=0", filePath]).trim();
}

// przepuszcza probke 44,1 kHz przez filtry z buildAudioFilters i zwraca sample rate wyniku
function sampleRateAfterFilters(experimental, extension) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b6-"));

    try {
        const source = path.join(workDir, "probka.wav");
        const result = path.join(workDir, `wynik.${extension}`);

        run(ffmpeg, ["-y", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=3", source]);
        assert.equal(probeSampleRate(source), "44100", "probka ma miec 44,1 kHz");

        const filters = buildAudioFilters(experimental);
        const args = ["-y", "-nostdin", "-v", "error", "-i", source];

        if (filters.length > 0) {
            args.push("-af", filters.join(","));
        }

        run(ffmpeg, [...args, result]);

        return probeSampleRate(result);
    } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
    }
}

for (const extension of ["flac", "wav"]) {
    test(`B6: prawdziwy ffmpeg - ${extension} po normalizacji ma 48000 Hz, nie 192000`, { skip }, () => {
        assert.equal(sampleRateAfterFilters(options({ normalize: true }), extension), "48000");
    });

    test(`B6: prawdziwy ffmpeg - ${extension} po normalizacji i bitcrushu ma 48000 Hz`, { skip }, () => {
        assert.equal(sampleRateAfterFilters(options({ normalize: true, bitcrush: 5 }), extension), "48000");
    });

    test(`B6: prawdziwy ffmpeg - ${extension} po normalizacji z wybranym 22050 ma 22050 Hz`, { skip }, () => {
        assert.equal(sampleRateAfterFilters(options({ normalize: true, sampleRate: "22050" }), extension), "22050");
    });

    test(`B6: prawdziwy ffmpeg - ${extension} bez efektow zachowuje sample rate zrodla`, { skip }, () => {
        assert.equal(sampleRateAfterFilters(options({}), extension), "44100");
    });
}
