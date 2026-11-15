// Testy zadania UL-2d: przycisk "Pokaż w folderze" po udanym pobraniu.
//
// Serwer: POST /api/folder/pokaz otwiera folder z plikiem, ktory serwer sam zapisal od ostatniego startu.
// Eksplorator nigdy sie nie otwiera: polecenie jest sprawdzane jako dane (buildShowInFolderCommand), a adres dostaje
// atrape spawn przez showInFolderOptions. Pobieranie od poczatku do konca idzie na kopii app.js w os.tmpdir()
// z atrapa yt-dlp i ffmpeg (jak w folder-docelowy.test.js) - nic nie jest pobierane z internetu.
//
// Strona: czesc public/script.js od '// ---------- "Pokaż w folderze"' do 'typeInputs.forEach(' jest wycinana
// i uruchamiana bez przegladarki, na atrapach przycisku, pola linku, fetch i handleDownloadSubmit.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const childProcess = require("node:child_process");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const projectDir = path.join(__dirname, "..");
const appPath = path.join(projectDir, "app.js");
const appModule = require(appPath);
const scriptSource = fs.readFileSync(path.join(projectDir, "public", "script.js"), "utf8");

// ---------- pomocnicze ----------

function makeTempDir(t, prefix) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

// atrapa spawn dla showInFolder. mode: "spawn" (proces wystartowal), "enoent" (nie ma programu), "throw" (spawn rzuca)
function fakeShowSpawn(mode = "spawn") {
    const calls = [];

    const spawnImpl = (command, args, options) => {
        const child = new EventEmitter();
        const call = { command, args, options, unrefCalls: 0 };

        child.unref = () => { call.unrefCalls += 1; };
        calls.push(call);

        if (mode === "throw") {
            throw new Error("spawn EINVAL");
        }

        setImmediate(() => {
            if (mode === "enoent") {
                const error = new Error(`spawn ${command} ENOENT`);
                error.code = "ENOENT";
                child.emit("error", error);
            } else {
                child.emit("spawn");
            }
        });

        return child;
    };

    return { spawnImpl, calls };
}

// podstawia atrape spawn pod adres /api/folder/pokaz danego modulu na czas testu
function useFakeShow(t, module, mode = "spawn") {
    const fake = fakeShowSpawn(mode);
    const before = { ...module.showInFolderOptions };

    module.showInFolderOptions.spawnImpl = fake.spawnImpl;

    t.after(() => {
        delete module.showInFolderOptions.spawnImpl;
        Object.assign(module.showInFolderOptions, before);
    });

    return fake;
}

// czysci liste zapisanych plikow modulu przed i po tescie (testy w jednym procesie dziela modul app.js)
function clearSaved(t, module) {
    module.savedFiles.clear();
    t.after(() => module.savedFiles.clear());
}

function startServer(t, module) {
    return new Promise((resolve) => {
        const server = module.app.listen(0, "127.0.0.1", () => resolve(server));

        t.after(() => {
            server.close();
            server.closeAllConnections();
        });
    });
}

