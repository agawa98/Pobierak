// Testy zadania UL-4: czerwone ostrzezenie, gdy yt-dlp ma ponad 90 dni.
// "Dzisiejsza" data jest zawsze podstawiona (argument albo atrapa zegara t.mock.timers) - wynik nie zalezy od zegara.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: spawn jest podmieniony na atrape.
// Serwer slucha na losowym wolnym porcie 127.0.0.1.

const { folderDocelowy } = require("./folder-docelowy-pomoc");       // UL-2b: zadanie pobrania musi miec pole folder
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");
const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");
const styleSource = fs.readFileSync(path.join(__dirname, "..", "public", "style.css"), "utf8");

// wczytuje swieza kopie app.js (stan ostrzezenia jest w module). spawnImpl - atrapa spawn albo null
function loadApp(spawnImpl = null) {
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
            if (savedEnv[name] !== undefined) {
                process.env[name] = savedEnv[name];
            }
        }
    }
}

// atrapa spawn: kazde wywolanie dostaje kolejny scenariusz { stdout, stderr, code } (ostatni sie powtarza)
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

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

// ustawia process.stdout.isTTY na czas testu
function setStdoutIsTTY(t, value) {
    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");

    Object.defineProperty(process.stdout, "isTTY", { value, configurable: true, writable: true });

    t.after(() => {
        if (descriptor) {
            Object.defineProperty(process.stdout, "isTTY", descriptor);
        } else {
            delete process.stdout.isTTY;
        }
    });
}

// "dzisiaj" w testach: 15 listopada 2026 (czas lokalny). 2026.08.17 ma wtedy 90 dni, 2026.08.16 - 91 dni
const today = new Date(2026, 10, 15, 12, 0, 0);
const commands = {
    win32: "winget upgrade --id yt-dlp.yt-dlp -e",
    darwin: "brew upgrade yt-dlp",
    linux: "sudo yt-dlp -U (oficjalny plik) albo pipx upgrade yt-dlp (pipx)"
};
const warning91 = `UWAGA: yt-dlp jest z 2026.08.16 (91 dni). Jeśli pobieranie nie działa, zaktualizuj: ${commands.win32}`;

const app = loadApp();

// ---------- wiek wersji i tresc ostrzezenia ----------

test("UL-4: 90 dni - bez ostrzezenia, 91 dni - jest ostrzezenie", () => {
    assert.equal(app.ytDlpMaxAgeDays, 90);
    assert.equal(app.buildYtDlpAgeWarning("2026.08.17", today, "win32"), null);
    assert.equal(app.buildYtDlpAgeWarning("2026.08.16", today, "win32"), warning91);
    assert.equal(app.buildYtDlpAgeWarning("2026.11.15", today, "win32"), null, "wersja z dzisiaj");
});

test("UL-4: godzina dzisiejszego dnia nie zmienia liczby dni (takze po zmianie czasu z letniego na zimowy)", () => {
    for (const hour of [[0, 0, 1], [23, 59, 59]]) {
        const moment = new Date(2026, 10, 15, ...hour);

        assert.equal(app.buildYtDlpAgeWarning("2026.08.17", moment, "win32"), null, `godzina ${hour.join(":")}`);
        assert.equal(app.buildYtDlpAgeWarning("2026.08.16", moment, "win32"), warning91, `godzina ${hour.join(":")}`);
    }
});

test("UL-4: duzo starsza wersja - liczba dni przez granice roku", () => {
    const warning = app.buildYtDlpAgeWarning("2025.11.15", today, "darwin");

    assert.equal(warning, `UWAGA: yt-dlp jest z 2025.11.15 (365 dni). Jeśli pobieranie nie działa, zaktualizuj: ${commands.darwin}`);
});

test("UL-4: wydanie nocne (data z czwarta czescia) tez jest data", () => {
    assert.equal(
        app.buildYtDlpAgeWarning("2026.08.16.232946", today, "win32"),
        warning91
    );
    assert.equal(app.buildYtDlpAgeWarning("2026.08.17.232946", today, "win32"), null);
});

