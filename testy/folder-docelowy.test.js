// Testy zadania UL-2b: zadanie pobrania niesie pole "folder", a gotowy plik trafia z folderu roboczego (downloads)
// do tego folderu. Serwer nie podaje juz plikow pod adresem /downloads, a sprzatanie nie dotyka folderu docelowego.
//
// Testy pracuja na kopii app.js w os.tmpdir() (jej folder downloads tez lezy w os.tmpdir()), wiec prawdziwy folder
// downloads nie jest ruszany. Zamiast yt-dlp i ffmpeg dziala atrapa spawn, ktora zapisuje prawdziwe pliki tam,
// gdzie zapisalby je program - dzieki temu przenoszenie odbywa sie naprawde, na dysku.
// Nic nie jest pobierane z internetu, serwer slucha na losowym wolnym porcie, pliki powstaja tylko w os.tmpdir().

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const childProcess = require("node:child_process");
const Module = require("node:module");
const { EventEmitter } = require("node:events");

const projectDir = path.join(__dirname, "..");
const appPath = path.join(projectDir, "app.js");

// ---------- pomocnicze ----------

function makeTempDir(t, prefix = "pobierak-ul2b-") {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

    return dir;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(check, description, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await check()) {
            return;
        }

        await sleep(20);
    }

    assert.fail(`nie doczekano sie: ${description}`);
}

// kopia app.js w os.tmpdir() z atrapa spawn. kopia nie ma obok siebie node_modules, wiec express jest brany z projektu.
// atrapa yt-dlp zapisuje plik wedlug szablonu -o (tytul "Film"; mp3 dla -x, inaczej mp4), atrapa ffmpeg - ostatni argument.
// options.target: folder docelowy, ktorego zawartosc atrapa zapisuje przy kazdym uruchomieniu programu (targetSnapshots)
function loadAppCopy(t, options = {}) {
    const workDir = makeTempDir(t, "pobierak-ul2b-app-");
    const appCopyPath = path.join(workDir, "app.js");
    const downloads = path.join(workDir, "downloads");

    fs.copyFileSync(appPath, appCopyPath);
    fs.mkdirSync(path.join(workDir, "public"));

    const calls = [];
    const targetSnapshots = [];
    const originalSpawn = childProcess.spawn;
    const originalNodePath = process.env.NODE_PATH;

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            if (options.target) {
                targetSnapshots.push(fs.readdirSync(options.target));
            }

            if (args.includes("-o")) {
                const template = args[args.indexOf("-o") + 1];
                const extension = args.includes("-x") ? "mp3" : "mp4";
                const outputPath = template.replace("%(title).150B", "Film").replace("%(ext)s", extension);

                fs.writeFileSync(outputPath, `yt-dlp:${path.basename(outputPath)}`);
            } else {
                const outputPath = args[args.length - 1];

                fs.writeFileSync(outputPath, `ffmpeg:${path.basename(outputPath)}`);
            }

            fake.emit("close", 0);
        });

        return fake;
    };

    process.env.NODE_PATH = path.join(projectDir, "node_modules");
    Module._initPaths();

    let appModule;

    try {
        appModule = require(appCopyPath);
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

    assert.equal(path.resolve(appModule.downloadsDir), path.resolve(downloads), "kopia app.js ma pracowac we wlasnym downloads");

    return { appModule, calls, targetSnapshots, workDir, downloads };
}

