// Testy zadania G3a: konkretna przyczyna bledu w runProcess.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg.
// Czesc testow uzywa atrapy spawn (sterowany stderr i kod wyjscia), czesc uruchamia prawdziwy proces:
// samego Node (process.execPath) z krotkim skryptem albo nieistniejacy plik w os.tmpdir().

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// sciezka do programu, ktorego na pewno nie ma (folder tymczasowy tez nie istnieje)
const missingProgram = path.join(os.tmpdir(), "pobierak-nie-ma-takiego-folderu", "nie-ma-yt-dlp");

// wczytuje app.js od nowa. spawnImpl - czym zastapic spawn (app.js bierze spawn przy require); null = prawdziwy spawn
function loadApp(spawnImpl, envOverrides = {}) {
    const originalSpawn = childProcess.spawn;
    const savedEnv = {};

    for (const name of ["YTDLP_PATH", "FFMPEG_PATH"]) {
        savedEnv[name] = process.env[name];
        delete process.env[name];
    }

    Object.assign(process.env, envOverrides);

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

// atrapa spawn: kazde wywolanie bierze kolejny scenariusz z listy.
// scenariusz: { stdout: [kawalki], stderr: [kawalki], code } albo { spawnError: blad }
function makeFakeSpawn(scenarios) {
    const calls = [];

    const spawnImpl = (command, args) => {
        const scenario = scenarios[Math.min(calls.length, scenarios.length - 1)];

        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            if (scenario.spawnError) {
                fake.emit("error", scenario.spawnError);
                // prawdziwy Node po bledzie uruchomienia wysyla jeszcze "close" z ujemnym kodem
                fake.emit("close", scenario.closeCode === undefined ? -2 : scenario.closeCode);
                return;
            }

            for (const chunk of scenario.stdout || []) {
                fake.stdout.emit("data", Buffer.from(chunk));
            }

            for (const chunk of scenario.stderr || []) {
                fake.stderr.emit("data", Buffer.from(chunk));
            }

            fake.emit("close", scenario.code);
        });

        return fake;
    };

    return { spawnImpl, calls };
}

// uruchamia runProcess i zwraca to, czym obietnica zostala odrzucona (test pada, gdy zakonczyla sie sukcesem)
async function rejectionOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    assert.fail("runProcess powinien zakonczyc sie bledem, a zakonczyl sie sukcesem");
}

// na czas testu wycisza console.log i console.error (runProcess wypisuje tam caly stdout i stderr)
function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

const realApp = loadApp(null);
const { buildProcessErrorMessage, buildMissingProgramMessage, stderrTailLimit } = realApp;

// ---------- buildProcessErrorMessage ----------

test("G3a: yt-dlp - przyczyna to ostatnia linia ERROR:, w formacie <etykieta>: <przyczyna>", () => {
    const stderr = [
        "WARNING: [youtube] Falling back to generic n function search",
        "ERROR: [youtube] aaaaaaaaaaa: Video unavailable",
        ""
    ].join("\n");

    assert.equal(
        buildProcessErrorMessage("YT-DLP AUDIO", stderr, 1),
        "YT-DLP AUDIO: [youtube] aaaaaaaaaaa: Video unavailable"
    );
});

test("G3a: yt-dlp - linia ERROR: wygrywa z pozniejszymi liniami, ktore nie sa bledem", () => {
    const stderr = [
        "ERROR: [youtube] aaaaaaaaaaa: Private video. Sign in if you've been granted access to this video",
        "WARNING: cos jeszcze po bledzie",
        "[download] Finished downloading playlist",
        ""
    ].join("\n");

    assert.equal(
        buildProcessErrorMessage("YT-DLP VIDEO", stderr, 1),
        "YT-DLP VIDEO: [youtube] aaaaaaaaaaa: Private video. Sign in if you've been granted access to this video"
    );
});

test("G3a: yt-dlp - przy kilku liniach ERROR: brana jest ostatnia", () => {
    const stderr = "ERROR: pierwszy blad\nWARNING: x\nERROR: drugi blad\nWARNING: y\n";

    assert.equal(buildProcessErrorMessage("YT-DLP VIDEO ONLY", stderr, 1), "YT-DLP VIDEO ONLY: drugi blad");
});