test("UL-4: numer wersji w innym formacie niz data - bez ostrzezenia", () => {
    const others = ["1.2.3", "2020.1.1", "stable@2020.01.01", "2020-01-01", "20200101", "2020.01.01-dev", "abc", "", "2020.02.31", "2020.13.01", null, undefined];

    for (const version of others) {
        assert.equal(app.buildYtDlpAgeWarning(version, today, "win32"), null, `wersja ${JSON.stringify(version)}`);
    }
});

test("UL-4: tresc linii dla Windows, macOS i Linuksa", () => {
    for (const [platform, command] of Object.entries(commands)) {
        assert.equal(app.buildYtDlpUpdateCommand(platform), command);
        assert.equal(
            app.buildYtDlpAgeWarning("2026.08.16", today, platform),
            `UWAGA: yt-dlp jest z 2026.08.16 (91 dni). Jeśli pobieranie nie działa, zaktualizuj: ${command}`,
            platform
        );
    }

    // inne systemy z rodziny Unix dostaja to samo co Linux
    assert.equal(app.buildYtDlpUpdateCommand("freebsd"), commands.linux);
});

test("UL-4: komendy aktualizacji zgadzaja sie z tabela aktualizacji w README", () => {
    const readme = fs.readFileSync(path.join(__dirname, "..", "README.md"), "utf8");

    for (const command of ["winget upgrade --id yt-dlp.yt-dlp -e", "brew upgrade yt-dlp", "yt-dlp -U", "pipx upgrade yt-dlp"]) {
        assert.ok(readme.includes(`\`${command}\``), `README nie zawiera komendy ${command}`);
    }
});

// ---------- kolor w konsoli ----------

test("UL-4: kody ANSI tylko w terminalu", () => {
    assert.equal(app.colorRedForConsole("tekst", true), "\x1b[31mtekst\x1b[0m");
    assert.equal(app.colorRedForConsole("tekst", false), "tekst");
});

// reportPrograms z atrapa spawn (yt-dlp wypisuje podana wersje, ffmpeg swoja) i atrapa zegara. zwraca wypisane linie
async function runReportPrograms(t, version, isTTY) {
    const { spawnImpl } = makeFakeSpawn([
        { stdout: [`${version}\n`], code: 0 },
        { stdout: ["ffmpeg version 7.1 Copyright (c) 2000-2024\n"], code: 0 }
    ]);
    const loaded = loadApp(spawnImpl);
    const lines = [];

    setStdoutIsTTY(t, isTTY);
    t.mock.method(console, "log", (...args) => lines.push(args.join(" ")));
    t.mock.timers.enable({ apis: ["Date"], now: today });

    await loaded.reportPrograms();

    return { lines, loaded };
}

test("UL-4: reportPrograms - stara wersja: czerwona linia ostrzezenia zaraz pod linia z wersja (terminal)", async (t) => {
    const { lines, loaded } = await runReportPrograms(t, "2026.08.16", true);
    const expected = app.buildYtDlpAgeWarning("2026.08.16", today);

    assert.deepEqual(lines, [
        "yt-dlp: wersja 2026.08.16",
        `\x1b[31m${expected}\x1b[0m`,
        "ffmpeg: wersja 7.1"
    ]);
    assert.equal(loaded.getYtDlpWarning(), expected);
});

test("UL-4: reportPrograms - wyjscie nie jest terminalem: ostrzezenie bez kodow ANSI", async (t) => {
    const { lines } = await runReportPrograms(t, "2026.08.16", undefined);

    assert.deepEqual(lines, [
        "yt-dlp: wersja 2026.08.16",
        app.buildYtDlpAgeWarning("2026.08.16", today),
        "ffmpeg: wersja 7.1"
    ]);
    assert.equal(lines.some(line => line.includes("\x1b")), false);
});

test("UL-4: reportPrograms - swieza wersja albo numer w innym formacie: bez ostrzezenia", async (t) => {
    for (const version of ["2026.08.17", "1.2.3"]) {
        await t.test(version, async (t) => {
            const { lines, loaded } = await runReportPrograms(t, version, true);

            assert.deepEqual(lines, [`yt-dlp: wersja ${version}`, "ffmpeg: wersja 7.1"]);
            assert.equal(loaded.getYtDlpWarning(), null);
        });
    }
});