async function post(server, address, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${address}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

// ======================================================================================
// 1. Polecenie dla trzech systemow
// ======================================================================================

test("UL-2d: Windows - explorer.exe /select,\"<plik>\" w dokladnie tej postaci (bez dodatkowych cudzyslowow Node)", () => {
    const file = "C:\\Pobrane\\Moje filmy\\Film [abc123].mp4";

    assert.deepEqual(appModule.buildShowInFolderCommand(file, "win32"), {
        command: "explorer.exe",
        args: ['/select,"C:\\Pobrane\\Moje filmy\\Film [abc123].mp4"'],
        options: { windowsVerbatimArguments: true }
    });
});

test("UL-2d: macOS - open -R <plik> (plik zaznaczony w Finderze), sciezka jako osobny argument", () => {
    const file = "/Users/ktos/Pobrane/Film \"cudzyslow\" [abc].mp4";

    assert.deepEqual(appModule.buildShowInFolderCommand(file, "darwin"), {
        command: "open",
        args: ["-R", file],
        options: {}
    });
});

test("UL-2d: Linux - xdg-open na folderze pliku (bez zaznaczenia pliku)", () => {
    assert.deepEqual(appModule.buildShowInFolderCommand("/home/ktos/Pobrane/Film [abc].mp4", "linux"), {
        command: "xdg-open",
        args: ["/home/ktos/Pobrane"],
        options: {}
    });

    // inne systemy uniksowe dostaja to samo
    assert.equal(appModule.buildShowInFolderCommand("/srv/a/b.mp3", "freebsd").command, "xdg-open");
    assert.deepEqual(appModule.buildShowInFolderCommand("/srv/a/b.mp3", "freebsd").args, ["/srv/a"]);
});

// ======================================================================================
// 2. showInFolder z podstawionym procesem
// ======================================================================================

test("UL-2d: showInFolder uruchamia polecenie odlaczone, bez ukrywania okna, i nie czeka na jego koniec", async () => {
    for (const [platform, file] of [["win32", "C:\\Pobrane\\a.mp4"], ["darwin", "/Users/x/a.mp4"], ["linux", "/home/x/a.mp4"]]) {
        const fake = fakeShowSpawn("spawn");
        const outcome = await appModule.showInFolder(file, { platform, spawnImpl: fake.spawnImpl });
        const expected = appModule.buildShowInFolderCommand(file, platform);

        assert.deepEqual(outcome, { ok: true }, platform);
        assert.equal(fake.calls.length, 1, platform);
        assert.equal(fake.calls[0].command, expected.command, platform);
        assert.deepEqual(fake.calls[0].args, expected.args, platform);
        assert.equal(fake.calls[0].options.detached, true, platform);
        assert.equal(fake.calls[0].options.stdio, "ignore", platform);
        assert.equal(fake.calls[0].options.windowsHide, false, platform);
        assert.equal(fake.calls[0].options.windowsVerbatimArguments === true, platform === "win32", platform);
        assert.equal(fake.calls[0].unrefCalls, 1, `${platform}: proces Eksploratora nie trzyma serwera`);
    }
});

test("UL-2d: showInFolder - brak programu albo blad spawn daje ok: false zamiast wyjatku", async () => {
    const missing = await appModule.showInFolder("/home/x/a.mp4", { platform: "linux", spawnImpl: fakeShowSpawn("enoent").spawnImpl });

    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, "ENOENT");

    const thrown = await appModule.showInFolder("C:\\a.mp4", { platform: "win32", spawnImpl: fakeShowSpawn("throw").spawnImpl });

    assert.equal(thrown.ok, false);
    assert.match(thrown.error.message, /EINVAL/);
});

// ======================================================================================
// 3. Adres /api/folder/pokaz: tylko pliki zapisane w tym uruchomieniu
// ======================================================================================

test("UL-2d: sciezka spoza listy zapisanych plikow jest odrzucana (403), Eksplorator sie nie otwiera", async (t) => {
    muteConsole(t);
    clearSaved(t, appModule);

    const fake = useFakeShow(t, appModule);
    const server = await startServer(t, appModule);
    const dir = makeTempDir(t, "pobierak-ul2d-");
    const saved = path.join(dir, "Film [abc].mp4");
    const other = path.join(dir, "Inny plik.mp4");

    fs.writeFileSync(saved, "x");
    fs.writeFileSync(other, "x");
    appModule.rememberSavedFiles([{ name: "Film [abc].mp4", path: saved }]);

    // istniejacy plik w tym samym folderze, ale niezapisany przez serwer; folder zamiast pliku; plik systemowy
    for (const candidate of [other, dir, path.join(os.homedir(), "x.txt"), process.execPath]) {
        const { status, json } = await post(server, "/api/folder/pokaz", { path: candidate });

        assert.equal(status, 403, candidate);
        assert.equal(json.success, false);
        assert.match(json.message, /tylko pliki, które sam zapisał/);
    }

    assert.equal(fake.calls.length, 0, "odrzucona sciezka nie moze uruchomic Eksploratora");
});