test("G3a: ERROR: liczy sie tylko na poczatku linii, a nie w srodku", () => {
    const stderr = "ERROR: prawdziwy blad\n[info] tytul filmu: ERROR: to nie blad\n";

    assert.equal(buildProcessErrorMessage("YT-DLP AUDIO", stderr, 1), "YT-DLP AUDIO: prawdziwy blad");

    // sama linia z ERROR: w srodku nie jest linia bledu - zostaje jako ostatnia niepusta linia, w calosci
    assert.equal(
        buildProcessErrorMessage("FFMPEG AUDIO", "wstep\n[info] tytul: ERROR: w srodku\n", 1),
        "FFMPEG AUDIO: [info] tytul: ERROR: w srodku"
    );
});

test("G3a: ffmpeg - bez linii ERROR: przyczyna to ostatnia niepusta linia", () => {
    const stderr = [
        "ffmpeg version 8.1 Copyright (c) 2000-2026 the FFmpeg developers",
        "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'plik.mp4':",
        "[out#0/mp2 @ 000001] Nothing was written into output file, because at least one of its streams received no packets.",
        "Conversion failed!",
        "",
        "   ",
        ""
    ].join("\n");

    assert.equal(buildProcessErrorMessage("FFMPEG VIDEO", stderr, 1), "FFMPEG VIDEO: Conversion failed!");
});

test("G3a: linie sa dzielone takze po \\r i \\r\\n (ffmpeg nadpisuje postep znakiem \\r, Windows konczy linie \\r\\n)", () => {
    assert.equal(
        buildProcessErrorMessage("FFMPEG AUDIO", "size= 10kB time=00:00:01\rsize= 20kB time=00:00:02\rplik.mp3: Permission denied\r\n", 1),
        "FFMPEG AUDIO: plik.mp3: Permission denied"
    );

    assert.equal(
        buildProcessErrorMessage("YT-DLP AUDIO", "WARNING: a\r\nERROR: Unsupported URL: https://example.com/\r\n", 1),
        "YT-DLP AUDIO: Unsupported URL: https://example.com/"
    );

    // linia ERROR: zaraz po postepie nadpisywanym przez \r tez jest poczatkiem linii
    assert.equal(
        buildProcessErrorMessage("YT-DLP AUDIO", "[download]  50.0%\rERROR: unable to download video data\n", 1),
        "YT-DLP AUDIO: unable to download video data"
    );
});

test("G3a: spacje na brzegach linii sa obcinane, a przyczyna nie zawiera znakow konca linii", () => {
    const message = buildProcessErrorMessage("YT-DLP AUDIO", "  ERROR:    odstepy na brzegach   \r\n\r\n", 1);

    assert.equal(message, "YT-DLP AUDIO: odstepy na brzegach");
    assert.doesNotMatch(message, /[\r\n]/);
});

test("G3a: pusty stderr - komunikat dalej ma etykiete i mowi o bledzie z kodem wyjscia", () => {
    for (const empty of ["", "\n\n", "  \r\n ", undefined, null]) {
        const message = buildProcessErrorMessage("FFMPEG AUDIO", empty, 3);

        assert.ok(message.startsWith("FFMPEG AUDIO: "), `komunikat "${message}" nie zaczyna sie od etykiety`);
        assert.ok(message.length > "FFMPEG AUDIO: ".length, "po etykiecie nie ma przyczyny");
        assert.match(message, /błędem/);
        assert.match(message, /\b3\b/, "brakuje kodu wyjscia");
    }
});

test("G3a: sama linia ERROR: bez tresci nie daje pustej przyczyny", () => {
    assert.equal(buildProcessErrorMessage("YT-DLP AUDIO", "cos poszlo zle\nERROR:\n", 1), "YT-DLP AUDIO: ERROR:");
    assert.equal(buildProcessErrorMessage("YT-DLP AUDIO", "ERROR: wczesniejszy\nERROR:   \n", 1), "YT-DLP AUDIO: ERROR:");
});

// ---------- buildMissingProgramMessage ----------

test("G3a: komunikat o braku programu mowi czego brakuje, ze trzeba zainstalowac albo wrzucic do bin, i odsyla do README", () => {
    const message = buildMissingProgramMessage("YT-DLP AUDIO", missingProgram);

    assert.ok(message.startsWith("YT-DLP AUDIO: "));
    assert.match(message, /nie znaleziono programu/i);
    assert.ok(message.includes(missingProgram), "komunikat nie podaje, ktorego programu brakuje");
    assert.match(message, /zainstaluj/i);
    assert.match(message, /folderu bin/);
    assert.match(message, /README/);
    assert.doesNotMatch(message, /[\r\n]/);
});

