// Testy zadania UL-2a: okno wyboru folderu (POST /api/folder/wybierz) i zadania tylko z tego samego komputera.
// Zadne prawdziwe okno sie nie otwiera: spawn okna jest zawsze podmieniony na atrape (folderPickerOptions.spawnImpl).
// Zadanie "spoza komputera" jest udawane: zewnetrzny serwer testowy podmienia adres gniazda przed przekazaniem zadania do app.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const express = require("express");
const { EventEmitter } = require("node:events");

const appModule = require(path.join(__dirname, "..", "app.js"));
const {
    app,
    isLoopbackAddress,
    onlyLocalRequests,
    buildWindowsFolderPickerScript,
    buildFolderPickerCommands,
    interpretFolderPickerResult,
    pickFolder,
    folderPickerOptions,
    folderPickerUnavailableMessage
} = appModule;

// atrapa spawn: zapisuje wywolania i odgrywa podany scenariusz procesu
// scenariusz: { stdout, stderr, code } albo { errorCode } (np. "ENOENT") albo { throws: true }
function fakeSpawn(scenarios) {
    const calls = [];
    const list = Array.isArray(scenarios) ? scenarios : [scenarios];

    const impl = (command, args, options) => {
        const scenario = list[Math.min(calls.length, list.length - 1)];
        calls.push({ command, args, options });

        if (scenario.throws) {
            throw new Error("spawn nie wystartowal");
        }

        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();

        setImmediate(() => {
            if (scenario.errorCode) {
                const error = new Error(`spawn ${command} ${scenario.errorCode}`);
                error.code = scenario.errorCode;
                child.emit("error", error);
                child.emit("close", -4058);
                return;
            }

            if (scenario.stdout) {
                child.stdout.emit("data", Buffer.from(scenario.stdout, "utf8"));
            }

            if (scenario.stderr) {
                child.stderr.emit("data", Buffer.from(scenario.stderr, "utf8"));
            }

            child.emit("close", scenario.code);
        });

        return child;
    };

    return { impl, calls };
}

// bezpiecznik: gdyby jakis test zapomnial podstawic atrape, adres okna nie otworzy prawdziwego okna
function guardSpawn() {
    throw new Error("test probowal otworzyc prawdziwe okno wyboru folderu");
}

folderPickerOptions.spawnImpl = guardSpawn;

function setPicker(t, options) {
    Object.assign(folderPickerOptions, options);

    t.after(() => {
        for (const key of Object.keys(folderPickerOptions)) {
            delete folderPickerOptions[key];
        }

        folderPickerOptions.spawnImpl = guardSpawn;
    });
}

function listen(t, handler) {
    return new Promise((resolve) => {
        const server = handler.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));

        t.after(() => {
            server.close();
            server.closeAllConnections();
        });
    });
}

// serwer udajacy zadania z innego komputera w sieci: przed app podmienia adres gniazda nadawcy
function listenAsRemote(t, remoteAddress) {
    const outer = express();

    outer.use((req, res, next) => {
        Object.defineProperty(req.socket, "remoteAddress", { value: remoteAddress, configurable: true });
        next();
    });
    outer.use(app);

    return listen(t, outer);
}

async function post(base, url, body = {}) {
    const response = await fetch(base + url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

function decodeWindowsScript(args) {
    const index = args.indexOf("-EncodedCommand");
    assert.notEqual(index, -1, "skrypt idzie przez -EncodedCommand");

    return Buffer.from(args[index + 1], "base64").toString("utf16le");
}

// --- polecenie okna dla trzech systemow ---

test("Windows: PowerShell w trybie STA bez profilu, skrypt z FolderBrowserDialog na wierzchu", () => {
    const commands = buildFolderPickerCommands("win32", {});

    assert.equal(commands.length, 1);
    assert.equal(commands[0].command, "powershell.exe");

    const { args } = commands[0];
    for (const flag of ["-NoProfile", "-NonInteractive", "-STA"]) {
        assert.ok(args.includes(flag), `brak ${flag}`);
    }
    assert.equal(args[args.length - 2], "-EncodedCommand", "zakodowany skrypt jest ostatnim argumentem");

    const script = decodeWindowsScript(args);
    assert.equal(script, buildWindowsFolderPickerScript(), "base64 to dokladnie skrypt w UTF-16LE");
    assert.match(script, /System\.Windows\.Forms\.FolderBrowserDialog/);
    assert.match(script, /\$owner\.TopMost = \$true/, "wlasciciel okna wymuszony na wierzch");
    assert.match(script, /\$dialog\.ShowDialog\(\$owner\)/, "okno otwierane z wlascicielem TopMost");
    assert.match(script, /OutputEncoding = \[System\.Text\.Encoding\]::UTF8/, "sciezka z polskimi literami w UTF-8");
    assert.match(script, /DialogResult\]::OK\) \{ \[Console\]::Out\.Write\(\$dialog\.SelectedPath\) \}/,
        "sciezka wypisywana tylko po OK");
});