function startServer(t, appModule) {
    return new Promise((resolve) => {
        const server = appModule.app.listen(0, "127.0.0.1", () => resolve(server));

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
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const audioBody = { url: testUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects };
const videoBody = { url: testUrl, type: "video", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects };
const mjpegBody = { url: testUrl, type: "video", format: "mjpeg", resolution: "720", bitrate: "best", experimental: noEffects };
const separateBody = { url: testUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects };

// ======================================================================================
// 1. Pole "folder": cztery przypadki bledu 400
// ======================================================================================

// wspolne sprawdzenie odrzuconego zadania: 400 z komunikatem, zaden program nie wystartowal, zadne zadanie nie powstalo
async function assertRejected(server, loaded, body, expectedMessage) {
    const { status, json } = await postDownload(server, body);

    assert.equal(status, 400, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.equal(json.message, expectedMessage);
    assert.equal("files" in json, false);
    assert.equal(loaded.calls.length, 0, "odrzucone zadanie nie moze uruchomic yt-dlp");
    assert.equal(loaded.appModule.activeJobs.size, 0);
    assert.deepEqual(fs.readdirSync(loaded.downloads), []);
}

test("UL-2b: 400, gdy pole folder jest puste albo go nie ma", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    await assertRejected(server, loaded, audioBody, "Nie wybrano folderu docelowego.");

    for (const folder of ["", "   ", null, 5, ["C:\\x"], { a: 1 }]) {
        await assertRejected(server, loaded, { ...audioBody, folder }, "Nie wybrano folderu docelowego.");
    }
});

test("UL-2b: 400, gdy folder nie jest sciezka bezwzgledna", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    // "testy" istnieje wzgledem folderu projektu - mimo to sciezka wzgledna jest odrzucana
    for (const folder of ["testy", "./testy", ".", "..", "pobrane/filmy"]) {
        await assertRejected(server, loaded, { ...videoBody, folder }, `Folder docelowy musi być pełną ścieżką: ${folder}`);
    }
});

test("UL-2b: 400, gdy folder nie istnieje (takze gdy sciezka wskazuje plik)", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const dir = makeTempDir(t);
    const missing = path.join(dir, "nie ma takiego folderu");
    const file = path.join(dir, "plik.txt");

    fs.writeFileSync(file, "x");

    await assertRejected(server, loaded, { ...audioBody, folder: missing }, `Folder docelowy nie istnieje: ${missing}`);
    await assertRejected(server, loaded, { ...separateBody, folder: file }, `Folder docelowy nie istnieje: ${file}`);

    assert.equal(fs.existsSync(missing), false, "serwer nie tworzy brakujacego folderu");
    assert.deepEqual(fs.readdirSync(dir), ["plik.txt"]);
});

test("UL-2b: 400, gdy w folderze nie da sie zapisac (proba zapisu konczy sie bledem)", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const dir = makeTempDir(t);
    const originalOpenSync = fs.openSync;
    const attempts = [];

    // system odmawia utworzenia pliku w tym folderze
    t.mock.method(fs, "openSync", (target, ...rest) => {
        if (path.resolve(path.dirname(String(target))) === path.resolve(dir)) {
            attempts.push([path.basename(String(target)), rest[0]]);

            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        }

        return originalOpenSync(target, ...rest);
    });

    await assertRejected(server, loaded, { ...audioBody, folder: dir }, `Nie można zapisywać w folderze docelowym: ${dir}`);

    assert.equal(attempts.length, 1, "zapis sprawdzany jest jedna proba");
    assert.equal(attempts[0][1], "wx", "plik probny nie moze nadpisac istniejacego pliku");
    assert.deepEqual(fs.readdirSync(dir), []);
});

// to samo na prawdziwych uprawnieniach systemu: Windows - icacls odbiera prawo zapisu, macOS i Linux - chmod
test("UL-2b: 400, gdy system naprawde nie pozwala zapisywac w folderze (uprawnienia)", async (t) => {
    muteConsole(t);

    const dir = makeTempDir(t);

    if (process.platform === "win32") {
        const user = `${process.env.USERDOMAIN}\\${process.env.USERNAME}`;
        const deny = childProcess.spawnSync("icacls", [dir, "/deny", `${user}:(OI)(CI)(WD,AD)`], { windowsHide: true });

        t.after(() => childProcess.spawnSync("icacls", [dir, "/remove:d", user], { windowsHide: true }));

        if (deny.status !== 0) {
            t.skip("nie udalo sie odebrac prawa zapisu przez icacls");
            return;
        }
    } else {
        fs.chmodSync(dir, 0o555);
        t.after(() => fs.chmodSync(dir, 0o755));
    }

    // kontrola: test ma sens tylko wtedy, gdy zapis naprawde jest zablokowany (np. root na Linuksie zapisuje mimo chmod)
    try {
        fs.writeFileSync(path.join(dir, "kontrola.txt"), "x");
        fs.unlinkSync(path.join(dir, "kontrola.txt"));
        t.skip("folder mimo odebrania uprawnien pozwala zapisywac");
        return;
    } catch {
        // zapis zablokowany - tak ma byc
    }

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    await assertRejected(server, loaded, { ...audioBody, folder: dir }, `Nie można zapisywać w folderze docelowym: ${dir}`);
});

test("UL-2b: sprawdzFolderDocelowy - dobry folder daje null i nie zostawia w nim pliku probnego", (t) => {
    muteConsole(t);

    const { appModule } = loadAppCopy(t);
    const dir = makeTempDir(t);

    fs.writeFileSync(path.join(dir, "moj plik.txt"), "moje");

    assert.equal(appModule.sprawdzFolderDocelowy(dir), null);
    assert.equal(appModule.sprawdzFolderDocelowy(dir + path.sep), null);
    assert.deepEqual(fs.readdirSync(dir), ["moj plik.txt"]);
    assert.equal(fs.readFileSync(path.join(dir, "moj plik.txt"), "utf8"), "moje");
});

test("UL-2b: bledy formularza sa zglaszane przed bledem folderu, a folder sprawdzany jest dla kazdego trybu", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    await assertRejected(server, loaded, { ...audioBody, format: "ogg" }, "Nieprawidłowy format audio.");

    for (const body of [audioBody, videoBody, separateBody]) {
        await assertRejected(server, loaded, body, "Nie wybrano folderu docelowego.");
    }
});