test("UL-4: reportPrograms - brak yt-dlp: bez ostrzezenia o wieku", async (t) => {
    const missing = Object.assign(new Error("spawn yt-dlp ENOENT"), { code: "ENOENT" });
    const { spawnImpl } = makeFakeSpawn([{ spawnError: missing }, { stdout: ["ffmpeg version 7.1\n"], code: 0 }]);
    const loaded = loadApp(spawnImpl);
    const lines = [];

    t.mock.method(console, "log", (...args) => lines.push(args.join(" ")));
    await loaded.reportPrograms();

    assert.equal(lines.some(line => line.includes("UWAGA")), false, JSON.stringify(lines));
    assert.equal(loaded.getYtDlpWarning(), null);
});

// ---------- logi dla strony ----------

function startServer(t, loaded) {
    return new Promise((resolve) => {
        const server = loaded.app.listen(0, "127.0.0.1", () => resolve(server));

        t.after(() => {
            server.close();
            server.closeAllConnections();
        });
    });
}

// laczy sie z /api/logs i zbiera zdarzenia { type, message }. waitFor(warunek) czeka, az lista zdarzen go spelni
function connectLogs(t, server) {
    const events = [];
    const waiters = [];
    let buffer = "";

    const check = () => {
        for (const waiter of waiters.slice()) {
            if (waiter.condition(events)) {
                waiters.splice(waiters.indexOf(waiter), 1);
                waiter.resolve();
            }
        }
    };

    return new Promise((resolve, reject) => {
        const request = http.get(`http://127.0.0.1:${server.address().port}/api/logs`, (response) => {
            response.setEncoding("utf8");
            response.on("data", (chunk) => {
                buffer += chunk;

                const parts = buffer.split("\n\n");

                buffer = parts.pop();
                parts.forEach(part => events.push(JSON.parse(part.replace(/^data: /, ""))));
                check();
            });

            resolve({
                events,
                waitFor(condition) {
                    return new Promise((done, fail) => {
                        const timer = setTimeout(() => fail(new Error(`nie doczekano sie zdarzen, sa: ${JSON.stringify(events)}`)), 5000);

                        waiters.push({ condition, resolve: () => { clearTimeout(timer); done(); } });
                        check();
                    });
                }
            });
        });

        request.on("error", reject);
        t.after(() => request.destroy());
    });
}

const hasMarker = marker => events => events.some(event => event.message === marker);

test("UL-4: przy polaczeniu z logami ostrzezenie typu warning przychodzi zaraz po powitaniu", async (t) => {
    const loaded = loadApp();
    const warning = loaded.setYtDlpVersion("2026.08.16", today, "win32");
    const server = await startServer(t, loaded);
    const logs = await connectLogs(t, server);

    await logs.waitFor(events => events.length >= 2);

    assert.deepEqual(logs.events.slice(0, 2), [
        { type: "system", message: "Połączono z logami backendu." },
        { type: "warning", message: warning91 }
    ]);
    assert.equal(warning, warning91);

    // kazda strona przy swoim polaczeniu dostaje je od nowa
    const second = await connectLogs(t, server);

    await second.waitFor(events => events.length >= 2);
    assert.deepEqual(second.events[1], { type: "warning", message: warning91 });
});

test("UL-4: swieza wersja - przy polaczeniu z logami nie ma ostrzezenia", async (t) => {
    const loaded = loadApp();

    assert.equal(loaded.setYtDlpVersion("2026.08.17", today, "win32"), null);

    const server = await startServer(t, loaded);
    const logs = await connectLogs(t, server);

    await logs.waitFor(events => events.length >= 1);
    loaded.sendLogToClients("system", "znacznik");      // gdyby ostrzezenie bylo, przyszloby przed znacznikiem
    await logs.waitFor(hasMarker("znacznik"));

    assert.deepEqual(logs.events, [
        { type: "system", message: "Połączono z logami backendu." },
        { type: "system", message: "znacznik" }
    ]);
});