// ---------- runProcess na atrapie spawn ----------

test("G3a: runProcess - kod wyjscia rozny od 0 odrzuca z przyczyna z linii ERROR:, a pole error niesie stderr", async (t) => {
    muteConsole(t);

    const stderr = "WARNING: ostrzezenie\nERROR: [youtube] aaaaaaaaaaa: Video unavailable\n";
    const { spawnImpl, calls } = makeFakeSpawn([{ stdout: ["[youtube] Extracting URL\n"], stderr: [stderr], code: 1 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("yt-dlp", ["--wersja"], "YT-DLP AUDIO"));

    assert.equal(error.message, "YT-DLP AUDIO: [youtube] aaaaaaaaaaa: Video unavailable");
    assert.equal(error.error, stderr);
    assert.deepEqual(calls, [{ command: "yt-dlp", args: ["--wersja"] }]);
});

test("G3a: runProcess - linia ERROR: rozcieta miedzy dwa kawalki stderr jest skladana w calosc", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stderr: ["WARNING: a\nERR", "OR: [youtube] bbb: Sign in to con", "firm your age\n"], code: 1 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("yt-dlp", [], "YT-DLP VIDEO"));

    assert.equal(error.message, "YT-DLP VIDEO: [youtube] bbb: Sign in to confirm your age");
});

test("G3a: runProcess - tekst ERROR: na stdout nie jest przyczyna (liczy sie stderr)", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: ["ERROR: to bylo na stdout\n"], stderr: ["prawdziwa przyczyna ze stderr\n"], code: 1 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("ffmpeg", [], "FFMPEG AUDIO"));

    assert.equal(error.message, "FFMPEG AUDIO: prawdziwa przyczyna ze stderr");
    assert.ok(!error.error.includes("stdout"), "stdout nie powinien trafic do pola error");
});

test("G3a: runProcess - trzymana jest tylko koncowka stderr (limit ok. 8000 znakow), a przyczyna z konca dalej jest znajdowana", async (t) => {
    muteConsole(t);

    assert.ok(stderrTailLimit >= 4000 && stderrTailLimit <= 16000, `limit ${stderrTailLimit} nie jest "okolo 8000"`);

    const noise = [];

    for (let index = 0; index < 400; index += 1) {
        noise.push(`[download] linia postepu numer ${String(index).padStart(4, "0")} ${"x".repeat(100)}\n`);
    }

    const lastLine = "ERROR: [youtube] ccc: This video is not available\n";
    const { spawnImpl } = makeFakeSpawn([{ stderr: ["ERROR: stary blad z samego poczatku\n", ...noise, lastLine], code: 1 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("yt-dlp", [], "YT-DLP AUDIO"));
    const whole = "ERROR: stary blad z samego poczatku\n" + noise.join("") + lastLine;

    assert.ok(whole.length > 40000, "test ma podac duzo wiecej niz limit");
    assert.equal(error.message, "YT-DLP AUDIO: [youtube] ccc: This video is not available");
    assert.equal(error.error.length, stderrTailLimit);
    assert.equal(error.error, whole.slice(-stderrTailLimit), "pole error ma byc dokladnie koncowka stderr");
    assert.ok(!error.error.includes("stary blad z samego poczatku"));
});

test("G3a: runProcess - jeden kawalek stderr wiekszy niz limit tez jest przycinany do koncowki", async (t) => {
    muteConsole(t);

    const big = "a".repeat(stderrTailLimit * 3) + "\nostatnia linia\n";
    const { spawnImpl } = makeFakeSpawn([{ stderr: [big], code: 2 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("ffmpeg", [], "FFMPEG VIDEO"));

    assert.equal(error.error.length, stderrTailLimit);
    assert.equal(error.message, "FFMPEG VIDEO: ostatnia linia");
});

test("G3a: runProcess - sukces (kod 0) nie zwraca stdout, a stderr tylko jako koncowke", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: ["s".repeat(50000)], stderr: ["e".repeat(50000)], code: 0 }]);
    const app = loadApp(spawnImpl);

    const result = await app.runProcess("yt-dlp", [], "YT-DLP AUDIO");

    assert.equal(result.output, undefined, "stdout nie powinien byc zbierany");
    assert.equal(result.errorOutput, "e".repeat(stderrTailLimit));
    assert.ok(!JSON.stringify(result).includes("sss"), "wynik nie powinien zawierac stdout");
});

