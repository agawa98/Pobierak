// Testy zadania P1: szukanie programow (resolveBinary) i wspolne argumenty yt-dlp (ytDlpBaseArgs).
// B4: oczekiwane ytDlpBaseArgs zawieraja tez --no-playlist (testy samej flagi sa w testy/argumenty-ytdlp.test.js).
// B13e: oczekiwane ytDlpBaseArgs zawieraja tez --no-mtime (testy samej flagi sa w testy/argumenty-ytdlp.test.js).
// B13a: oczekiwane ytDlpBaseArgs zawieraja tez --newline (testy samej flagi sa w testy/argumenty-ytdlp.test.js).
// BUG-1b: oczekiwane ytDlpBaseArgs zawieraja tez --match-filter i --playlist-items (testy w testy/argumenty-ytdlp.test.js i testy/transmisja.test.js).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: spawn jest podmieniony na atrape.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

const projectBinDir = path.join(__dirname, "..", "bin");
const exeSuffix = process.platform === "win32" ? ".exe" : "";

// wczytuje app.js od nowa z podanymi zmiennymi srodowiskowymi i z atrapa spawn, ktora zapisuje wywolania.
// binFiles - nazwy plikow, ktore na czas wczytania "istnieja" w folderze bin obok app.js (pusta lista = folderu bin nie ma).
// folder bin jest udawany przez podmiane fs.existsSync, wiec test nie zalezy od tego, czy wlasciciel ma prawdziwy bin
function loadApp(envOverrides = {}, binFiles = []) {
    const calls = [];
    const originalSpawn = childProcess.spawn;
    const originalExistsSync = fs.existsSync;
    const fakeBinPaths = binFiles.map(fileName => path.join(projectBinDir, fileName));

    fs.existsSync = (target) => {
        const resolved = path.resolve(String(target));

        if (resolved === projectBinDir || path.dirname(resolved) === projectBinDir) {
            return fakeBinPaths.includes(resolved);
        }

        return originalExistsSync(target);
    };
    const savedEnv = {};

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

    // katalog roboczy inny niz folder programu: folder bin ma byc szukany obok app.js, a nie w biezacym katalogu
    const originalCwd = process.cwd();
    process.chdir(os.tmpdir());

    try {
        appModule = require(appPath);
    } finally {
        process.chdir(originalCwd);
        // app.js zapamietal atrape przy wczytaniu, wiec globalny spawn mozna od razu przywrocic
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

function makeTempBinDir(t, fileNames) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-bin-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    for (const fileName of fileNames) {
        fs.writeFileSync(path.join(dir, fileName), "");
    }

    return dir;
}

const { appModule: app } = loadApp();

// ---------- resolveBinary ----------

test("resolveBinary: zmienna srodowiskowa ma pierwszenstwo przed folderem bin", (t) => {
    const binDir = makeTempBinDir(t, ["yt-dlp.exe", "yt-dlp"]);
    const envPath = path.join(os.tmpdir(), "inne-miejsce", "moj-yt-dlp");

    const result = app.resolveBinary("YTDLP_PATH", "yt-dlp", {
        env: { YTDLP_PATH: envPath },
        binDir,
        platform: "win32"
    });

    assert.deepEqual(result, { command: envPath, fromPath: false });
});

test("resolveBinary: czyta te zmienna, ktorej nazwe dostal (nie cudza)", (t) => {
    const binDir = makeTempBinDir(t, []);

    const result = app.resolveBinary("FFMPEG_PATH", "ffmpeg", {
        env: { YTDLP_PATH: "sciezka-yt-dlp" },
        binDir,
        platform: "linux"
    });

    assert.deepEqual(result, { command: "ffmpeg", fromPath: true });
});

test("resolveBinary: pusta zmienna srodowiskowa jest traktowana jak brak", (t) => {
    const binDir = makeTempBinDir(t, []);

    for (const value of ["", "   "]) {
        const result = app.resolveBinary("FFMPEG_PATH", "ffmpeg", {
            env: { FFMPEG_PATH: value },
            binDir,
            platform: "darwin"
        });

        assert.deepEqual(result, { command: "ffmpeg", fromPath: true });
    }
});

test("resolveBinary: spacje wokol wartosci zmiennej sa obcinane", (t) => {
    const binDir = makeTempBinDir(t, []);
    const envPath = path.join(os.tmpdir(), "inne-miejsce", "ffmpeg");

    const result = app.resolveBinary("FFMPEG_PATH", "ffmpeg", {
        env: { FFMPEG_PATH: `  ${envPath}  ` },
        binDir,
        platform: "linux"
    });

    assert.deepEqual(result, { command: envPath, fromPath: false });
});

test("resolveBinary: Windows bierze plik .exe z folderu bin", (t) => {
    const binDir = makeTempBinDir(t, ["ffmpeg.exe"]);

    const result = app.resolveBinary("FFMPEG_PATH", "ffmpeg", { env: {}, binDir, platform: "win32" });

    assert.deepEqual(result, { command: path.join(binDir, "ffmpeg.exe"), fromPath: false });
});

test("resolveBinary: macOS i Linux biora z folderu bin plik bez koncowki", (t) => {
    const binDir = makeTempBinDir(t, ["yt-dlp"]);

    for (const platform of ["darwin", "linux"]) {
        const result = app.resolveBinary("YTDLP_PATH", "yt-dlp", { env: {}, binDir, platform });

        assert.deepEqual(result, { command: path.join(binDir, "yt-dlp"), fromPath: false });
    }
});

test("resolveBinary: Windows nie bierze z bin pliku bez .exe, a macOS/Linux pliku .exe", (t) => {
    const binWithoutExe = makeTempBinDir(t, ["ffmpeg"]);
    const binWithExe = makeTempBinDir(t, ["ffmpeg.exe"]);

    assert.deepEqual(
        app.resolveBinary("FFMPEG_PATH", "ffmpeg", { env: {}, binDir: binWithoutExe, platform: "win32" }),
        { command: "ffmpeg", fromPath: true }
    );

    for (const platform of ["darwin", "linux"]) {
        assert.deepEqual(
            app.resolveBinary("FFMPEG_PATH", "ffmpeg", { env: {}, binDir: binWithExe, platform }),
            { command: "ffmpeg", fromPath: true }
        );
    }
});

test("resolveBinary: bez zmiennej i bez folderu bin zwraca sama nazwe programu (PATH)", () => {
    const missingBinDir = path.join(os.tmpdir(), "pobierak-nie-ma-takiego-folderu-bin");

    for (const platform of ["win32", "darwin", "linux"]) {
        assert.deepEqual(
            app.resolveBinary("YTDLP_PATH", "yt-dlp", { env: {}, binDir: missingBinDir, platform }),
            { command: "yt-dlp", fromPath: true }
        );
        assert.deepEqual(
            app.resolveBinary("FFMPEG_PATH", "ffmpeg", { env: {}, binDir: missingBinDir, platform }),
            { command: "ffmpeg", fromPath: true }
        );
    }
});

test("resolveBinary: program z bin nie wplywa na drugi program, ktorego w bin nie ma", (t) => {
    const binDir = makeTempBinDir(t, ["yt-dlp.exe"]);

    assert.deepEqual(
        app.resolveBinary("FFMPEG_PATH", "ffmpeg", { env: {}, binDir, platform: "win32" }),
        { command: "ffmpeg", fromPath: true }
    );
});

// ---------- buildYtDlpBaseArgs ----------

test("buildYtDlpBaseArgs: ffmpeg z PATH -> bez --ffmpeg-location", () => {
    assert.deepEqual(app.buildYtDlpBaseArgs({ command: "ffmpeg", fromPath: true }), ["--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]);
});

test("buildYtDlpBaseArgs: ffmpeg spoza PATH -> --ffmpeg-location ze sciezka", () => {
    const ffmpegFile = path.join(os.tmpdir(), "gdzies", "ffmpeg");

    assert.deepEqual(
        app.buildYtDlpBaseArgs({ command: ffmpegFile, fromPath: false }),
        ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]
    );
});

// ---------- uzycie w trzech funkcjach pobierajacych ----------

const testUrl = "https://example.invalid/film";

// uruchamia funkcje pobierajaca na atrapie spawn. atrapa nie tworzy pliku, wiec funkcja konczy sie
// bledem "nie znaleziono pliku" - to oczekiwane, test sprawdza tylko argumenty przekazane do yt-dlp
async function runDownload(loaded, mode) {
    const { appModule, calls } = loaded;
    const jobId = "test-p1-brak-takiego-pliku";

    calls.length = 0;

    await assert.rejects(async () => {
        if (mode === "audio") {
            await appModule.downloadAudio(testUrl, "mp3", "best", jobId);
        } else if (mode === "video") {
            await appModule.downloadVideo(testUrl, "720", "mp4", jobId);
        } else {
            await appModule.downloadSeparate(testUrl, "720", "mp4", jobId);
        }
    }, (error) => {
        // funkcje w app.js odrzucaja zwyklym obiektem { message, error }, nie klasa Error
        assert.match(error.message, /nie znaleziono/);
        return true;
    });

    return calls.slice();
}

const expectedCallCount = { audio: 1, video: 1, separate: 2 };

for (const mode of ["audio", "video", "separate"]) {
    test(`tryb ${mode}: FFMPEG_PATH i YTDLP_PATH trafiaja do wywolania yt-dlp`, async () => {
        const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
        const ytDlpFile = path.join(os.tmpdir(), "moje programy", "yt-dlp-wlasny");

        const loaded = loadApp({ FFMPEG_PATH: ffmpegFile, YTDLP_PATH: ytDlpFile });

        assert.equal(loaded.appModule.ffmpegPath, ffmpegFile);
        assert.equal(loaded.appModule.ytDlpPath, ytDlpFile);
        assert.deepEqual(loaded.appModule.ytDlpBaseArgs, ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]);

        const calls = await runDownload(loaded, mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, ytDlpFile);
            assert.deepEqual(call.args.slice(0, 2), ["--ffmpeg-location", ffmpegFile]);
            assert.equal(call.args.filter(arg => arg === "--ffmpeg-location").length, 1);
            assert.equal(call.args[call.args.length - 1], testUrl);
        }
    });

    test(`tryb ${mode}: bez zmiennych i bez folderu bin yt-dlp jest wolany po nazwie, bez --ffmpeg-location`, async () => {
        const loaded = loadApp();

        assert.equal(loaded.appModule.ffmpegPath, "ffmpeg");
        assert.equal(loaded.appModule.ytDlpPath, "yt-dlp");
        assert.deepEqual(loaded.appModule.ytDlpBaseArgs, ["--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]);

        const calls = await runDownload(loaded, mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, "yt-dlp");
            assert.equal(call.args.includes("--ffmpeg-location"), false);
            assert.equal(call.args[call.args.length - 1], testUrl);
        }
    });

    test(`tryb ${mode}: programy z folderu bin obok app.js sa uzywane, gdy nie ma zmiennych`, async () => {
        const binFfmpeg = path.join(projectBinDir, `ffmpeg${exeSuffix}`);
        const binYtDlp = path.join(projectBinDir, `yt-dlp${exeSuffix}`);

        const loaded = loadApp({}, [`ffmpeg${exeSuffix}`, `yt-dlp${exeSuffix}`]);

        assert.equal(loaded.appModule.ffmpegPath, binFfmpeg);
        assert.equal(loaded.appModule.ytDlpPath, binYtDlp);
        assert.deepEqual(loaded.appModule.ytDlpBaseArgs, ["--ffmpeg-location", binFfmpeg, "--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]);

        const calls = await runDownload(loaded, mode);

        assert.equal(calls.length, expectedCallCount[mode]);

        for (const call of calls) {
            assert.equal(call.command, binYtDlp);
            assert.deepEqual(call.args.slice(0, 2), ["--ffmpeg-location", binFfmpeg]);
        }
    });
}

test("sam FFMPEG_PATH: yt-dlp dalej po nazwie, a --ffmpeg-location wskazuje podany plik", async () => {
    const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
    const loaded = loadApp({ FFMPEG_PATH: ffmpegFile });

    assert.equal(loaded.appModule.ytDlpPath, "yt-dlp");
    assert.equal(loaded.appModule.ffmpegPath, ffmpegFile);

    const calls = await runDownload(loaded, "audio");

    assert.equal(calls[0].command, "yt-dlp");
    assert.deepEqual(calls[0].args.slice(0, 2), ["--ffmpeg-location", ffmpegFile]);
});

test("zmienna srodowiskowa wygrywa z plikiem w folderze bin obok app.js", () => {
    const ffmpegFile = path.join(os.tmpdir(), "moje programy", "ffmpeg-wlasny");
    const loaded = loadApp({ FFMPEG_PATH: ffmpegFile }, [`ffmpeg${exeSuffix}`, `yt-dlp${exeSuffix}`]);

    assert.equal(loaded.appModule.ffmpegPath, ffmpegFile);
    assert.equal(loaded.appModule.ytDlpPath, path.join(projectBinDir, `yt-dlp${exeSuffix}`));
    assert.deepEqual(loaded.appModule.ytDlpBaseArgs, ["--ffmpeg-location", ffmpegFile, "--no-playlist", "--no-mtime", "--newline", "--match-filter", "!is_live & !is_upcoming", "--playlist-items", "1"]);
});

// ---------- brak sciezek wpisanych na sztywno ----------

test("app.js nie zawiera sciezek jednego systemu wpisanych na sztywno", () => {
    const source = fs.readFileSync(appPath, "utf8");

    for (const forbidden of ["/usr/bin", "/usr/local", "/opt/homebrew", "C:\\"]) {
        assert.equal(source.includes(forbidden), false, `w app.js zostala sciezka: ${forbidden}`);
    }
});

test("wczytanie app.js przez require nie uruchamia serwera ani zegara (proces testu konczy sie sam)", () => {
    const result = childProcess.spawnSync(
        process.execPath,
        ["-e", "require(process.argv[1])", appPath],
        { timeout: 20000, encoding: "utf8" }
    );

    assert.equal(result.error, undefined);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.includes("slucham"), false);
});