test("macOS: osascript z choose folder i POSIX path", () => {
    const commands = buildFolderPickerCommands("darwin", {});

    assert.deepEqual(commands, [{
        command: "osascript",
        args: ["-e", 'POSIX path of (choose folder with prompt "Wybierz folder docelowy")']
    }]);
});

test("Linux z ekranem: najpierw zenity, potem kdialog", () => {
    const commands = buildFolderPickerCommands("linux", { DISPLAY: ":0", HOME: "/home/ala" });

    assert.deepEqual(commands, [
        { command: "zenity", args: ["--file-selection", "--directory", "--title=Wybierz folder docelowy"] },
        { command: "kdialog", args: ["--getexistingdirectory", "/home/ala", "--title", "Wybierz folder docelowy"] }
    ]);

    assert.equal(buildFolderPickerCommands("linux", { WAYLAND_DISPLAY: "wayland-0" }).length, 2, "Wayland tez ma ekran");
});

test("Linux bez ekranu (DISPLAY i WAYLAND_DISPLAY puste): nie ma czym otworzyc okna", () => {
    assert.deepEqual(buildFolderPickerCommands("linux", {}), []);
});

// --- odczyt wyniku procesu ---

test("wynik procesu: wybrano folder", () => {
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "D:\\Muzyka\\Pobrane" }),
        { result: "selected", folder: "D:\\Muzyka\\Pobrane" });
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "C:\\" }),
        { result: "selected", folder: "C:\\" }, "korzen dysku zostaje z ukosnikiem");
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "D:\\Muzyka\\" }),
        { result: "selected", folder: "D:\\Muzyka" }, "koncowy ukosnik znika tez na Windowsie");
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "\\\\serwer\\udzial\\Filmy" }),
        { result: "selected", folder: "\\\\serwer\\udzial\\Filmy" }, "folder sieciowy to tez wybor");
    assert.deepEqual(interpretFolderPickerResult("darwin", { code: 0, stdout: "/Users/ala/Muzyka/\n" }),
        { result: "selected", folder: "/Users/ala/Muzyka" }, "koncowy ukosnik i znak konca linii znikaja");
    assert.deepEqual(interpretFolderPickerResult("linux", { code: 0, stdout: "/home/ala/Zażółć gęślą\n" }),
        { result: "selected", folder: "/home/ala/Zażółć gęślą" });
    assert.deepEqual(interpretFolderPickerResult("linux", { code: 0, stdout: "/\n" }),
        { result: "selected", folder: "/" });
});

test("wynik procesu: okno zamkniete bez wyboru", () => {
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "" }), { result: "cancelled" });
    assert.deepEqual(interpretFolderPickerResult("darwin", { code: 1, stderr: "execution error: User canceled. (-128)" }), { result: "cancelled" });
    assert.deepEqual(interpretFolderPickerResult("linux", { code: 1, stdout: "" }), { result: "cancelled" });
});

test("wynik procesu: okna nie da sie otworzyc", () => {
    const unavailable = { result: "unavailable", message: folderPickerUnavailableMessage };

    assert.deepEqual(interpretFolderPickerResult("win32", { code: 1, stderr: "Add-Type: blad" }), unavailable, "blad skryptu PowerShell");
    assert.deepEqual(interpretFolderPickerResult("darwin", { code: 1, stderr: "execution error: brak dostepu (-1743)" }), unavailable);
    assert.deepEqual(interpretFolderPickerResult("linux", { code: 255, stderr: "cannot open display" }), unavailable);
    assert.deepEqual(interpretFolderPickerResult("linux", { error: new Error("EACCES") }), unavailable);
    assert.deepEqual(interpretFolderPickerResult("win32", { code: 0, stdout: "Muzyka\\Pobrane" }), unavailable, "sciezka wzgledna to nie wybor");
    assert.match(folderPickerUnavailableMessage, /ręcznie/);
});