// ======================================================================================
// 2. Gotowy plik trafia do folderu docelowego
// ======================================================================================

test("UL-2b: audio - gotowy plik jest w folderze docelowym, w downloads nie zostaje, files ma nazwe i pelna sciezke", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t, { target });
    const server = await startServer(t, loaded.appModule);
    const { status, json } = await postDownload(server, { ...audioBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(json.files.length, 1);
    assert.deepEqual(Object.keys(json.files[0]).sort(), ["name", "path"], "plik w odpowiedzi ma tylko nazwe i sciezke");
    assert.match(json.files[0].name, /^Film \[[0-9a-f]{8}\]\.mp3$/);
    assert.equal(json.files[0].path, path.join(target, json.files[0].name));
    assert.equal(path.isAbsolute(json.files[0].path), true);
    assert.equal("downloadUrl" in json, false);
    assert.equal("downloadUrls" in json, false);

    assert.deepEqual(fs.readdirSync(target), [json.files[0].name]);
    assert.equal(fs.readFileSync(json.files[0].path, "utf8"), `yt-dlp:${json.files[0].name}`, "przeniesiony plik ma tresc pobranego");
    assert.deepEqual(fs.readdirSync(loaded.downloads), [], "po przeniesieniu w folderze roboczym nic nie zostaje");
    assert.equal(loaded.appModule.activeJobs.size, 0);

    // yt-dlp pracowal w folderze roboczym, nie w folderze docelowym
    const template = loaded.calls[0].args[loaded.calls[0].args.indexOf("-o") + 1];

    assert.equal(path.resolve(path.dirname(template)), path.resolve(loaded.downloads));
});

test("UL-2b: film z przetwarzaniem w ffmpeg - w folderze docelowym jest tylko plik koncowy, w trakcie pracy folder jest pusty", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t, { target });
    const server = await startServer(t, loaded.appModule);

    // pliki innego zadania w folderze roboczym: nie sa przenoszone
    fs.writeFileSync(path.join(loaded.downloads, "Inny [zzzz9999].mp4.part"), "x");
    fs.writeFileSync(path.join(loaded.downloads, "tmp-Inny [zzzz9999].mp3"), "x");

    const { status, json } = await postDownload(server, { ...mjpegBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(loaded.calls.length, 2, "yt-dlp i ffmpeg");
    assert.equal(json.files.length, 1);
    assert.match(json.files[0].name, /^Film \[[0-9a-f]{8}\]\.avi$/);
    assert.equal(json.files[0].path, path.join(target, json.files[0].name));

    // ffmpeg pisal do tmp- w folderze roboczym
    const ffmpegOutput = loaded.calls[1].args[loaded.calls[1].args.length - 1];

    assert.equal(ffmpegOutput, path.join(loaded.downloads, `tmp-${json.files[0].name}`));

    assert.deepEqual(fs.readdirSync(target), [json.files[0].name], "w folderze docelowym ma byc tylko gotowy plik");
    assert.equal(fs.readFileSync(json.files[0].path, "utf8"), `ffmpeg:tmp-${json.files[0].name}`, "przeniesiony ma byc wynik ffmpeg, nie oryginal");
    assert.deepEqual(loaded.targetSnapshots, [[], []], "w trakcie pracy yt-dlp i ffmpeg folder docelowy mial byc pusty");
    assert.deepEqual(fs.readdirSync(loaded.downloads).sort(), ["Inny [zzzz9999].mp4.part", "tmp-Inny [zzzz9999].mp3"]);
});

test("UL-2b: tryb osobno przenosi oba pliki (wideo, audio), w downloads nic nie zostaje", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t, { target });
    const server = await startServer(t, loaded.appModule);
    const { status, json } = await postDownload(server, { ...separateBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 2);
    assert.match(json.files[0].name, /^Film video \[[0-9a-f]{8}\]\.mp4$/);
    assert.match(json.files[1].name, /^Film audio \[[0-9a-f]{8}\]\.mp3$/);
    assert.deepEqual(json.files.map(file => file.path), json.files.map(file => path.join(target, file.name)));

    assert.deepEqual(fs.readdirSync(target).sort(), json.files.map(file => file.name).sort());
    assert.equal(fs.readFileSync(json.files[0].path, "utf8"), `ffmpeg:tmp-${json.files[0].name}`);       // wideo mp4 jest przepakowywane
    assert.equal(fs.readFileSync(json.files[1].path, "utf8"), `yt-dlp:${json.files[1].name}`);
    assert.deepEqual(fs.readdirSync(loaded.downloads), []);
    assert.equal(loaded.targetSnapshots.every(snapshot => snapshot.length === 0), true, "przed koncem pracy folder docelowy mial byc pusty");
    assert.equal(loaded.targetSnapshots.length, 3);
});