test("UL-2d: zle cialo zadania - 400 bez sciezki, 403 dla sciezki wzglednej; Eksplorator sie nie otwiera", async (t) => {
    muteConsole(t);
    clearSaved(t, appModule);

    const fake = useFakeShow(t, appModule);
    const server = await startServer(t, appModule);

    // sciezka wzgledna, ktora po rozwinieciu wskazalaby zapisany plik, tez jest odrzucana
    const relative = "app.js";
    appModule.rememberSavedFiles([{ name: "app.js", path: path.resolve(relative) }]);

    for (const body of [{}, { path: "" }, { path: "   " }, { path: 5 }, { path: ["C:\\a.mp4"] }, { path: null }]) {
        const { status, json } = await post(server, "/api/folder/pokaz", body);

        assert.equal(status, 400, JSON.stringify(body));
        assert.equal(json.message, "Brak ścieżki pliku do pokazania.");
    }

    const noBody = await post(server, "/api/folder/pokaz");
    assert.equal(noBody.status, 400);

    const relativeAnswer = await post(server, "/api/folder/pokaz", { path: relative });
    assert.equal(relativeAnswer.status, 403);

    assert.equal(fake.calls.length, 0);
});

test("UL-2d: plik zapisany w tym uruchomieniu przechodzi (200) i trafia do polecenia; zapis z .. tez", async (t) => {
    muteConsole(t);
    clearSaved(t, appModule);

    const fake = useFakeShow(t, appModule);
    const server = await startServer(t, appModule);
    const dir = makeTempDir(t, "pobierak-ul2d-");
    const saved = path.join(dir, "Film ąę [abc].mp4");

    fs.writeFileSync(saved, "x");
    appModule.rememberSavedFiles([{ name: path.basename(saved), path: saved }]);

    const { status, json } = await post(server, "/api/folder/pokaz", { path: saved });

    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(json, { success: true });
    assert.equal(fake.calls.length, 1);

    const expected = appModule.buildShowInFolderCommand(saved);
    assert.equal(fake.calls[0].command, expected.command);
    assert.deepEqual(fake.calls[0].args, expected.args);

    // ta sama sciezka zapisana okrezna droga - po rozwinieciu to ten sam plik
    const roundabout = path.join(dir, "..", path.basename(dir), path.basename(saved));
    const again = await post(server, "/api/folder/pokaz", { path: roundabout });

    assert.equal(again.status, 200);
    assert.deepEqual(fake.calls[1].args, expected.args, "do Eksploratora idzie sciezka rozwinieta");
});

test("UL-2d: zapisany plik, ktorego juz nie ma na dysku - 404; brak programu - 500", async (t) => {
    muteConsole(t);
    clearSaved(t, appModule);

    const server = await startServer(t, appModule);
    const dir = makeTempDir(t, "pobierak-ul2d-");
    const gone = path.join(dir, "Usuniety.mp4");
    const present = path.join(dir, "Jest.mp4");

    fs.writeFileSync(present, "x");
    appModule.rememberSavedFiles([{ name: "Usuniety.mp4", path: gone }, { name: "Jest.mp4", path: present }]);

    const fake = useFakeShow(t, appModule, "enoent");

    const missingFile = await post(server, "/api/folder/pokaz", { path: gone });
    assert.equal(missingFile.status, 404);
    assert.equal(missingFile.json.message, `Plik już nie istnieje: ${gone}`);
    assert.equal(fake.calls.length, 0);

    const missingProgram = await post(server, "/api/folder/pokaz", { path: present });
    assert.equal(missingProgram.status, 500);
    assert.equal(missingProgram.json.message, "Nie udało się otworzyć folderu z plikiem.");
    assert.equal(fake.calls.length, 1);
});

test("UL-2d: /api/folder/pokaz przyjmuje tylko zadania z tego samego komputera", () => {
    // adres jest pod /api/folder, a tam stoi onlyLocalRequests (UL-2a): sprawdzamy kolejnosc w kodzie
    const source = fs.readFileSync(appPath, "utf8");
    const guard = source.indexOf('app.use("/api/folder", onlyLocalRequests);');
    const route = source.indexOf('app.post("/api/folder/pokaz"');

    assert.notEqual(guard, -1);
    assert.notEqual(route, -1);
    assert.ok(guard < route, "onlyLocalRequests musi byc zarejestrowany przed /api/folder/pokaz");

    // i sam straznik odrzuca obcy adres
    let status = null;
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    let passed = false;

    appModule.onlyLocalRequests({ socket: { remoteAddress: "192.168.1.20" } }, res, () => { passed = true; });

    assert.equal(passed, false);
    assert.equal(status, 403);
});