// --- pickFolder z atrapa procesu ---

test("pickFolder: trzy rodzaje odpowiedzi przy podstawionym wyniku procesu", async () => {
    const selected = fakeSpawn({ code: 0, stdout: "D:\\Pobrane" });
    assert.deepEqual(await pickFolder({ platform: "win32", spawnImpl: selected.impl }), { result: "selected", folder: "D:\\Pobrane" });
    assert.equal(selected.calls.length, 1);
    assert.equal(selected.calls[0].command, "powershell.exe");
    assert.equal(selected.calls[0].options.windowsHide, true, "bez migajacego okna konsoli");

    const cancelled = fakeSpawn({ code: 0, stdout: "" });
    assert.deepEqual(await pickFolder({ platform: "win32", spawnImpl: cancelled.impl }), { result: "cancelled" });

    const missing = fakeSpawn({ errorCode: "ENOENT" });
    assert.deepEqual(await pickFolder({ platform: "darwin", spawnImpl: missing.impl }),
        { result: "unavailable", message: folderPickerUnavailableMessage });

    const throwing = fakeSpawn({ throws: true });
    assert.deepEqual(await pickFolder({ platform: "win32", spawnImpl: throwing.impl }),
        { result: "unavailable", message: folderPickerUnavailableMessage });
});

test("pickFolder na Linuksie: brak zenity -> kdialog; brak obu -> okna nie da sie otworzyc", async () => {
    const env = { DISPLAY: ":0", HOME: "/home/ala" };

    const fallback = fakeSpawn([{ errorCode: "ENOENT" }, { code: 0, stdout: "/home/ala/Filmy\n" }]);
    assert.deepEqual(await pickFolder({ platform: "linux", env, spawnImpl: fallback.impl }), { result: "selected", folder: "/home/ala/Filmy" });
    assert.deepEqual(fallback.calls.map((call) => call.command), ["zenity", "kdialog"]);

    const zenityCancel = fakeSpawn([{ code: 1 }, { code: 0, stdout: "/nie/powinno" }]);
    assert.deepEqual(await pickFolder({ platform: "linux", env, spawnImpl: zenityCancel.impl }), { result: "cancelled" });
    assert.equal(zenityCancel.calls.length, 1, "zamkniecie okna zenity nie otwiera drugiego okna");

    const none = fakeSpawn({ errorCode: "ENOENT" });
    assert.deepEqual(await pickFolder({ platform: "linux", env, spawnImpl: none.impl }),
        { result: "unavailable", message: folderPickerUnavailableMessage });
    assert.equal(none.calls.length, 2);

    const noDisplay = fakeSpawn({ code: 0, stdout: "/x" });
    assert.deepEqual(await pickFolder({ platform: "linux", env: {}, spawnImpl: noDisplay.impl }),
        { result: "unavailable", message: folderPickerUnavailableMessage });
    assert.equal(noDisplay.calls.length, 0, "bez ekranu niczego nie uruchamia");
});

// --- adres POST /api/folder/wybierz ---

test("POST /api/folder/wybierz zwraca trzy rodzaje odpowiedzi", async (t) => {
    const base = await listen(t, app);

    setPicker(t, { platform: "win32", spawnImpl: fakeSpawn({ code: 0, stdout: "D:\\Muzyka\\Pobrane" }).impl });
    let reply = await post(base, "/api/folder/wybierz");
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json, { success: true, result: "selected", folder: "D:\\Muzyka\\Pobrane" });

    folderPickerOptions.spawnImpl = fakeSpawn({ code: 0, stdout: "" }).impl;
    reply = await post(base, "/api/folder/wybierz");
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json, { success: false, result: "cancelled" });

    folderPickerOptions.spawnImpl = fakeSpawn({ errorCode: "ENOENT" }).impl;
    reply = await post(base, "/api/folder/wybierz");
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.json, { success: false, result: "unavailable", message: folderPickerUnavailableMessage });
});

