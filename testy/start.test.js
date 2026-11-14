// Testy zadania G3b + G4: start programu (adres nasluchu, wypisany adres, zajety port, sprawdzenie yt-dlp i ffmpeg).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg.
// Czesc testow uzywa atrapy spawn, czesc uruchamia naprawde "node app.js" jako osobny proces na wolnym porcie 127.0.0.1.
// W tych drugich za yt-dlp podstawiony jest sam Node (process.execPath --version wypisuje wersje),
// a za ffmpeg nieistniejacy plik w os.tmpdir().
// Uruchamiana jest kopia app.js i public w os.tmpdir() (moduly z node_modules projektu przez NODE_PATH),
// bo program przy starcie sprzata swoj folder downloads - testy nie moga ruszac prawdziwego downloads.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// sciezka do programu, ktorego na pewno nie ma (folder tymczasowy tez nie istnieje)
const missingProgram = path.join(os.tmpdir(), "pobierak-nie-ma-takiego-folderu", "nie-ma-programu");

const envNames = ["YTDLP_PATH", "FFMPEG_PATH", "HOST", "PORT"];

// wczytuje app.js od nowa. spawnImpl - czym zastapic spawn (app.js bierze spawn przy require); null = prawdziwy spawn
function loadApp(spawnImpl, envOverrides = {}) {
    const originalSpawn = childProcess.spawn;
    const savedEnv = {};

    for (const name of envNames) {
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

        for (const name of envNames) {
            if (savedEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = savedEnv[name];
            }
        }
    }
}