// ======================================================================================
// 4. Od pobrania do pokazania: kopia app.js z atrapa yt-dlp i ffmpeg
// ======================================================================================

// kopia app.js w os.tmpdir(); atrapa yt-dlp zapisuje plik wedlug szablonu -o (tytul "Film"), atrapa ffmpeg - ostatni argument.
// fail = atrapa konczy sie kodem 1 (nieudane pobranie)
function loadAppCopy(t, { fail = false } = {}) {
    const workDir = makeTempDir(t, "pobierak-ul2d-app-");
    const appCopyPath = path.join(workDir, "app.js");

    fs.copyFileSync(appPath, appCopyPath);
    fs.mkdirSync(path.join(workDir, "public"));

    const originalSpawn = childProcess.spawn;
    const originalNodePath = process.env.NODE_PATH;

    childProcess.spawn = (command, args) => {
        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            if (fail) {
                fake.stderr.emit("data", Buffer.from("ERROR: atrapa"));
                fake.emit("close", 1);
                return;
            }

            if (args.includes("-o")) {
                const template = args[args.indexOf("-o") + 1];
                const extension = args.includes("-x") ? "mp3" : (args.includes("bestaudio") ? "m4a" : "mp4");
                const outputPath = template.replace("%(title).150B", "Film").replace("%(ext)s", extension);

                fs.writeFileSync(outputPath, "yt-dlp");
            } else {
                fs.writeFileSync(args[args.length - 1], "ffmpeg");
            }

            fake.emit("close", 0);
        });

        return fake;
    };

    process.env.NODE_PATH = path.join(projectDir, "node_modules");
    Module._initPaths();

    let copy;

    try {
        copy = require(appCopyPath);
    } finally {
        childProcess.spawn = originalSpawn;

        if (originalNodePath === undefined) {
            delete process.env.NODE_PATH;
        } else {
            process.env.NODE_PATH = originalNodePath;
        }

        Module._initPaths();
        delete require.cache[require.resolve(appCopyPath)];
    }

    return copy;
}

const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };

test("UL-2d: plik z udanego pobrania da sie pokazac; po ponownym starcie serwera juz nie", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t, "pobierak-ul2d-cel-");
    const copy = loadAppCopy(t);
    const fake = useFakeShow(t, copy);
    const server = await startServer(t, copy);

    const download = await post(server, "/api/download", {
        url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects, folder: target
    });

    assert.equal(download.status, 200, JSON.stringify(download.json));
    assert.equal(download.json.files.length, 1);

    const savedPath = download.json.files[0].path;

    assert.ok(fs.existsSync(savedPath));
    assert.equal(path.dirname(savedPath), target);

    const shown = await post(server, "/api/folder/pokaz", { path: savedPath });

    assert.equal(shown.status, 200, JSON.stringify(shown.json));
    assert.equal(fake.calls.length, 1);
    assert.deepEqual(fake.calls[0].args, copy.buildShowInFolderCommand(savedPath).args);

    // nowy start serwera (swieza kopia app.js): lista zapisanych plikow jest pusta, plik na dysku dalej jest
    const restarted = loadAppCopy(t);
    const restartedFake = useFakeShow(t, restarted);
    const restartedServer = await startServer(t, restarted);

    const afterRestart = await post(restartedServer, "/api/folder/pokaz", { path: savedPath });

    assert.equal(afterRestart.status, 403);
    assert.equal(restartedFake.calls.length, 0);
});

test("UL-2d: tryb osobno - oba pliki zapisane, wideo pierwsze na liscie files", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t, "pobierak-ul2d-cel-");
    const copy = loadAppCopy(t);
    useFakeShow(t, copy);
    const server = await startServer(t, copy);

    const download = await post(server, "/api/download", {
        url: testUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects, folder: target
    });

    assert.equal(download.status, 200, JSON.stringify(download.json));
    assert.equal(download.json.files.length, 2);
    assert.match(download.json.files[0].name, /\.mp4$/, "pierwszy na liscie jest plik wideo");

    for (const file of download.json.files) {
        assert.equal(copy.isSavedFile(file.path), true, file.path);
        assert.equal((await post(server, "/api/folder/pokaz", { path: file.path })).status, 200);
    }
});