test("UL-2b: serwer nie pamieta folderu - kazde zadanie trafia do folderu ze swojego zadania, a zadanie bez folderu dostaje 400", async (t) => {
    muteConsole(t);

    const first = makeTempDir(t);
    const second = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    const a = await postDownload(server, { ...audioBody, folder: first });
    const b = await postDownload(server, { ...audioBody, folder: second });
    const c = await postDownload(server, audioBody);

    assert.equal(a.status, 200, JSON.stringify(a.json));
    assert.equal(b.status, 200, JSON.stringify(b.json));
    assert.equal(c.status, 400);
    assert.equal(c.json.message, "Nie wybrano folderu docelowego.");
    assert.deepEqual(fs.readdirSync(first), [a.json.files[0].name]);
    assert.deepEqual(fs.readdirSync(second), [b.json.files[0].name]);
    assert.notEqual(a.json.files[0].name, b.json.files[0].name);
});

test("UL-2b: sciezka folderu z koncowym ukosnikiem albo z '..' daje w files uporzadkowana pelna sciezke", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    fs.mkdirSync(path.join(target, "sub"));

    const { status, json } = await postDownload(server, { ...audioBody, folder: path.join(target, "sub") + path.sep + ".." + path.sep });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files[0].path, path.join(target, json.files[0].name));
    assert.equal(fs.existsSync(json.files[0].path), true);
});

// ======================================================================================
// 3. Nazwa w folderze docelowym: bez nadpisywania, bez przedrostka tmp-
// ======================================================================================

test("UL-2b: buildTargetFileName - numer przed rozszerzeniem, sama nazwa bez zmian", (t) => {
    muteConsole(t);

    const { buildTargetFileName } = loadAppCopy(t).appModule;

    assert.equal(buildTargetFileName("Film [abcd1234].mp3"), "Film [abcd1234].mp3");
    assert.equal(buildTargetFileName("Film [abcd1234].mp3", 1), "Film [abcd1234].mp3");
    assert.equal(buildTargetFileName("Film [abcd1234].mp3", 2), "Film [abcd1234] (2).mp3");
    assert.equal(buildTargetFileName("Film [abcd1234].mp3", 17), "Film [abcd1234] (17).mp3");
    assert.equal(buildTargetFileName("Film v1.2 [abcd1234].tar.mkv", 3), "Film v1.2 [abcd1234].tar (3).mkv", "numer stoi przed ostatnim rozszerzeniem");
    assert.equal(buildTargetFileName("bez rozszerzenia", 2), "bez rozszerzenia (2)");
    assert.equal(buildTargetFileName("tmp-foo [abcd1234].mp3"), "tmp-foo [abcd1234].mp3", "tytul zaczynajacy sie od tmp- zostaje bez zmian");
    assert.equal(buildTargetFileName("tmp-foo [abcd1234].mp3", 2), "tmp-foo [abcd1234] (2).mp3");
});

test("UL-2b: moveToTargetFolder nie nadpisuje istniejacego pliku - dodaje numer do nazwy", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const name = "Film [abcd1234].mp3";

    fs.writeFileSync(path.join(target, name), "stary plik uzytkownika");

    fs.writeFileSync(path.join(work, name), "nowy 1");
    assert.deepEqual(await moveToTargetFolder(name, target, null, work), { name: "Film [abcd1234] (2).mp3", path: path.join(target, "Film [abcd1234] (2).mp3") });

    fs.writeFileSync(path.join(work, name), "nowy 2");
    assert.deepEqual(await moveToTargetFolder(name, target, null, work), { name: "Film [abcd1234] (3).mp3", path: path.join(target, "Film [abcd1234] (3).mp3") });

    assert.deepEqual(fs.readdirSync(target).sort(), ["Film [abcd1234] (2).mp3", "Film [abcd1234] (3).mp3", name].sort());
    assert.equal(fs.readFileSync(path.join(target, name), "utf8"), "stary plik uzytkownika", "istniejacy plik nie moze byc nadpisany");
    assert.equal(fs.readFileSync(path.join(target, "Film [abcd1234] (2).mp3"), "utf8"), "nowy 1");
    assert.equal(fs.readFileSync(path.join(target, "Film [abcd1234] (3).mp3"), "utf8"), "nowy 2");
    assert.deepEqual(fs.readdirSync(work), []);
});

test("UL-2b: moveToTargetFolder - plik, ktory zostal pod nazwa tmp-, trafia do folderu docelowego bez przedrostka", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    // zadanie pamieta, ze ten wynik ffmpeg zostal pod nazwa tymczasowa
    const job = { movedFiles: [], tempNamedFiles: new Set(["tmp-Film [abcd1234].avi"]) };

    fs.writeFileSync(path.join(work, "tmp-Film [abcd1234].avi"), "wynik");

    const moved = await moveToTargetFolder("tmp-Film [abcd1234].avi", target, job, work);

    assert.deepEqual(moved, { name: "Film [abcd1234].avi", path: path.join(target, "Film [abcd1234].avi") });
    assert.deepEqual(fs.readdirSync(target), ["Film [abcd1234].avi"]);
    assert.deepEqual(job.movedFiles, [path.join(target, "Film [abcd1234].avi")]);

    // drugi taki plik: nazwa bez przedrostka jest zajeta, wiec dostaje numer
    fs.writeFileSync(path.join(work, "tmp-Film [abcd1234].avi"), "wynik 2");

    assert.equal((await moveToTargetFolder("tmp-Film [abcd1234].avi", target, job, work)).name, "Film [abcd1234] (2).avi");
    assert.deepEqual(fs.readdirSync(work), []);
});