test("UL-4: wersja zmieniona na swieza kasuje wczesniejsze ostrzezenie", () => {
    const loaded = loadApp();

    loaded.setYtDlpVersion("2026.08.16", today, "win32");
    assert.equal(loaded.setYtDlpVersion("2026.11.01", today, "win32"), null);
    assert.equal(loaded.getYtDlpWarning(), null);
    assert.equal(loaded.buildYtDlpUpdateSentence(), "");

    loaded.setYtDlpVersion("2026.08.16", today, "win32");
    assert.equal(loaded.setYtDlpVersion(null, today, "win32"), null, "wersji nie udalo sie odczytac");
});

// ---------- blad yt-dlp przy pobieraniu ----------

const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";
const ytDlpStderr = "WARNING: x\nERROR: [youtube] jBoKCUKJkiY: Video unavailable\n";
const updateSentence = ` Twój yt-dlp jest stary - zaktualizuj go (${commands.win32}) i spróbuj ponownie.`;

async function postDownload(server, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderDocelowy, ...body }),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

// serwer z atrapa programow i ustawiona wersja yt-dlp, podlaczony klient logow
async function startDownloadServer(t, scenarios, version) {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn(scenarios);
    const loaded = loadApp(spawnImpl);

    loaded.setYtDlpVersion(version, today, "win32");

    const server = await startServer(t, loaded);
    const logs = await connectLogs(t, server);

    await logs.waitFor(events => events.some(event => event.message === "Połączono z logami backendu."));

    return { loaded, server, logs };
}

test("UL-4: blad yt-dlp przy starej wersji - ostrzezenie jest ostatnia linia w logach, a komunikat ma zdanie o aktualizacji", async (t) => {
    const { loaded, server, logs } = await startDownloadServer(t, [{ stderr: [ytDlpStderr], code: 1 }], "2026.08.16");

    const cases = [
        { body: { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects }, label: "YT-DLP AUDIO" },
        { body: { url: testUrl, type: "video", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects }, label: "YT-DLP VIDEO" },
        { body: { url: testUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects }, label: "YT-DLP VIDEO ONLY" }
    ];

    for (const { body, label } of cases) {
        const before = logs.events.length;
        const { status, json } = await postDownload(server, body);

        assert.equal(status, 500, body.type);
        assert.equal(json.success, false);
        assert.equal(json.message, `${label}: [youtube] jBoKCUKJkiY: Video unavailable${updateSentence}`, body.type);

        const marker = `koniec ${body.type}`;

        loaded.sendLogToClients("system", marker);
        await logs.waitFor(hasMarker(marker));

        // nowe zdarzenia: logi yt-dlp, potem jedno ostrzezenie, potem znacznik testu
        const added = logs.events.slice(before);

        assert.deepEqual(added.slice(-2), [{ type: "warning", message: warning91 }, { type: "system", message: marker }], body.type);
        assert.equal(added.filter(event => event.type === "warning").length, 1, body.type);
        assert.ok(added.some(event => event.type === label && event.message.includes("Video unavailable")), body.type);
    }
});

test("UL-4: blad yt-dlp przy swiezej wersji - komunikat bez zmian i bez ostrzezenia w logach", async (t) => {
    const { loaded, server, logs } = await startDownloadServer(t, [{ stderr: [ytDlpStderr], code: 1 }], "2026.08.17");
    const body = { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects };
    const { status, json } = await postDownload(server, body);

    assert.equal(status, 500);
    assert.equal(json.message, "YT-DLP AUDIO: [youtube] jBoKCUKJkiY: Video unavailable");

    loaded.sendLogToClients("system", "koniec");
    await logs.waitFor(hasMarker("koniec"));
    assert.equal(logs.events.some(event => event.type === "warning"), false, JSON.stringify(logs.events));
});

test("UL-4: blad ffmpeg (yt-dlp zadzialal) przy starej wersji - bez ostrzezenia i bez zdania o aktualizacji", async (t) => {
    // yt-dlp konczy sie dobrze, ale nie ma pliku wyniku w downloads: tu wystarczy, ze blad nie pochodzi z yt-dlp
    const { loaded, server, logs } = await startDownloadServer(t, [{ code: 0 }], "2026.08.16");
    const body = { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects };
    const { status, json } = await postDownload(server, body);

    assert.equal(status, 500);
    assert.equal(json.message.includes("Twój yt-dlp jest stary"), false, json.message);

    loaded.sendLogToClients("system", "koniec");
    await logs.waitFor(hasMarker("koniec"));
    assert.equal(logs.events.filter(event => event.type === "warning").length, 1, "tylko to przy polaczeniu");
});