test("UL-2d: nieudane pobranie niczego nie dopisuje do listy zapisanych plikow", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t, "pobierak-ul2d-cel-");
    const copy = loadAppCopy(t, { fail: true });
    const server = await startServer(t, copy);

    const download = await post(server, "/api/download", {
        url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects, folder: target
    });

    assert.equal(download.status, 500);
    assert.equal(copy.savedFiles.size, 0);
});

// ======================================================================================
// 5. Strona: przycisk "Pobierz" / "Pokaż w folderze"
// ======================================================================================

function cutShowPart() {
    const startMark = '// ---------- "Pokaż w folderze" (zadanie UL-2d) ----------';
    const endMark = "typeInputs.forEach(";
    const start = scriptSource.indexOf(startMark);
    const end = scriptSource.indexOf(endMark);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${startMark}`);
    assert.ok(end > start, "obsluga przycisku ma stac przed podpieciem zdarzen");

    return scriptSource.slice(start, end);
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// strona-atrapa. download(numer) zwraca to, co zwroci handleDownloadSubmit (lista plikow albo undefined przy bledzie),
// moze tez zmienic pole linku w trakcie (urlInput w argumencie)
function buildPage({ download = () => undefined, fetchImpl = async () => jsonResponse(200, { success: true }) } = {}) {
    const classes = new Set();
    const downloadButton = {
        classList: {
            toggle(name, force) { if (force) { classes.add(name); } else { classes.delete(name); } },
            contains(name) { return classes.has(name); }
        }
    };
    const buttonText = { textContent: "Pobierz" };
    const urlInput = { value: "https://www.youtube.com/watch?v=jNQXAC9IVRw" };
    const logs = [];
    const statusErrors = [];
    const fetchCalls = [];
    let downloads = 0;

    const context = {
        downloadButton,
        buttonText,
        urlInput,
        console: { error() {} },
        addLog: (type, message) => logs.push([type, message]),
        showStatusError: (message) => statusErrors.push(message),
        handleDownloadSubmit: async () => {
            downloads += 1;
            return download(downloads, urlInput);
        },
        fetch: (...args) => {
            fetchCalls.push(args);
            return fetchImpl(...args);
        }
    };

    vm.createContext(context);
    vm.runInContext(cutShowPart(), context);

    const submit = async () => {
        let prevented = 0;
        await context.handleFormSubmit({ preventDefault() { prevented += 1; } });
        return prevented;
    };

    return {
        context, buttonText, urlInput, logs, statusErrors, fetchCalls, submit,
        downloads: () => downloads,
        showMode: () => classes.has("is-show-folder")
    };
}

const savedVideo = { name: "Film [abc].mp4", path: "C:\\Pobrane\\Film [abc].mp4" };
const savedAudio = { name: "Film [abc].mp3", path: "C:\\Pobrane\\Film [abc].mp3" };

test("UL-2d strona: po udanym pobraniu przycisk to Pokaż w folderze", async () => {
    const page = buildPage({ download: () => [savedVideo] });

    await page.submit();

    assert.equal(page.buttonText.textContent, "Pokaż w folderze");
    assert.equal(page.showMode(), true);
    assert.equal(page.fetchCalls.length, 0, "samo pobranie nie otwiera folderu");
});

test("UL-2d strona: klik Pokaż w folderze wysyla sciezke do /api/folder/pokaz i od razu wraca do Pobierz", async () => {
    let answer;
    const pending = new Promise((resolve) => { answer = resolve; });
    const page = buildPage({ download: () => [savedVideo], fetchImpl: () => pending });

    await page.submit();

    const clicked = page.submit();

    // odpowiedz serwera jeszcze nie przyszla, a przycisk juz jest "Pobierz"
    assert.equal(page.buttonText.textContent, "Pobierz");
    assert.equal(page.showMode(), false);
    assert.equal(page.downloads(), 1, "klik Pokaż w folderze nie pobiera od nowa");
    assert.equal(page.fetchCalls.length, 1);

    const [address, options] = page.fetchCalls[0];

    assert.equal(address, "/api/folder/pokaz");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { path: savedVideo.path });

    answer(jsonResponse(200, { success: true }));
    assert.equal(await clicked, 1, "formularz nie jest wysylany dalej");
    assert.deepEqual(page.statusErrors, []);

    // kolejny klik to zwykle pobieranie
    await page.submit();
    assert.equal(page.downloads(), 2);
});

test("UL-2d strona: wpisanie znaku w pole linku zamienia przycisk z powrotem w Pobierz", async () => {
    // pierwsze pobranie udane, drugie nieudane (przycisk ma po nim zostac zwyklym "Pobierz")
    const page = buildPage({ download: (number) => (number === 1 ? [savedVideo] : undefined) });

    await page.submit();
    assert.equal(page.buttonText.textContent, "Pokaż w folderze");

    page.urlInput.value += "x";
    page.context.resetFileToShow();

    assert.equal(page.buttonText.textContent, "Pobierz");
    assert.equal(page.showMode(), false);

    await page.submit();
    assert.equal(page.downloads(), 2, "po zmianie linku klik pobiera");
    assert.equal(page.fetchCalls.length, 0);

    // wpisanie znaku, gdy przycisk jest juz "Pobierz", nie zmienia napisu (np. "Pobieram... 40%" w trakcie pobierania)
    page.buttonText.textContent = "Pobieram... 40%";
    page.context.resetFileToShow();
    assert.equal(page.buttonText.textContent, "Pobieram... 40%");
});

test("UL-2d strona: po nieudanym pobraniu przycisk zostaje Pobierz", async () => {
    // handleDownloadSubmit zwraca undefined po kazdym bledzie; pusta albo dziwna lista plikow tez nie daje przycisku
    for (const result of [undefined, null, [], [{ name: "bez sciezki" }], [null], "C:\\a.mp4"]) {
        const page = buildPage({ download: () => result });

        await page.submit();

        assert.equal(page.buttonText.textContent, "Pobierz", JSON.stringify(result));
        assert.equal(page.showMode(), false);
    }
});

test("UL-2d strona: tryb osobno - do serwera idzie sciezka pliku wideo", async () => {
    const page = buildPage({ download: () => [savedVideo, savedAudio] });

    await page.submit();
    await page.submit();

    assert.deepEqual(JSON.parse(page.fetchCalls[0][1].body), { path: savedVideo.path });
});

test("UL-2d strona: link zmieniony w trakcie pobierania - po sukcesie przycisk zostaje Pobierz", async () => {
    const page = buildPage({
        download: (number, urlInput) => {
            urlInput.value = "https://www.youtube.com/watch?v=innyFilm";
            return [savedVideo];
        }
    });

    await page.submit();

    assert.equal(page.buttonText.textContent, "Pobierz");
});

test("UL-2d strona: serwer odmowil (403) albo nie odpowiada - komunikat w polu statusu, przycisk Pobierz", async () => {
    const refused = buildPage({
        download: () => [savedVideo],
        fetchImpl: async () => jsonResponse(403, { success: false, message: "Pobierak pokazuje w folderze tylko pliki..." })
    });

    await refused.submit();
    await refused.submit();

    assert.deepEqual(refused.statusErrors, ["Pobierak pokazuje w folderze tylko pliki..."]);
    assert.equal(refused.buttonText.textContent, "Pobierz");

    const offline = buildPage({ download: () => [savedVideo], fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });

    await offline.submit();
    await offline.submit();

    assert.deepEqual(offline.statusErrors, ["Nie udało się połączyć z backendem."]);
    assert.equal(offline.buttonText.textContent, "Pobierz");
});

test("UL-2d strona: podpiecie zdarzen - formularz przez handleFormSubmit, pole linku resetuje przycisk, inne ustawienia nie", () => {
    const wiring = scriptSource.slice(scriptSource.indexOf("typeInputs.forEach("));

    assert.match(wiring, /downloadForm\.addEventListener\("submit", handleFormSubmit\);/);
    assert.match(wiring, /urlInput\.addEventListener\("input", resetFileToShow\);/);
    assert.doesNotMatch(wiring, /downloadForm\.addEventListener\("submit", handleDownloadSubmit\)/);

    // resetFileToShow i setFileToShow("") wolaja tylko: pole linku i sam klik "Pokaż w folderze"
    const resetUses = scriptSource.match(/resetFileToShow\b/g) || [];
    assert.equal(resetUses.length, 2, "definicja + podpiecie do pola linku");
});