test("UL-2b: moveToTargetFolder - film, ktorego tytul zaczyna sie od tmp-, zachowuje pelna nazwe", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const name = "tmp-foo [abcd1234].mp3";

    for (const job of [null, { movedFiles: [], tempNamedFiles: new Set() }, { movedFiles: [], tempNamedFiles: new Set(["tmp-inny [abcd1234].mp3"]) }]) {
        fs.writeFileSync(path.join(work, name), "x");

        assert.deepEqual(await moveToTargetFolder(name, target, job, work), { name, path: path.join(target, name) });
        fs.unlinkSync(path.join(target, name));
    }
});

test("UL-2b: gdy po ffmpeg nie uda sie nadac koncowej nazwy, plik i tak trafia do folderu docelowego bez przedrostka tmp-", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const originalRenameSync = fs.renameSync;
    const failed = [];

    // zmiana nazwy tmp-... -> ... w folderze roboczym konczy sie bledem (np. plik zablokowany)
    t.mock.method(fs, "renameSync", (from, to) => {
        if (path.resolve(path.dirname(String(from))) === path.resolve(loaded.downloads)) {
            failed.push(path.basename(String(from)));

            throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
        }

        return originalRenameSync(from, to);
    });

    const { status, json } = await postDownload(server, { ...mjpegBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(failed.length, 1, "kontrola: zmiana nazwy po ffmpeg miala sie nie udac");
    assert.match(failed[0], /^tmp-Film \[[0-9a-f]{8}\]\.avi$/);
    assert.match(json.files[0].name, /^Film \[[0-9a-f]{8}\]\.avi$/);
    assert.equal(json.files[0].path, path.join(target, json.files[0].name));
    assert.deepEqual(fs.readdirSync(target), [json.files[0].name], "w folderze docelowym nie moze byc pliku tmp-");
    assert.equal(fs.readFileSync(json.files[0].path, "utf8"), `ffmpeg:${failed[0]}`);
    assert.deepEqual(fs.readdirSync(loaded.downloads), []);
});

test("UL-2b: folder docelowy ze spacjami i polskimi literami w nazwie", async (t) => {
    muteConsole(t);

    const target = path.join(makeTempDir(t), "Pobrane filmy zażółć gęślą");
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);

    fs.mkdirSync(target);

    assert.equal(loaded.appModule.sprawdzFolderDocelowy(target), null);

    const { status, json } = await postDownload(server, { ...separateBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));
    assert.deepEqual(json.files.map(file => file.path), json.files.map(file => path.join(target, file.name)));
    assert.deepEqual(fs.readdirSync(target).sort(), json.files.map(file => file.name).sort());
});

test("UL-2b: moveToTargetFolder - brak pliku zrodlowego to blad, w folderze docelowym nic nie powstaje", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const job = { movedFiles: [] };

    await assert.rejects(moveToTargetFolder("nie ma [abcd1234].mp3", target, job, work), { code: "ENOENT" });
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(job.movedFiles, []);
});

// ======================================================================================
// 4. Inny dysk: kopiowanie i usuniecie (blad EXDEV z rename)
// ======================================================================================

function exdevError() {
    return Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
}

test("UL-2b: inny dysk (EXDEV) - plik jest kopiowany do folderu docelowego i usuwany z roboczego", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const name = "Film [abcd1234].mkv";
    const content = "tresc ".repeat(5000);
    const job = { movedFiles: [] };
    const renames = [];

    fs.writeFileSync(path.join(work, name), content);

    t.mock.method(fs.promises, "rename", async (from, to) => {
        renames.push([from, to]);
        throw exdevError();
    });

    const moved = await moveToTargetFolder(name, target, job, work);

    assert.deepEqual(renames, [[path.join(work, name), path.join(target, name)]], "najpierw proba zwyklego przeniesienia");
    assert.deepEqual(moved, { name, path: path.join(target, name) });
    assert.equal(fs.readFileSync(path.join(target, name), "utf8"), content);
    assert.deepEqual(fs.readdirSync(target), [name]);
    assert.deepEqual(fs.readdirSync(work), [], "po skopiowaniu plik znika z folderu roboczego");
    assert.deepEqual(job.movedFiles, [path.join(target, name)]);
});

