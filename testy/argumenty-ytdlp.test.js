// Testy wspolnych argumentow yt-dlp dodawanych kolejnymi zadaniami (B4: --no-playlist, B13e: --no-mtime, B13a: --newline).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp: spawn jest podmieniony na atrape, ktora zapisuje argumenty.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");
const projectBinDir = path.join(__dirname, "..", "bin");

// wczytuje app.js od nowa z atrapa spawn. folder bin obok app.js jest na ten czas "pusty",
// a YTDLP_PATH / FFMPEG_PATH maja tylko wartosci podane w envOverrides - wynik nie zalezy od komputera
function loadApp(envOverrides = {}) {
    const calls = [];
    const originalSpawn = childProcess.spawn;
    const originalExistsSync = fs.existsSync;
    const savedEnv = {};

    fs.existsSync = (target) => {
        const resolved = path.resolve(String(target));

        if (resolved === projectBinDir || path.dirname(resolved) === projectBinDir) {
            return false;
        }

        return originalExistsSync(target);
    };

    for (const name of ["YTDLP_PATH", "FFMPEG_PATH"]) {
        savedEnv[name] = process.env[name];
        delete process.env[name];
    }

    Object.assign(process.env, envOverrides);

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();
        setImmediate(() => fake.emit("close", 0));

        return fake;
    };

    delete require.cache[require.resolve(appPath)];

    let appModule;

    try {
        appModule = require(appPath);
    } finally {
        childProcess.spawn = originalSpawn;
        fs.existsSync = originalExistsSync;

        for (const name of Object.keys(savedEnv)) {
            if (savedEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = savedEnv[name];
            }
        }
    }

    return { appModule, calls };
}

// link taki, jaki kopiuje sie podczas sluchania playlisty: film + parametr list
const playlistUrl = "https://www.youtube.com/watch?v=jBoKCUKJkiY&list=PLtestowaPlaylista123&index=2";
const jobId = "test-b4-brak-takiego-pliku";

// atrapa nie tworzy pliku, wiec funkcja konczy sie bledem "nie znaleziono" - to oczekiwane,
// test sprawdza tylko argumenty przekazane do yt-dlp
async function runDownload(loaded, mode) {
    const { appModule, calls } = loaded;

    calls.length = 0;

    await assert.rejects(async () => {
        if (mode === "audio") {
            await appModule.downloadAudio(playlistUrl, "mp3", "best", jobId);
        } else if (mode === "video") {
            await appModule.downloadVideo(playlistUrl, "720", "mp4", jobId);
        } else {
            await appModule.downloadSeparate(playlistUrl, "720", "mp4", jobId);
        }
    }, (error) => {
        assert.match(error.message, /nie znaleziono/);
        return true;
    });

    return calls.slice();
}

// opcje yt-dlp, po ktorych musi stac wartosc. flaga wstawiona miedzy opcje a wartosc zepsulaby wywolanie
const optionsWithValue = ["--ffmpeg-location", "-o", "-f", "--audio-format", "--audio-quality", "--merge-output-format"];

function assertNoPlaylistIsCorrect(args) {
    assert.equal(args.filter(arg => arg === "--no-playlist").length, 1, "--no-playlist ma byc dokladnie raz");
    assert.equal(args.includes("--yes-playlist"), false, "--yes-playlist wlaczyloby pobieranie calej playlisty");

    // adres jest ostatni i nietkniety (parametr list zostaje w adresie, o pominieciu playlisty decyduje flaga)
    assert.equal(args[args.length - 1], playlistUrl);
    assert.ok(args.indexOf("--no-playlist") < args.length - 1);

    // flaga nie stoi w miejscu wartosci innej opcji
    const before = args[args.indexOf("--no-playlist") - 1];
    assert.equal(optionsWithValue.includes(before), false, `--no-playlist stoi jako wartosc opcji ${before}`);
}

// ---------- buildYtDlpBaseArgs ----------