// atrapa spawn: scenariusz wybierany po nazwie programu (command).
// scenariusz: { stdout: [kawalki], stderr: [kawalki], code } albo { spawnError: blad } albo { throws: blad }
function makeFakeSpawn(scenarioFor) {
    const calls = [];

    const spawnImpl = (command, args) => {
        const scenario = scenarioFor(command, args);

        calls.push({ command, args });

        if (scenario.throws) {
            throw scenario.throws;
        }

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            if (scenario.spawnError) {
                fake.emit("error", scenario.spawnError);
                // prawdziwy Node po bledzie uruchomienia wysyla jeszcze "close" z ujemnym kodem
                fake.emit("close", -2);
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

function errorWithCode(code) {
    const error = new Error(`spawn ${code}`);
    error.code = code;
    return error;
}

// wolny port na 127.0.0.1 (system sam go wybiera)
function getFreePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();

        server.on("error", reject);
        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

const projectDir = path.join(__dirname, "..");

// uruchamia naprawde "node app.js" z podanymi zmiennymi. zbiera stdout i stderr.
// program startuje z kopii w folderze tymczasowym, wiec jego sprzatanie dotyka tylko downloads w tej kopii
function startApp(t, envOverrides) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-start-"));
    const appCopyPath = path.join(workDir, "app.js");

    fs.copyFileSync(appPath, appCopyPath);
    fs.cpSync(path.join(projectDir, "public"), path.join(workDir, "public"), { recursive: true });

    const env = { ...process.env, NODE_PATH: path.join(projectDir, "node_modules") };

    for (const name of envNames) {
        delete env[name];
    }

    Object.assign(env, envOverrides);

    const child = childProcess.spawn(process.execPath, [appCopyPath], { env, stdio: ["ignore", "pipe", "pipe"] });

    const state = { child, stdout: "", stderr: "", exitCode: undefined, waiters: [] };

    const notify = () => state.waiters.forEach(check => check());

    child.stdout.on("data", (data) => { state.stdout += data.toString(); notify(); });
    child.stderr.on("data", (data) => { state.stderr += data.toString(); notify(); });
    child.on("close", (code) => { state.exitCode = code; notify(); });

    t.after(async () => {
        if (state.exitCode === undefined) {
            child.kill();
            await new Promise(resolve => child.on("close", resolve));
        }

        fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    });

    return state;
}

// czeka, az warunek bedzie spelniony (sprawdzany po kazdej porcji wyjscia i po zakonczeniu procesu)
function waitFor(state, condition, description, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Nie doczekano sie: ${description}.\nSTDOUT:\n${state.stdout}\nSTDERR:\n${state.stderr}`));
        }, timeoutMs);

        const check = () => {
            if (condition()) {
                clearTimeout(timer);
                resolve();
            }
        };

        state.waiters.push(check);
        check();
    });
}

function httpGetStatus(host, port, urlPath = "/") {
    return new Promise((resolve, reject) => {
        const request = http.get({ host, port, path: urlPath, timeout: 5000 }, (response) => {
            response.resume();
            response.on("end", () => resolve(response.statusCode));
        });

        request.on("timeout", () => request.destroy(new Error("timeout")));
        request.on("error", reject);
    });
}

// proba polaczenia TCP: zwraca "polaczono" albo kod bledu (np. ECONNREFUSED)
function tryConnect(host, port) {
    return new Promise((resolve) => {
        const socket = net.connect({ host, port });

        socket.setTimeout(3000);
        socket.on("connect", () => { socket.destroy(); resolve("polaczono"); });
        socket.on("timeout", () => { socket.destroy(); resolve("timeout"); });
        socket.on("error", (error) => resolve(error.code));
    });
}

// adres IPv4 tego komputera w sieci (nie 127.0.0.1); undefined, gdy komputer nie ma zadnej sieci
function getLanAddress() {
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses || []) {
            if (address.family === "IPv4" && !address.internal) {
                return address.address;
            }
        }
    }

    return undefined;
}

const stackTracePattern = /^\s+at .+\(?.+:\d+:\d+\)?\s*$/m;

const baseApp = loadApp(null);

// ---------------------------------------------------------------- G4: HOST

test("G3b+G4: HOST domyslnie to 127.0.0.1", () => {
    assert.equal(baseApp.HOST, "127.0.0.1");
});

test("G3b+G4: HOST bierze wartosc ze zmiennej srodowiskowej HOST", () => {
    assert.equal(loadApp(null, { HOST: "0.0.0.0" }).HOST, "0.0.0.0");
});

test("G3b+G4: pusta zmienna HOST daje 127.0.0.1", () => {
    assert.equal(loadApp(null, { HOST: "" }).HOST, "127.0.0.1");
});

test("G3b+G4: startServer bez argumentow wola app.listen(PORT, HOST) z wartosciami ze zmiennych", (t) => {
    const loaded = loadApp(null, { HOST: "0.0.0.0", PORT: "4567" });
    const listenCalls = [];

    t.mock.method(loaded.app, "listen", (...args) => {
        listenCalls.push(args);
        return new EventEmitter();
    });

    loaded.startServer();

    assert.equal(listenCalls.length, 1);
    assert.equal(String(listenCalls[0][0]), "4567");
    assert.equal(listenCalls[0][1], "0.0.0.0");
});

test("G3b+G4: startServer z domyslnym HOST naprawde nasluchuje na 127.0.0.1", async (t) => {
    const { spawnImpl } = makeFakeSpawn(() => ({ stdout: ["1.2.3\n"], code: 0 }));
    const loaded = loadApp(spawnImpl);

    t.mock.method(console, "log", () => {});

    const server = loaded.startServer(0);

    t.after(() => new Promise(resolve => server.close(resolve)));

    await new Promise((resolve, reject) => {
        server.on("listening", resolve);
        server.on("error", reject);
    });

    assert.equal(server.address().address, "127.0.0.1");
    assert.equal(server.address().family, "IPv4");
});

// ---------------------------------------------------------------- G3b: podpowiedz instalacji

test("G3b+G4: podpowiedz instalacji na Windowsie to winget install yt-dlp.yt-dlp", () => {
    const hint = baseApp.buildInstallHint("win32");

    assert.ok(hint.includes("winget install yt-dlp.yt-dlp"), hint);
    assert.ok(!hint.includes("brew"), hint);
    assert.ok(hint.includes("README"), hint);
});

test("G3b+G4: podpowiedz instalacji na macOS to brew install yt-dlp ffmpeg", () => {
    const hint = baseApp.buildInstallHint("darwin");

    assert.ok(hint.includes("brew install yt-dlp ffmpeg"), hint);
    assert.ok(!hint.includes("winget"), hint);
    assert.ok(hint.includes("README"), hint);
});

for (const platform of ["linux", "freebsd", "openbsd"]) {
    test(`G3b+G4: podpowiedz instalacji na systemie ${platform} odsyla do menedzera pakietow i README`, () => {
        const hint = baseApp.buildInstallHint(platform);

        assert.ok(/mened[zż]era pakiet[oó]w/i.test(hint), hint);
        assert.ok(hint.includes("README"), hint);
        assert.ok(!hint.includes("winget"), hint);
        assert.ok(!hint.includes("brew"), hint);
    });
}

test("G3b+G4: podpowiedz bez argumentu jest dobrana do systemu, na ktorym dziala program", () => {
    assert.equal(baseApp.buildInstallHint(), baseApp.buildInstallHint(process.platform));
});

// ---------------------------------------------------------------- G3b: wersja z wyjscia programu

const versionCases = [
    ["sam numer (yt-dlp)", "2026.03.17\n", "2026.03.17"],
    ["sam numer z \\r\\n", "2026.03.17\r\n", "2026.03.17"],
    ["linia ffmpeg", "ffmpeg version 7.1.1 Copyright (c) 2000-2025 the FFmpeg developers\nbuilt with gcc 14\n", "7.1.1"],
    ["linia ffmpeg z wersja z gita", "ffmpeg version N-124279-g0f6ba39122-20260430 Copyright (c) 2000-2026 the FFmpeg developers\r\nbuilt with gcc\r\n", "N-124279-g0f6ba39122-20260430"],
    ["puste linie na poczatku", "\n\n  2025.01.02  \nreszta\n", "2025.01.02"],
    ["tylko pierwsza linia sie liczy", "1.0\nffmpeg version 9.9\n", "1.0"],
    ["pusty tekst", "", ""],
    ["same biale znaki", " \r\n \n", ""]
];

for (const [name, output, expected] of versionCases) {
    test(`G3b+G4: extractVersion - ${name}`, () => {
        assert.equal(baseApp.extractVersion(output), expected);
    });
}

// ---------------------------------------------------------------- G3b: checkProgramVersion na atrapie spawn

test("G3b+G4: checkProgramVersion uruchamia podany program z podanymi argumentami i zwraca wersje", async () => {
    const { spawnImpl, calls } = makeFakeSpawn(() => ({ stdout: ["2026.", "03.17\n"], stderr: ["WARNING: cos\n"], code: 0 }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("moj-yt-dlp", ["--version"]);

    assert.deepEqual(result, { ok: true, version: "2026.03.17" });
    assert.deepEqual(calls, [{ command: "moj-yt-dlp", args: ["--version"] }]);
});

test("G3b+G4: checkProgramVersion - brak pliku programu (ENOENT) daje missing: true", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ spawnError: errorWithCode("ENOENT") }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("nie-ma", ["--version"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, true);
});

test("G3b+G4: checkProgramVersion - inny blad uruchomienia (EACCES) daje ok: false bez missing", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ spawnError: errorWithCode("EACCES") }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("bez-uprawnien", ["--version"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, false);
    assert.ok(result.reason.includes("EACCES"), result.reason);
});

test("G3b+G4: checkProgramVersion - kod wyjscia inny niz 0 daje ok: false, nawet gdy cos wypisano", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ stdout: ["1.0\n"], code: 3 }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("zepsuty", ["--version"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, false);
    assert.ok(result.reason.includes("3"), result.reason);
});

test("G3b+G4: checkProgramVersion - kod 0 bez zadnego tekstu daje ok: false", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ stdout: [], code: 0 }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("milczacy", ["--version"]);

    assert.equal(result.ok, false);
});

test("G3b+G4: checkProgramVersion - tekst tylko na stderr nie jest brany za wersje", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ stdout: [], stderr: ["1.0\n"], code: 0 }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("gadajacy-na-stderr", ["--version"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, false);
});

test("G3b+G4: checkProgramVersion nie rzuca, gdy samo spawn rzuca wyjatek", async () => {
    const { spawnImpl } = makeFakeSpawn(() => ({ throws: new Error("zly argument") }));
    const loaded = loadApp(spawnImpl);

    const result = await loaded.checkProgramVersion("cokolwiek", ["--version"]);

    assert.equal(result.ok, false);
    assert.ok(result.reason.includes("zly argument"), result.reason);
});

test("G3b+G4: checkProgramVersion na prawdziwym procesie - Node wypisuje swoja wersje", async () => {
    const result = await baseApp.checkProgramVersion(process.execPath, ["--version"]);

    assert.deepEqual(result, { ok: true, version: process.version });
});

test("G3b+G4: checkProgramVersion na prawdziwym procesie - nieistniejacy plik daje missing: true", async () => {
    const result = await baseApp.checkProgramVersion(missingProgram, ["--version"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, true);
});

test("G3b+G4: checkProgramVersion na prawdziwym procesie - program konczacy sie bledem daje ok: false", async () => {
    const result = await baseApp.checkProgramVersion(process.execPath, ["-e", "console.log('1.0'); process.exit(4)"]);

    assert.equal(result.ok, false);
    assert.equal(result.missing, false);
});

// ---------------------------------------------------------------- G3b: tresc wypisywana w konsoli

test("G3b+G4: buildProgramReport - znaleziony program to jedna linia z nazwa i wersja", () => {
    const lines = baseApp.buildProgramReport("yt-dlp", "yt-dlp", { ok: true, version: "2026.03.17" }, "win32");

    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("yt-dlp"), lines[0]);
    assert.ok(lines[0].includes("2026.03.17"), lines[0]);
    assert.ok(!/brak/i.test(lines[0]), lines[0]);
});

for (const platform of ["win32", "darwin", "linux"]) {
    test(`G3b+G4: buildProgramReport - brak programu na ${platform}: nazwa, sciezka i podpowiedz dla tego systemu`, () => {
        const lines = baseApp.buildProgramReport("ffmpeg", "/gdzies/ffmpeg", { ok: false, missing: true, reason: "spawn ENOENT" }, platform);
        const text = lines.join("\n");

        assert.ok(/brak programu ffmpeg/i.test(text), text);
        assert.ok(text.includes("/gdzies/ffmpeg"), text);
        assert.ok(text.includes(baseApp.buildInstallHint(platform)), text);
    });
}

test("G3b+G4: buildProgramReport - program, ktory jest, ale nie dziala: nazwa, przyczyna i podpowiedz", () => {
    const lines = baseApp.buildProgramReport("yt-dlp", "yt-dlp", { ok: false, missing: false, reason: "program zakonczyl prace z kodem 1" }, "darwin");
    const text = lines.join("\n");

    assert.ok(text.includes("yt-dlp"), text);
    assert.ok(text.includes("program zakonczyl prace z kodem 1"), text);
    assert.ok(text.includes(baseApp.buildInstallHint("darwin")), text);
    assert.ok(!/wersja/i.test(text), text);
});

test("G3b+G4: reportPrograms uruchamia yt-dlp --version i ffmpeg -version i wypisuje obie wersje", async (t) => {
    const { spawnImpl, calls } = makeFakeSpawn((command) => {
        if (command === "moj-yt-dlp") {
            return { stdout: ["2026.03.17\n"], code: 0 };
        }

        return { stdout: ["ffmpeg version 7.1.1 Copyright (c) the FFmpeg developers\n"], code: 0 };
    });

    const loaded = loadApp(spawnImpl, { YTDLP_PATH: "moj-yt-dlp", FFMPEG_PATH: "moj-ffmpeg" });
    const logged = [];

    t.mock.method(console, "log", (...args) => logged.push(args.join(" ")));

    await loaded.reportPrograms();

    assert.deepEqual(calls, [
        { command: "moj-yt-dlp", args: ["--version"] },
        { command: "moj-ffmpeg", args: ["-version"] }
    ]);

    const text = logged.join("\n");

    assert.ok(/yt-dlp.*2026\.03\.17/.test(text), text);
    assert.ok(/ffmpeg.*7\.1\.1/.test(text), text);
    assert.ok(!/brak/i.test(text), text);
});

test("G3b+G4: reportPrograms - brak tylko ffmpeg: wersja yt-dlp i informacja o braku ffmpeg z podpowiedzia", async (t) => {
    const { spawnImpl } = makeFakeSpawn((command) => {
        if (command === "moj-yt-dlp") {
            return { stdout: ["2026.03.17\n"], code: 0 };
        }

        return { spawnError: errorWithCode("ENOENT") };
    });

    const loaded = loadApp(spawnImpl, { YTDLP_PATH: "moj-yt-dlp", FFMPEG_PATH: "moj-ffmpeg" });
    const logged = [];

    t.mock.method(console, "log", (...args) => logged.push(args.join(" ")));

    await loaded.reportPrograms();

    const text = logged.join("\n");

    assert.ok(/yt-dlp.*2026\.03\.17/.test(text), text);
    assert.ok(/brak programu ffmpeg/i.test(text), text);
    assert.ok(!/brak programu yt-dlp/i.test(text), text);
    assert.ok(text.includes("moj-ffmpeg"), text);
    assert.ok(text.includes(loaded.buildInstallHint()), text);
});

// ---------------------------------------------------------------- G3b: zajety port

test("G3b+G4: buildPortInUseMessage podaje numer portu i zmienna PORT", () => {
    const message = baseApp.buildPortInUseMessage(3000);

    assert.ok(message.includes("3000"), message);
    assert.ok(/zaj[eę]ty/i.test(message), message);
    assert.ok(/\bPORT\b/.test(message), message);
    assert.ok(!message.includes("\n"), message);
});

// ---------------------------------------------------------------- prawdziwy start "node app.js"

test("G3b+G4: node app.js wypisuje adres http://localhost:<port>, wersje programu i odpowiada na 127.0.0.1", { timeout: 30000 }, async (t) => {
    const port = await getFreePort();
    const state = startApp(t, { PORT: String(port), YTDLP_PATH: process.execPath, FFMPEG_PATH: missingProgram });

    await waitFor(state, () => state.stdout.includes(`http://localhost:${port}`), "adres w konsoli");
    await waitFor(
        state,
        () => state.stdout.includes(process.version) && state.stdout.includes(baseApp.buildInstallHint(process.platform)),
        "wynik sprawdzenia programow"
    );

    // za yt-dlp podstawiony jest Node, wiec "wersja yt-dlp" to wersja Node
    assert.ok(new RegExp(`yt-dlp.*${process.version.replace(/\./g, "\\.")}`).test(state.stdout), state.stdout);

    // brak ffmpeg: informacja z podpowiedzia dla tego systemu, a serwer dziala dalej
    assert.ok(/brak programu ffmpeg/i.test(state.stdout), state.stdout);
    assert.ok(state.stdout.includes(missingProgram), state.stdout);
    assert.ok(state.stdout.includes(baseApp.buildInstallHint(process.platform)), state.stdout);
    assert.ok(!/brak programu yt-dlp/i.test(state.stdout), state.stdout);

    assert.equal(await httpGetStatus("127.0.0.1", port), 200);
    assert.equal(state.exitCode, undefined, "serwer nie moze sie zakonczyc z powodu braku programu");
    assert.ok(!stackTracePattern.test(state.stdout + state.stderr), state.stdout + state.stderr);
});

test("G3b+G4: node app.js z blednym YTDLP_PATH wypisuje informacje o braku yt-dlp i dziala dalej", { timeout: 30000 }, async (t) => {
    const port = await getFreePort();
    const state = startApp(t, { PORT: String(port), YTDLP_PATH: missingProgram, FFMPEG_PATH: process.execPath });

    const hint = baseApp.buildInstallHint(process.platform);

    // podpowiedz jest osobna linia po informacji o braku, wiec czekamy na obie
    await waitFor(state, () => /brak programu yt-dlp/i.test(state.stdout) && state.stdout.includes(hint), "informacja o braku yt-dlp z podpowiedzia");

    assert.ok(state.stdout.includes(missingProgram), state.stdout);
    assert.ok(state.stdout.includes(`http://localhost:${port}`), state.stdout);

    assert.equal(await httpGetStatus("127.0.0.1", port), 200);
    assert.equal(state.exitCode, undefined);
    assert.ok(!stackTracePattern.test(state.stdout + state.stderr), state.stdout + state.stderr);
});

test("G3b+G4: node app.js domyslnie nie przyjmuje polaczen na adresie sieciowym komputera", { timeout: 30000 }, async (t) => {
    const lanAddress = getLanAddress();

    if (!lanAddress) {
        t.skip("komputer nie ma adresu IPv4 poza 127.0.0.1");
        return;
    }

    const port = await getFreePort();
    const state = startApp(t, { PORT: String(port), YTDLP_PATH: missingProgram, FFMPEG_PATH: missingProgram });

    await waitFor(state, () => state.stdout.includes(`http://localhost:${port}`), "adres w konsoli");

    // brak obu programow: kazdy dostaje wlasna informacje
    await waitFor(
        state,
        () => /brak programu yt-dlp/i.test(state.stdout) && /brak programu ffmpeg/i.test(state.stdout),
        "informacje o braku obu programow"
    );

    assert.equal(await tryConnect("127.0.0.1", port), "polaczono");
    assert.notEqual(await tryConnect(lanAddress, port), "polaczono");
});

test("G3b+G4: drugi egzemplarz na zajetym porcie wypisuje zrozumiale zdanie bez sladu stosu i sam sie konczy", { timeout: 30000 }, async (t) => {
    const occupant = net.createServer();

    await new Promise((resolve, reject) => {
        occupant.on("error", reject);
        occupant.listen(0, "127.0.0.1", resolve);
    });

    t.after(() => new Promise(resolve => occupant.close(resolve)));

    const port = occupant.address().port;
    const state = startApp(t, { PORT: String(port), YTDLP_PATH: missingProgram, FFMPEG_PATH: missingProgram });

    await waitFor(state, () => state.exitCode !== undefined, "zakonczenie programu");

    const output = state.stdout + state.stderr;

    assert.equal(state.exitCode, 1);
    assert.ok(output.includes(baseApp.buildPortInUseMessage(String(port))), output);
    assert.ok(!stackTracePattern.test(output), output);
    assert.ok(!output.includes("EADDRINUSE"), output);
    assert.ok(!output.includes("node:"), output);
    assert.ok(!output.includes("http://localhost"), "nie moze wypisac adresu, skoro nie wystartowal:\n" + output);
});

test("G3b+G4: dwa egzemplarze node app.js na tym samym porcie - pierwszy dziala, drugi konczy sie zdaniem o zajetym porcie", { timeout: 30000 }, async (t) => {
    const port = await getFreePort();
    const env = { PORT: String(port), YTDLP_PATH: missingProgram, FFMPEG_PATH: missingProgram };

    const first = startApp(t, env);

    await waitFor(first, () => first.stdout.includes(`http://localhost:${port}`), "start pierwszego egzemplarza");

    const second = startApp(t, env);

    await waitFor(second, () => second.exitCode !== undefined, "zakonczenie drugiego egzemplarza");

    assert.equal(second.exitCode, 1);
    assert.ok(second.stderr.includes(`Port ${port} jest zajety`), second.stdout + second.stderr);
    assert.ok(!stackTracePattern.test(second.stdout + second.stderr), second.stdout + second.stderr);

    // pierwszy egzemplarz dziala dalej
    assert.equal(await httpGetStatus("127.0.0.1", port), 200);
    assert.equal(first.exitCode, undefined);
});