test("UL-2b: inny dysk (EXDEV) - istniejacy plik tez nie jest nadpisywany, takze gdy pojawi sie w trakcie", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const name = "Film [abcd1234].mp3";
    const originalCopyFile = fs.promises.copyFile;
    const copyFlags = [];

    fs.writeFileSync(path.join(target, name), "stary");
    fs.writeFileSync(path.join(work, name), "nowy");

    t.mock.method(fs.promises, "rename", async () => { throw exdevError(); });

    // tuz przed kopiowaniem pod nazwa "(2)" ktos inny zapisuje plik o tej nazwie
    t.mock.method(fs.promises, "copyFile", async (from, to, flags) => {
        copyFlags.push(flags);

        if (path.basename(to) === "Film [abcd1234] (2).mp3" && !fs.existsSync(to)) {
            fs.writeFileSync(to, "cudzy");
        }

        return originalCopyFile.call(fs.promises, from, to, flags);
    });

    const moved = await moveToTargetFolder(name, target, null, work);

    assert.deepEqual(moved, { name: "Film [abcd1234] (3).mp3", path: path.join(target, "Film [abcd1234] (3).mp3") });
    assert.equal(fs.readFileSync(path.join(target, name), "utf8"), "stary");
    assert.equal(fs.readFileSync(path.join(target, "Film [abcd1234] (2).mp3"), "utf8"), "cudzy", "plik zapisany w miedzyczasie nie moze byc nadpisany");
    assert.equal(fs.readFileSync(path.join(target, "Film [abcd1234] (3).mp3"), "utf8"), "nowy");
    assert.equal(copyFlags.every(flags => flags === fs.constants.COPYFILE_EXCL), true, "kopiowanie nie moze nadpisywac");
    assert.deepEqual(fs.readdirSync(work), []);
});

test("UL-2b: inny dysk (EXDEV) - nieudane kopiowanie nie zostawia niedokonczonego pliku w folderze docelowym", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    const name = "Film [abcd1234].mp4";
    const job = { movedFiles: [] };

    fs.writeFileSync(path.join(work, name), "caly plik");

    t.mock.method(fs.promises, "rename", async () => { throw exdevError(); });
    t.mock.method(fs.promises, "copyFile", async (from, to) => {
        fs.writeFileSync(to, "pol pli");        // kopia urwana w polowie (np. brak miejsca na dysku)
        throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" });
    });

    await assert.rejects(moveToTargetFolder(name, target, job, work), { code: "ENOSPC" });

    assert.deepEqual(fs.readdirSync(target), [], "niedokonczona kopia miala zniknac");
    assert.equal(fs.readFileSync(path.join(work, name), "utf8"), "caly plik", "plik zrodlowy zostaje w folderze roboczym");
    assert.deepEqual(job.movedFiles, []);
});

test("UL-2b: blad rename inny niz EXDEV nie uruchamia kopiowania", async (t) => {
    muteConsole(t);

    const { moveToTargetFolder } = loadAppCopy(t).appModule;
    const work = makeTempDir(t);
    const target = makeTempDir(t);
    let copies = 0;

    fs.writeFileSync(path.join(work, "Film [abcd1234].mp3"), "x");

    t.mock.method(fs.promises, "rename", async () => { throw Object.assign(new Error("EPERM"), { code: "EPERM" }); });
    t.mock.method(fs.promises, "copyFile", async () => { copies++; });

    await assert.rejects(moveToTargetFolder("Film [abcd1234].mp3", target, null, work), { code: "EPERM" });
    assert.equal(copies, 0);
    assert.deepEqual(fs.readdirSync(target), []);
});

// ======================================================================================
// 5. Blad albo anulowanie w trakcie przenoszenia: w folderze docelowym nie zostaje polowa wyniku
// ======================================================================================

test("UL-2b: tryb osobno - gdy drugi plik nie da sie przeniesc, odpowiedz to 500, a pierwszy znika z folderu docelowego", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const originalRename = fs.promises.rename;
    const seen = [];

    fs.writeFileSync(path.join(target, "plik uzytkownika.txt"), "moje");

    t.mock.method(fs.promises, "rename", async (from, to) => {
        if (path.resolve(path.dirname(String(to))) !== path.resolve(target)) {
            return originalRename.call(fs.promises, from, to);
        }

        if (seen.length === 1) {
            seen.push({ name: path.basename(to), targetBefore: fs.readdirSync(target).sort() });

            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        }

        seen.push({ name: path.basename(to) });

        return originalRename.call(fs.promises, from, to);
    });

    const { status, json } = await postDownload(server, { ...separateBody, folder: target });

    assert.equal(status, 500, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.equal("files" in json, false);
    assert.equal(seen.length, 2);
    assert.match(seen[0].name, /^Film video /);
    assert.match(seen[1].name, /^Film audio /);
    assert.deepEqual(seen[1].targetBefore, [seen[0].name, "plik uzytkownika.txt"].sort(), "kontrola: pierwszy plik byl juz w folderze docelowym");
    assert.deepEqual(fs.readdirSync(target), ["plik uzytkownika.txt"], "z folderu docelowego znika tylko to, co przenioslo to zadanie");
    assert.equal(fs.readFileSync(path.join(target, "plik uzytkownika.txt"), "utf8"), "moje");
    assert.equal(loaded.appModule.activeJobs.size, 0);
});

