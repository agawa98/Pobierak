// Testy zadania BUG-1b: trwajaca albo zaplanowana transmisja daje osobny komunikat zamiast "nie znaleziono pliku".
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp: spawn jest podmieniony na atrape ze sterowanym stdout, stderr i kodem wyjscia.
// Linia o pominieciu jest skopiowana z prawdziwego uruchomienia yt-dlp 2026.10.26 na trwajacej transmisji YouTube
// (--match-filter "!is_live & !is_upcoming" --simulate): yt-dlp wypisuje ja na stdout i konczy sie kodem 0.

const { folderDocelowy } = require("./folder-docelowy-pomoc");       // UL-2b: zadanie pobrania musi miec pole folder
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

const realSkipLine = "[download] lofi hip hop radio  beats to relax/study to 2026-11-14 23:24 does not pass filter (!is_live & !is_upcoming), skipping ..";

// caly stdout z prawdziwego uruchomienia (bez linii postepu, bo nic nie bylo pobierane)
const realSkipStdout = [
    "[youtube] Extracting URL: https://www.youtube.com/watch?v=rFZHOHl-L8A",
    "[youtube] rFZHOHl-L8A: Downloading webpage",
    "[youtube] rFZHOHl-L8A: Downloading tv samsung player API JSON",
    "[youtube] rFZHOHl-L8A: Downloading visionos player API JSON",
    "[youtube] rFZHOHl-L8A: Downloading m3u8 information",
    realSkipLine,
    ""
].join("\n");

// zwykly film, po ktorym (w atrapie) nie powstaje plik
const normalStdout = [
    "[youtube] Extracting URL: https://www.youtube.com/watch?v=jNQXAC9IVRw",
    "[youtube] jNQXAC9IVRw: Downloading m3u8 information",
    "[info] jNQXAC9IVRw: Downloading 1 format(s): 395+251",
    "[download] 100% of    1.00MiB in 00:00:01 at 1.00MiB/s",
    ""
].join("\n");

const expectedMessage = "To trwająca albo zaplanowana transmisja. Pobrać można dopiero zapis po jej zakończeniu.";

function loadApp(spawnImpl) {
    const originalSpawn = childProcess.spawn;
    const savedEnv = {};

    for (const name of ["YTDLP_PATH", "FFMPEG_PATH"]) {
        savedEnv[name] = process.env[name];
        delete process.env[name];
    }

    if (spawnImpl) {
        childProcess.spawn = spawnImpl;
    }

    delete require.cache[require.resolve(appPath)];

    try {
        return require(appPath);
    } finally {
        childProcess.spawn = originalSpawn;

        for (const name of Object.keys(savedEnv)) {
            if (savedEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = savedEnv[name];
            }
        }
    }
}

// atrapa spawn: kazde wywolanie bierze kolejny scenariusz { stdout: [kawalki], stderr: [kawalki], code }
function makeFakeSpawn(scenarios) {
    const calls = [];

    const spawnImpl = (command, args) => {
        const scenario = scenarios[Math.min(calls.length, scenarios.length - 1)];

        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            for (const chunk of scenario.stdout || []) {
                fake.stdout.emit("data", Buffer.from(chunk));
            }

            for (const chunk of scenario.stderr || []) {
                fake.stderr.emit("data", Buffer.from(chunk));
            }

            fake.emit("close", scenario.code === undefined ? 0 : scenario.code);
        });

        return fake;
    };

    return { spawnImpl, calls };
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

const testUrl = "https://www.youtube.com/watch?v=rFZHOHl-L8A";
const jobId = "test-bug1b-brak-takiego-pliku";

function runMode(app, mode) {
    if (mode === "audio") {
        return app.downloadAudio(testUrl, "mp3", "best", jobId);
    }

    if (mode === "video") {
        return app.downloadVideo(testUrl, "720", "mp4", jobId);
    }

    return app.downloadSeparate(testUrl, "720", "mp4", jobId);
}

async function rejectionOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    assert.fail("pobieranie powinno zakonczyc sie bledem, a zakonczylo sie sukcesem");
}

const realApp = loadApp(null);

// ---------- isFilterSkipLine ----------

test("BUG-1b: isFilterSkipLine rozpoznaje linie z prawdziwego uruchomienia yt-dlp (takze z \\r i spacjami na koncu)", () => {
    assert.equal(realApp.isFilterSkipLine(realSkipLine), true);
    assert.equal(realApp.isFilterSkipLine(realSkipLine + "\r"), true);
    assert.equal(realApp.isFilterSkipLine("  " + realSkipLine + "  "), true);
});

test("BUG-1b: isFilterSkipLine nie rozpoznaje zwyklych linii yt-dlp", () => {
    const lines = [
        "",
        "[youtube] rFZHOHl-L8A: Downloading webpage",
        "[download] Destination: downloads\\abc.webm",
        "[download]  50.0% of   10.00MiB at    1.00MiB/s ETA 00:05",
        "[download] abc.mp4 has already been downloaded",
        "ERROR: [youtube] rFZHOHl-L8A: This live stream recording is not available.",
        "does not pass filter (!is_live & !is_upcoming), skipping .."       // bez [download] na poczatku
    ];

    for (const line of lines) {
        assert.equal(realApp.isFilterSkipLine(line), false, line);
    }
});