test("B4: buildYtDlpBaseArgs zawiera --no-playlist, gdy ffmpeg jest z PATH", () => {
    const { appModule } = loadApp();

    assert.deepEqual(appModule.buildYtDlpBaseArgs({ command: "ffmpeg", fromPath: true }), ["--no-playlist", "--no-mtime", "--newline"]);
});

test("B4: buildYtDlpBaseArgs zawiera --no-playlist takze obok --ffmpeg-location, a sciezka ffmpeg stoi zaraz po swojej opcji", () => {
    const { appModule } = loadApp();
    const ffmpegFile = path.join(os.tmpdir(), "gdzies", "ffmpeg");

    const args = appModule.buildYtDlpBaseArgs({ command: ffmpegFile, fromPath: false });

    assert.equal(args.filter(arg => arg === "--no-playlist").length, 1);
    assert.equal(args[args.indexOf("--ffmpeg-location") + 1], ffmpegFile);
    assert.equal(args.length, 5);      // B13e: doszlo --no-mtime, B13a: doszlo --newline
});

test("B4: stala ytDlpBaseArgs (uzywana przez program) zawiera --no-playlist", () => {
    assert.deepEqual(loadApp().appModule.ytDlpBaseArgs, ["--no-playlist", "--no-mtime", "--newline"]);

    const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
    const withFfmpeg = loadApp({ FFMPEG_PATH: ffmpegFile }).appModule.ytDlpBaseArgs;

    assert.equal(withFfmpeg.filter(arg => arg === "--no-playlist").length, 1);
});

// ---------- kazde wywolanie yt-dlp ----------

const expectedCallCount = { audio: 1, video: 1, separate: 2 };

for (const mode of ["audio", "video", "separate"]) {
    test(`B4: tryb ${mode} - kazde wywolanie yt-dlp dla linku z &list= ma --no-playlist (ffmpeg z PATH)`, async () => {
        const calls = await runDownload(loadApp(), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, "yt-dlp");
            assertNoPlaylistIsCorrect(call.args);
        }
    });

    test(`B4: tryb ${mode} - --no-playlist jest takze wtedy, gdy ffmpeg pochodzi z FFMPEG_PATH`, async () => {
        const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
        const calls = await runDownload(loadApp({ FFMPEG_PATH: ffmpegFile }), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assertNoPlaylistIsCorrect(call.args);
            assert.equal(call.args[call.args.indexOf("--ffmpeg-location") + 1], ffmpegFile);
        }
    });

    test(`B4: tryb ${mode} - szablon nazwy, format i pozostale opcje dalej maja swoje wartosci`, async () => {
        const calls = await runDownload(loadApp(), mode);

        for (const call of calls) {
            const args = call.args;

            // po -o stoi szablon z identyfikatorem zadania, a nie flaga
            assert.ok(args[args.indexOf("-o") + 1].includes(jobId));

            for (const option of optionsWithValue) {
                const index = args.indexOf(option);

                if (index !== -1) {
                    assert.equal(args[index + 1].startsWith("--"), false, `po ${option} stoi flaga zamiast wartosci`);
                }
            }
        }
    });
}

// ---------- B13e: --no-mtime ----------

// flaga ma byc dokladnie raz, przed adresem, nie w miejscu wartosci innej opcji i bez flagi o przeciwnym dzialaniu
function assertNoMtimeIsCorrect(args) {
    assert.equal(args.filter(arg => arg === "--no-mtime").length, 1, "--no-mtime ma byc dokladnie raz");
    assert.equal(args.includes("--mtime"), false, "--mtime ustawiloby plikowi date wrzucenia filmu");

    assert.equal(args[args.length - 1], playlistUrl);
    assert.ok(args.indexOf("--no-mtime") < args.length - 1);

    const before = args[args.indexOf("--no-mtime") - 1];
    assert.equal(optionsWithValue.includes(before), false, `--no-mtime stoi jako wartosc opcji ${before}`);
}

test("B13e: buildYtDlpBaseArgs zawiera --no-mtime, gdy ffmpeg jest z PATH", () => {
    const { appModule } = loadApp();

    assert.deepEqual(appModule.buildYtDlpBaseArgs({ command: "ffmpeg", fromPath: true }), ["--no-playlist", "--no-mtime", "--newline"]);
});