// w kazdym trybie: polaczenie zrywa sie, gdy pierwszy gotowy plik jest wlasnie przenoszony
const cancelCases = [
    { label: "audio", body: audioBody, firstMoved: /^Film \[[0-9a-f]{8}\]\.mp3$/ },
    { label: "film", body: mjpegBody, firstMoved: /^Film \[[0-9a-f]{8}\]\.avi$/ },
    { label: "osobno", body: separateBody, firstMoved: /^Film video \[[0-9a-f]{8}\]\.mp4$/ }
];

for (const cancelCase of cancelCases) {
    test(`UL-2b: zerwanie polaczenia w trakcie przenoszenia (${cancelCase.label}) - folder docelowy i roboczy zostaja bez plikow zadania, odpowiedz nie wychodzi`, async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const originalRename = fs.promises.rename;
    const moved = [];
    let request;
    let cancelledJob;

    fs.writeFileSync(path.join(target, "plik uzytkownika.txt"), "moje");
    fs.writeFileSync(path.join(loaded.downloads, "Inny [zzzz9999].mp3"), "x");

    t.mock.method(fs.promises, "rename", async (from, to) => {
        if (path.resolve(path.dirname(String(to))) !== path.resolve(target)) {
            return originalRename.call(fs.promises, from, to);
        }

        // pierwszy plik juz przenoszony: strona zamyka polaczenie, serwer oznacza zadanie jako anulowane
        if (moved.length === 0) {
            cancelledJob = [...loaded.appModule.activeJobs.values()][0];
            request.destroy();
            await waitFor(() => cancelledJob.cancelled, "anulowanie zadania po zerwaniu polaczenia");
        }

        await originalRename.call(fs.promises, from, to);
        moved.push(path.basename(to));
    });

    request = http.request({
        host: "127.0.0.1",
        port: server.address().port,
        path: "/api/download",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });

    const responses = [];

    request.on("response", (response) => {
        responses.push(response.statusCode);
        response.resume();
    });
    request.on("error", () => {});      // zerwanie polaczenia przez test
    request.end(JSON.stringify({ ...cancelCase.body, folder: target }));

    await waitFor(() => moved.length > 0 && loaded.appModule.activeJobs.size === 0, "koniec anulowanego zadania");

    assert.equal(moved.length, 1, "po anulowaniu kolejny plik nie jest juz przenoszony");
    assert.match(moved[0], cancelCase.firstMoved);
    assert.deepEqual(fs.readdirSync(target), ["plik uzytkownika.txt"], "przeniesiony plik anulowanego zadania mial zniknac z folderu docelowego");
    assert.deepEqual(fs.readdirSync(loaded.downloads), ["Inny [zzzz9999].mp3"], "anulowanie sprzata folder roboczy z plikow zadania");
    assert.deepEqual(responses, [], "anulowane zadanie nie wysyla odpowiedzi");
    assert.deepEqual(cancelledJob.movedFiles, []);
    });
}

// blad przenoszenia w trybach z jednym plikiem: 500, w folderze docelowym nic nie przybywa, plik zostaje w folderze roboczym
for (const failCase of [{ label: "audio", body: audioBody }, { label: "film", body: videoBody }]) {
    test(`UL-2b: ${failCase.label} - gdy pliku nie da sie przeniesc, odpowiedz to 500 bez files, a folder docelowy zostaje bez zmian`, async (t) => {
        muteConsole(t);

        const target = makeTempDir(t);
        const loaded = loadAppCopy(t);
        const server = await startServer(t, loaded.appModule);
        const originalRename = fs.promises.rename;

        fs.writeFileSync(path.join(target, "plik uzytkownika.txt"), "moje");

        t.mock.method(fs.promises, "rename", async (from, to) => {
            if (path.resolve(path.dirname(String(to))) === path.resolve(target)) {
                throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
            }

            return originalRename.call(fs.promises, from, to);
        });

        const { status, json } = await postDownload(server, { ...failCase.body, folder: target });

        assert.equal(status, 500, JSON.stringify(json));
        assert.equal(json.success, false);
        assert.equal("files" in json, false);
        assert.deepEqual(fs.readdirSync(target), ["plik uzytkownika.txt"]);
        assert.equal(fs.readdirSync(loaded.downloads).length, 1, "gotowy plik zostaje w folderze roboczym do zwyklego sprzatania");
        assert.equal(loaded.appModule.activeJobs.size, 0);
    });
}