test("BUG-1b: filtr i komunikat maja ustalona tresc", () => {
    assert.equal(realApp.liveFilter, "!is_live & !is_upcoming");
    assert.equal(realApp.liveStreamMessage, expectedMessage);
});

// ---------- runProcess ----------

test("BUG-1b: runProcess - linia o pominieciu na stdout ustawia skippedByFilter, stdout dalej nie jest zbierany", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: [realSkipStdout], code: 0 }]);
    const app = loadApp(spawnImpl);
    const result = await app.runProcess("yt-dlp", [], "YT-DLP AUDIO");

    assert.deepEqual(result, { errorOutput: "", skippedByFilter: true });
});

test("BUG-1b: runProcess - linia rozcieta miedzy kawalki stdout, z CRLF albo bez konca linii tez jest rozpoznana", async (t) => {
    muteConsole(t);

    const half = Math.floor(realSkipLine.length / 2);
    const variants = [
        ["[youtube] x\n" + realSkipLine.slice(0, half), realSkipLine.slice(half) + "\n"],
        [realSkipStdout.replace(/\n/g, "\r\n")],
        ["[youtube] x\n", realSkipLine]           // ostatnia linia bez znaku konca linii
    ];

    for (const stdout of variants) {
        const { spawnImpl } = makeFakeSpawn([{ stdout, code: 0 }]);
        const app = loadApp(spawnImpl);
        const result = await app.runProcess("yt-dlp", [], "YT-DLP VIDEO");

        assert.equal(result.skippedByFilter, true, JSON.stringify(stdout));
    }
});

test("BUG-1b: runProcess - zwykly stdout i linia o pominieciu tylko na stderr nie ustawiaja skippedByFilter", async (t) => {
    muteConsole(t);

    for (const scenario of [{ stdout: [normalStdout] }, { stderr: [realSkipLine + "\n"] }]) {
        const { spawnImpl } = makeFakeSpawn([{ ...scenario, code: 0 }]);
        const app = loadApp(spawnImpl);
        const result = await app.runProcess("yt-dlp", [], "YT-DLP AUDIO");

        assert.equal(result.skippedByFilter, undefined);
    }
});

test("BUG-1b: runProcess - kod wyjscia rozny od 0 dalej jest bledem, nawet z linia o pominieciu", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: [realSkipStdout], stderr: ["ERROR: cos innego\n"], code: 1 }]);
    const app = loadApp(spawnImpl);
    const error = await rejectionOf(app.runProcess("yt-dlp", [], "YT-DLP AUDIO"));

    assert.equal(error.message, "YT-DLP AUDIO: cos innego");
});

// ---------- funkcje pobierajace ----------

const oldMessages = {
    audio: "Pobieranie zakończone, ale nie znaleziono pliku audio.",
    video: "Pobieranie video zakończone, ale nie znaleziono pliku.",
    separate: "Pobieranie osobnych plików zakończone, ale nie znaleziono video albo audio."
};

for (const mode of ["audio", "video", "separate"]) {
    test(`BUG-1b: tryb ${mode} - pominiecie przez filtr daje komunikat o transmisji`, async (t) => {
        muteConsole(t);

        const { spawnImpl, calls } = makeFakeSpawn([{ stdout: [realSkipStdout], code: 0 }]);
        const app = loadApp(spawnImpl);
        const error = await rejectionOf(runMode(app, mode));

        assert.equal(error.message, expectedMessage);
        assert.equal(calls.length, 1, "po pominieciu nie powinno byc kolejnych wywolan yt-dlp");
    });

    test(`BUG-1b: tryb ${mode} - zwykly brak pliku daje dotychczasowy komunikat`, async (t) => {
        muteConsole(t);

        const { spawnImpl } = makeFakeSpawn([{ stdout: [normalStdout], code: 0 }]);
        const app = loadApp(spawnImpl);
        const error = await rejectionOf(runMode(app, mode));

        assert.equal(error.message, oldMessages[mode]);
    });
}

test("BUG-1b: tryb separate - pominiecie dopiero w drugim wywolaniu (audio) tez daje komunikat o transmisji", async (t) => {
    muteConsole(t);

    const { spawnImpl, calls } = makeFakeSpawn([{ stdout: [normalStdout], code: 0 }, { stdout: [realSkipStdout], code: 0 }]);
    const app = loadApp(spawnImpl);
    const error = await rejectionOf(runMode(app, "separate"));

    assert.equal(error.message, expectedMessage);
    assert.equal(calls.length, 2);
});

// ---------- /api/download ----------

test("BUG-1b: /api/download - trwajaca transmisja daje 500 z komunikatem o transmisji (audio, film, osobno)", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: [realSkipStdout], code: 0 }]);
    const app = loadApp(spawnImpl);
    const server = await new Promise((resolve) => {
        const listening = app.app.listen(0, "127.0.0.1", () => resolve(listening));

        t.after(() => {
            listening.close();
            listening.closeAllConnections();
        });
    });

    const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
    const bodies = [
        { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects },
        { url: testUrl, type: "video", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects },
        { url: testUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects }
    ];

    for (const body of bodies) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ folder: folderDocelowy, ...body }),
            signal: AbortSignal.timeout(10000)
        });
        const json = await response.json();

        assert.equal(response.status, 500, `tryb ${body.type}`);
        assert.equal(json.success, false);
        assert.equal(json.message, expectedMessage);
    }
});