// --- tylko ten sam komputer ---

test("isLoopbackAddress: petla zwrotna IPv4 i IPv6 tak, reszta nie", () => {
    for (const address of ["127.0.0.1", "127.1.2.3", "::1", "::ffff:127.0.0.1", "::FFFF:127.0.0.1", "0:0:0:0:0:0:0:1"]) {
        assert.equal(isLoopbackAddress(address), true, address);
    }

    for (const address of ["192.168.1.20", "10.0.0.5", "::ffff:192.168.1.20", "fe80::1", "0.0.0.0", "::", "128.0.0.1",
        "127.0.0.1.evil", "1127.0.0.1", "", undefined, null]) {
        assert.equal(isLoopbackAddress(address), false, String(address));
    }
});

test("onlyLocalRequests: przepuszcza petle zwrotna, inne dostaja 403", () => {
    let nextCalls = 0;
    const next = () => { nextCalls++; };
    const fakeRes = () => ({
        statusCode: 200,
        body: null,
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    });

    const local = fakeRes();
    onlyLocalRequests({ socket: { remoteAddress: "::ffff:127.0.0.1" } }, local, next);
    assert.equal(nextCalls, 1);
    assert.equal(local.body, null);

    const remote = fakeRes();
    onlyLocalRequests({ socket: { remoteAddress: "192.168.1.20" } }, remote, next);
    assert.equal(nextCalls, 1, "zadanie z sieci nie idzie dalej");
    assert.equal(remote.statusCode, 403);
    assert.equal(remote.body.success, false);

    const noSocket = fakeRes();
    onlyLocalRequests({}, noSocket, next);
    assert.equal(noSocket.statusCode, 403, "bez adresu nadawcy tez 403");
});

test("zadanie spoza komputera: /api/download i /api/folder/... dostaja 403 i niczego nie uruchamiaja", async (t) => {
    const base = await listenAsRemote(t, "192.168.1.20");
    const picker = fakeSpawn({ code: 0, stdout: "D:\\Pobrane" });
    setPicker(t, { platform: "win32", spawnImpl: picker.impl });

    const download = await post(base, "/api/download", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", type: "audio", format: "mp3", bitrate: "best" });
    assert.equal(download.status, 403);
    assert.equal(download.json.success, false);
    assert.match(download.json.message, /tylko z komputera/);
    assert.equal(appModule.activeJobs.size, 0, "nie powstalo zadanie pobierania");

    const choose = await post(base, "/api/folder/wybierz");
    assert.equal(choose.status, 403);
    assert.equal(picker.calls.length, 0, "okno wyboru nie zostalo otwarte");

    const other = await post(base, "/api/folder/pokaz", { plik: "C:\\x.mp3" });
    assert.equal(other.status, 403, "kazdy adres /api/folder/... jest chroniony, takze przyszle");
});

test("zadanie spoza komputera zapisane jako IPv6 (np. przy HOST=::) tez dostaje 403", async (t) => {
    const base = await listenAsRemote(t, "fe80::1234");

    const download = await post(base, "/api/download", {});
    assert.equal(download.status, 403);
});

test("zadanie z tego samego komputera przechodzi przez ochrone", async (t) => {
    const base = await listen(t, app);
    setPicker(t, { platform: "win32", spawnImpl: fakeSpawn({ code: 0, stdout: "D:\\Pobrane" }).impl });

    // puste zadanie odpada dopiero na sprawdzaniu pol (400), a nie na ochronie (403)
    const download = await post(base, "/api/download", {});
    assert.equal(download.status, 400);

    const choose = await post(base, "/api/folder/wybierz");
    assert.equal(choose.status, 200);
    assert.equal(choose.json.result, "selected");
});

test("udawany adres z sieci w wrapperze rzeczywiscie trafia do ochrony (sprawdzenie samego testu)", async (t) => {
    // ten sam wrapper z adresem petli zwrotnej przepuszcza zadanie - czyli 403 wyzej daje adres, a nie sam wrapper
    const base = await listenAsRemote(t, "127.0.0.1");

    const download = await post(base, "/api/download", {});
    assert.equal(download.status, 400);
});