test("B13e: buildYtDlpBaseArgs zawiera --no-mtime takze obok --ffmpeg-location", () => {
    const { appModule } = loadApp();
    const ffmpegFile = path.join(os.tmpdir(), "gdzies", "ffmpeg");

    assert.deepEqual(
        appModule.buildYtDlpBaseArgs({ command: ffmpegFile, fromPath: false }),
        ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline"]
    );
});

test("B13e: stala ytDlpBaseArgs (uzywana przez program) zawiera --no-mtime", () => {
    assert.deepEqual(loadApp().appModule.ytDlpBaseArgs, ["--no-playlist", "--no-mtime", "--newline"]);

    const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");

    assert.deepEqual(
        loadApp({ FFMPEG_PATH: ffmpegFile }).appModule.ytDlpBaseArgs,
        ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline"]
    );
});

for (const mode of ["audio", "video", "separate"]) {
    test(`B13e: tryb ${mode} - kazde wywolanie yt-dlp ma --no-mtime (ffmpeg z PATH)`, async () => {
        const calls = await runDownload(loadApp(), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, "yt-dlp");
            assertNoMtimeIsCorrect(call.args);
        }
    });

    test(`B13e: tryb ${mode} - --no-mtime jest takze wtedy, gdy ffmpeg pochodzi z FFMPEG_PATH`, async () => {
        const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
        const calls = await runDownload(loadApp({ FFMPEG_PATH: ffmpegFile }), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assertNoMtimeIsCorrect(call.args);
            assert.equal(call.args[call.args.indexOf("--ffmpeg-location") + 1], ffmpegFile);
        }
    });
}

// ---------- B13a: --newline ----------

// flaga ma byc dokladnie raz, przed adresem i nie w miejscu wartosci innej opcji
function assertNewlineIsCorrect(args) {
    assert.equal(args.filter(arg => arg === "--newline").length, 1, "--newline ma byc dokladnie raz");
    assert.equal(args.includes("--no-progress"), false, "--no-progress wylaczyloby linie postepu");
    assert.equal(args.includes("--quiet"), false, "--quiet wylaczyloby linie postepu");
    assert.equal(args.includes("-q"), false, "-q wylaczyloby linie postepu");

    assert.equal(args[args.length - 1], playlistUrl);
    assert.ok(args.indexOf("--newline") < args.length - 1);

    const before = args[args.indexOf("--newline") - 1];
    assert.equal(optionsWithValue.includes(before), false, `--newline stoi jako wartosc opcji ${before}`);
}

test("B13a: buildYtDlpBaseArgs zawiera --newline, gdy ffmpeg jest z PATH", () => {
    const { appModule } = loadApp();

    assert.deepEqual(appModule.buildYtDlpBaseArgs({ command: "ffmpeg", fromPath: true }), ["--no-playlist", "--no-mtime", "--newline"]);
});

test("B13a: buildYtDlpBaseArgs zawiera --newline takze obok --ffmpeg-location", () => {
    const { appModule } = loadApp();
    const ffmpegFile = path.join(os.tmpdir(), "gdzies", "ffmpeg");

    assert.deepEqual(
        appModule.buildYtDlpBaseArgs({ command: ffmpegFile, fromPath: false }),
        ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline"]
    );
});

for (const mode of ["audio", "video", "separate"]) {
    test(`B13a: tryb ${mode} - kazde wywolanie yt-dlp ma --newline (ffmpeg z PATH)`, async () => {
        const calls = await runDownload(loadApp(), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, "yt-dlp");
            assertNewlineIsCorrect(call.args);
        }
    });

    test(`B13a: tryb ${mode} - --newline jest takze wtedy, gdy ffmpeg pochodzi z FFMPEG_PATH`, async () => {
        const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
        const calls = await runDownload(loadApp({ FFMPEG_PATH: ffmpegFile }), mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assertNewlineIsCorrect(call.args);
            assert.equal(call.args[call.args.indexOf("--ffmpeg-location") + 1], ffmpegFile);
        }
    });
}