test("UL-4: isYtDlpExitError - tylko proces yt-dlp zakonczony kodem bledu", () => {
    assert.equal(app.isYtDlpExitError({ label: "YT-DLP VIDEO", exitCode: 1 }), true);
    assert.equal(app.isYtDlpExitError({ label: "YT-DLP AUDIO ONLY", exitCode: 2 }), true);
    assert.equal(app.isYtDlpExitError({ label: "FFMPEG", exitCode: 1 }), false);
    assert.equal(app.isYtDlpExitError({ message: "YT-DLP: nie znaleziono programu" }), false, "brak programu (ENOENT)");
    assert.equal(app.isYtDlpExitError(new Error("Nie znaleziono pliku")), false);
    assert.equal(app.isYtDlpExitError(null), false);
});

test("UL-4: runProcess po kodzie bledu podaje etykiete i kod wyjscia", async (t) => {
    muteConsole(t);

    const { spawnImpl } = makeFakeSpawn([{ stderr: ["ERROR: zle\n"], code: 3 }]);
    const loaded = loadApp(spawnImpl);

    await assert.rejects(loaded.runProcess("yt-dlp", [], "YT-DLP VIDEO"), (error) => {
        assert.equal(error.label, "YT-DLP VIDEO");
        assert.equal(error.exitCode, 3);
        assert.equal(error.message, "YT-DLP VIDEO: zle");
        return true;
    });
});

// ---------- strona ----------

// wycina z public/script.js cala funkcje o podanym naglowku (do pierwszej klamry } na poczatku linii)
function cutFunction(header) {
    const start = scriptSource.indexOf(header);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${header}`);

    const rest = scriptSource.slice(start);

    return rest.slice(0, rest.search(/\r?\n\}/)) + "\n}";
}

function buildPage() {
    const createElement = tagName => ({
        tagName: tagName.toUpperCase(),
        className: "",
        childNodes: [],
        appendChild(child) { this.childNodes.push(child); return child; },
        removeChild(child) { this.childNodes.splice(this.childNodes.indexOf(child), 1); return child; },
        get children() { return this.childNodes.filter(node => node.tagName); },
        get firstElementChild() { return this.children[0] || null; },
        set textContent(value) { this.childNodes = [{ text: String(value) }]; }
    });

    const terminalLogs = createElement("div");
    const context = { terminalLogs, document: { createElement, createTextNode: text => ({ text }) } };

    vm.createContext(context);
    vm.runInContext([cutFunction("function trimLogs() {"), cutFunction("function addLog(type, message) {")].join("\n\n"), context);

    return { addLog: context.addLog, terminalLogs };
}

test("UL-4: strona nadaje linii typu warning osobna klase, innym liniom nie", () => {
    const page = buildPage();

    page.addLog("warning", warning91);
    page.addLog("system", "Połączono z logami backendu.");
    page.addLog("error", "blad");
    page.addLog("YT-DLP", "[download] 10%");

    assert.deepEqual(page.terminalLogs.children.map(line => line.className), ["log-warning", "", "", ""]);
});

test("UL-4: style.css rysuje linie log-warning (i jej etykiete) czerwonym, pelnym kolorem", () => {
    const match = styleSource.match(/([^{}]*p\.log-warning[^{}]*)\{([^}]*)\}/);

    assert.ok(match, "brak reguly dla p.log-warning w style.css");
    assert.ok(match[1].includes("p.log-warning span"), "etykieta [warning] tez musi byc czerwona");

    const color = match[2].match(/color:\s*rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)/);

    assert.ok(color, `kolor musi byc pelnym rgb(...) bez przezroczystosci: ${match[2]}`);

    const [red, green, blue] = color.slice(1).map(Number);

    assert.ok(red >= 200 && green < 120 && blue < 120, `to nie jest czerwony: rgb(${red}, ${green}, ${blue})`);
});