test("UL-2b: removeMovedFiles usuwa tylko sciezki zapisane w zadaniu i nie pada, gdy pliku juz nie ma", (t) => {
    muteConsole(t);

    const { removeMovedFiles } = loadAppCopy(t).appModule;
    const target = makeTempDir(t);
    const mine = path.join(target, "Film [abcd1234].mp3");
    const gone = path.join(target, "Film video [abcd1234].mp4");
    const other = path.join(target, "Film [abcd1234] kopia uzytkownika.mp3");

    fs.writeFileSync(mine, "x");
    fs.writeFileSync(other, "y");

    const job = { movedFiles: [mine, gone] };

    removeMovedFiles(job);

    assert.deepEqual(fs.readdirSync(target), ["Film [abcd1234] kopia uzytkownika.mp3"]);
    assert.deepEqual(job.movedFiles, []);
});

// ======================================================================================
// 6. Koniec adresu /downloads
// ======================================================================================

test("UL-2b: /downloads/<plik> daje 404, takze dla pliku, ktory lezy w folderze roboczym", async (t) => {
    muteConsole(t);

    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const base = `http://127.0.0.1:${server.address().port}`;

    fs.writeFileSync(path.join(loaded.downloads, "plik.mp3"), "tresc");
    fs.writeFileSync(path.join(loaded.downloads, "Film [abcd1234].mp3"), "tresc");

    for (const address of ["/downloads/plik.mp3", `/downloads/${encodeURIComponent("Film [abcd1234].mp3")}`, "/downloads/", "/downloads"]) {
        const response = await fetch(base + address, { signal: AbortSignal.timeout(10000) });
        const body = await response.text();

        assert.equal(response.status, 404, `GET ${address}`);
        assert.equal(body.includes("tresc"), false);
    }

    // kontrola: serwer dziala i podaje strone
    const page = await fetch(`${base}/api/logs`, { signal: AbortSignal.timeout(10000) }).then((response) => {
        const { status } = response;

        response.body.cancel();

        return status;
    });

    assert.equal(page, 200);
});

test("UL-2b: gotowego pliku nie da sie pobrac z serwera po udanym zadaniu - jest tylko na dysku", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const server = await startServer(t, loaded.appModule);
    const { status, json } = await postDownload(server, { ...audioBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));

    const response = await fetch(`http://127.0.0.1:${server.address().port}/downloads/${encodeURIComponent(json.files[0].name)}`, { signal: AbortSignal.timeout(10000) });

    assert.equal(response.status, 404);
    await response.arrayBuffer();
});

// ======================================================================================
// 7. Sprzatanie nie dotyka folderu docelowego
// ======================================================================================

test("UL-2b: sprzatanie po 30 minutach usuwa stare resztki z downloads, a folderu docelowego nie dotyka", async (t) => {
    muteConsole(t);

    const target = makeTempDir(t);
    const loaded = loadAppCopy(t);
    const { appModule } = loaded;
    const server = await startServer(t, appModule);
    const { status, json } = await postDownload(server, { ...audioBody, folder: target });

    assert.equal(status, 200, JSON.stringify(json));

    // wszystko jest starsze niz limit: gotowy plik i inny plik w folderze docelowym, resztka w folderze roboczym
    const old = new Date(Date.now() - (appModule.fileMaxAgeMinutes + 60) * 60 * 1000);
    const userFile = path.join(target, "stary plik uzytkownika [abcd1234].mp3");
    const leftover = path.join(loaded.downloads, "Resztka [ffff0000].mp4.part");
    const freshLeftover = path.join(loaded.downloads, "Swieza [eeee1111].mp4.part");

    fs.writeFileSync(userFile, "moje");
    fs.writeFileSync(leftover, "x");
    fs.writeFileSync(freshLeftover, "x");

    for (const filePath of [json.files[0].path, userFile, leftover]) {
        fs.utimesSync(filePath, old, old);
    }

    appModule.cleanupOldDownloads();

    assert.equal(fs.existsSync(leftover), false, "stara resztka w folderze roboczym miala zniknac");
    assert.equal(fs.existsSync(freshLeftover), true);
    assert.deepEqual(fs.readdirSync(target).sort(), [json.files[0].name, "stary plik uzytkownika [abcd1234].mp3"].sort(), "folder docelowy nie jest sprzatany");
    assert.equal(fs.readFileSync(json.files[0].path, "utf8"), `yt-dlp:${json.files[0].name}`);
});

test("UL-2b: program sprzata tylko folder roboczy - cleanupOldDownloads jest wolane bez folderu, a domyslny folder to downloads", () => {
    const source = fs.readFileSync(appPath, "utf8");
    const calls = [...source.matchAll(/cleanupOldDownloads\(([^)]*)\)/g)].map(match => match[1].trim());

    // definicja funkcji i jej wywolania przy starcie programu
    assert.deepEqual(calls, ["dir = downloadsDir, jobs = activeJobs", "", ""]);
});