test("G3a: runProcess - sukces mimo linii ERROR: w stderr dalej jest sukcesem (decyduje kod wyjscia)", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stderr: ["ERROR: cos niegroznego\n"], code: 0 }]);
    const app = loadApp(spawnImpl);

    await assert.doesNotReject(app.runProcess("yt-dlp", [], "YT-DLP AUDIO"));
});

test("G3a: runProcess - stdout i stderr dalej trafiaja do logow na stronie, z etykieta jako typem", { timeout: 15000 }, async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stdout: ["[download]  50.0%\n"], stderr: ["ERROR: koniec\n"], code: 1 }]);
    const app = loadApp(spawnImpl);
    const server = await new Promise((resolve) => {
        const created = app.app.listen(0, "127.0.0.1", () => resolve(created));
    });

    t.after(() => {
        server.close();
        server.closeAllConnections();
    });

    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/logs`, { signal: controller.signal });
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let received = "";

    received += decoder.decode((await reader.read()).value);       // powitanie "Połączono z logami backendu."

    await rejectionOf(app.runProcess("yt-dlp", [], "YT-DLP AUDIO"));

    const deadline = Date.now() + 5000;

    while (!received.includes("ERROR: koniec") && Date.now() < deadline) {
        received += decoder.decode((await reader.read()).value);
    }

    controller.abort();

    const logs = received
        .split("\n\n")
        .filter(part => part.startsWith("data: "))
        .map(part => JSON.parse(part.slice("data: ".length)));

    assert.deepEqual(logs.slice(1), [
        { type: "YT-DLP AUDIO", message: "[download]  50.0%\n" },
        { type: "YT-DLP AUDIO", message: "ERROR: koniec\n" }
    ]);
});

test("G3a: runProcess - blad ENOENT daje komunikat o braku programu, a nie ogolne 'nie udalo sie uruchomic'", async (t) => {
    muteConsole(t);

    const spawnError = Object.assign(new Error(`spawn ${missingProgram} ENOENT`), { code: "ENOENT" });
    const { spawnImpl } = makeFakeSpawn([{ spawnError, closeCode: -4058 }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess(missingProgram, [], "YT-DLP AUDIO"));

    assert.equal(error.message, buildMissingProgramMessage("YT-DLP AUDIO", missingProgram));
    assert.match(error.message, /nie znaleziono programu/i);
    assert.match(error.message, /folderu bin/);
    assert.match(error.message, /README/);
});

test("G3a: runProcess - inny blad uruchomienia (np. brak uprawnien) nie udaje braku programu", async (t) => {
    muteConsole(t);

    const spawnError = Object.assign(new Error("spawn EACCES"), { code: "EACCES" });
    const { spawnImpl } = makeFakeSpawn([{ spawnError }]);
    const app = loadApp(spawnImpl);

    const error = await rejectionOf(app.runProcess("yt-dlp", [], "YT-DLP AUDIO"));

    assert.doesNotMatch(error.message, /nie znaleziono programu/i);
    assert.ok(error.message.includes("YT-DLP AUDIO"));
    assert.equal(error.error, "spawn EACCES");
});

// ---------- runProcess na prawdziwym procesie ----------

test("G3a: prawdziwy proces - nieistniejacy plik programu daje komunikat o braku programu", async (t) => {
    muteConsole(t);

    assert.equal(fs.existsSync(missingProgram), false);

    const error = await rejectionOf(realApp.runProcess(missingProgram, ["--version"], "YT-DLP AUDIO"));

    assert.equal(error.message, buildMissingProgramMessage("YT-DLP AUDIO", missingProgram));
});

test("G3a: prawdziwy proces - przyczyna z linii ERROR: na stderr i kod wyjscia 1", async (t) => {
    muteConsole(t);

    const script = [
        "process.stdout.write('ERROR: to jest stdout\\n');",
        "process.stderr.write('WARNING: ostrzezenie\\n');",
        "process.stderr.write('ERROR: [youtube] ddd: Video unavailable\\n');",
        "process.stderr.write('WARNING: po bledzie\\n');",
        "process.exitCode = 1;"
    ].join("");

    const error = await rejectionOf(realApp.runProcess(process.execPath, ["-e", script], "YT-DLP VIDEO"));

    assert.equal(error.message, "YT-DLP VIDEO: [youtube] ddd: Video unavailable");
});

test("G3a: prawdziwy proces - bez linii ERROR: przyczyna to ostatnia niepusta linia stderr, mimo 100 kB wczesniejszego stderr", async (t) => {
    muteConsole(t);

    const script = [
        "const line = 'frame= 1 fps=0.0 ' + 'x'.repeat(80) + '\\n';",
        "let text = '';",
        "for (let i = 0; i < 1000; i += 1) { text += line; }",
        "process.stderr.write(text, () => {",
        "process.stderr.write('Conversion failed!\\n\\n', () => process.exit(4));",
        "});"
    ].join("");

    const error = await rejectionOf(realApp.runProcess(process.execPath, ["-e", script], "FFMPEG AUDIO"));

    assert.equal(error.message, "FFMPEG AUDIO: Conversion failed!");
    assert.ok(error.error.length <= stderrTailLimit, `pole error ma ${error.error.length} znakow, limit to ${stderrTailLimit}`);
    assert.ok(error.error.endsWith("Conversion failed!\n\n"));
});

test("G3a: prawdziwy proces - kod 0 konczy sie sukcesem", async (t) => {
    muteConsole(t);

    const result = await realApp.runProcess(process.execPath, ["-e", "process.stderr.write('uwaga\\n')"], "YT-DLP AUDIO");

    assert.deepEqual(result, { errorOutput: "uwaga\n" });
});

// ---------- endpoint /api/download ----------

const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

function startServer(t, app) {
    return new Promise((resolve) => {
        const server = app.app.listen(0, "127.0.0.1", () => resolve(server));

        t.after(() => {
            server.close();
            server.closeAllConnections();
        });
    });
}

async function postDownload(server, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)      // gdyby serwer nie odpowiedzial, test pada zamiast wisiec
    });

    return { status: response.status, json: await response.json() };
}

test("G3a: /api/download - blad yt-dlp daje 500 z konkretna przyczyna w polu message (audio, film, osobno)", async (t) => {
    muteConsole(t);

    const stderr = "WARNING: x\nERROR: [youtube] jBoKCUKJkiY: Video unavailable\n";
    const { spawnImpl, calls } = makeFakeSpawn([{ stderr: [stderr], code: 1 }]);
    const app = loadApp(spawnImpl);
    const server = await startServer(t, app);

    const cases = [
        { body: { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects }, label: "YT-DLP AUDIO" },
        { body: { url: testUrl, type: "video", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects }, label: "YT-DLP VIDEO" },
        { body: { url: testUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects }, label: "YT-DLP VIDEO ONLY" }
    ];

    for (const { body, label } of cases) {
        const before = calls.length;
        const { status, json } = await postDownload(server, body);

        assert.equal(status, 500, `tryb ${body.type}`);
        assert.equal(json.success, false);
        assert.equal(json.message, `${label}: [youtube] jBoKCUKJkiY: Video unavailable`);
        assert.equal(json.error, stderr);
        assert.equal(json.files, undefined);
        assert.equal(calls.length, before + 1, `tryb ${body.type}: po bledzie nie powinno byc kolejnych wywolan programow`);
    }
});

test("G3a: /api/download - YTDLP_PATH wskazuje nieistniejacy plik: 500 z komunikatem o braku programu (prawdziwy spawn)", async (t) => {
    muteConsole(t);

    const app = loadApp(null, { YTDLP_PATH: missingProgram });

    assert.equal(app.ytDlpPath, missingProgram);

    const server = await startServer(t, app);
    const { status, json } = await postDownload(server, {
        url: testUrl,
        type: "audio",
        format: "mp3",
        bitrate: "best",
        experimental: noEffects
    });

    assert.equal(status, 500);
    assert.equal(json.success, false);
    assert.equal(json.message, buildMissingProgramMessage("YT-DLP AUDIO", missingProgram));
    assert.match(json.message, /nie znaleziono programu/i);
    assert.match(json.message, /folderu bin/);
    assert.match(json.message, /README/);
});
