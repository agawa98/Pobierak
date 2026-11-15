// Testy zadania B2, dostosowane w UL-2b: tablica "files" w odpowiedzi /api/download.
// Od UL-2b serwer nie podaje plikow pod adresem /downloads/...: "files" niesie nazwe pliku i pelna sciezke
// w folderze docelowym. Testy kodowania adresow (buildDownloadUrl, buildDownloadFiles) i pobierania plikow przez GET
// zostaly usuniete razem z tymi funkcjami; to, ze /downloads/<plik> daje 404, sprawdza testy/folder-docelowy.test.js.
// Zostaje to, co B2 chronilo w odpowiedzi serwera: tytul ze znakami #, %, ?, & trafia do "files" bez zmian i bez kodowania.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: spawn jest podmieniony na atrape.
// Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana, a przeniesienie udawanych plikow
// do folderu docelowego jest udawane (testy/folder-docelowy-pomoc.js).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { folderDocelowy } = require("./folder-docelowy-pomoc");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn (app.js bierze spawn przy require). atrapa tylko zapisuje wywolania
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

// opcje eksperymentalne bez efektow: po pobraniu ffmpeg nie jest uruchamiany (poza wideo "osobno" mp4)
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

// tytul ze znakami, ktore psuly niezakodowany adres - w "files" maja byc bez zmian
const hardTitle = "the #1 100% pewny? film & zażółć=gęś+x";

// oczekiwana pozycja "files": nazwa pliku i pelna sciezka w folderze docelowym, bez adresu
function fileEntry(name) {
    return { name, path: path.join(folderDocelowy, name) };
}

function startServer(t) {
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
        body: JSON.stringify({ folder: folderDocelowy, ...body }),
        signal: AbortSignal.timeout(10000)      // gdyby serwer nie odpowiedzial, test pada zamiast wisiec
    });

    return { status: response.status, json: await response.json() };
}

// podstawia liste plikow folderu downloads (pliki "pobrane" przez atrape yt-dlp powstaja z szablonu -o i podanego tytulu)
// oraz zmiane nazwy i usuwanie w tym folderze (wideo "osobno" mp4 przechodzi przez ffmpeg) - nic nie trafia na dysk
function fakeDownloads(t, title, extensionFor) {
    const originalReaddirSync = fs.readdirSync;
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;
    const inDownloads = (target) => path.resolve(path.dirname(String(target))) === path.resolve(appModule.downloadsDir);

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) !== path.resolve(appModule.downloadsDir)) {
            return originalReaddirSync(target, ...rest);
        }

        return calls
            .filter(call => call.command === appModule.ytDlpPath)
            .map(call => {
                const template = path.basename(call.args[call.args.indexOf("-o") + 1]);

                return template.replace("%(title).150B", () => title).replace("%(ext)s", () => extensionFor(call.args));
            });
    });

    t.mock.method(fs, "renameSync", (from, to) => (inDownloads(from) ? undefined : originalRenameSync(from, to)));
    t.mock.method(fs, "unlinkSync", (target) => (inDownloads(target) ? undefined : originalUnlinkSync(target)));
}

// ---------- cala droga: POST /api/download ----------

test("B2: POST /api/download audio - files ma jeden element z nazwa i pelna sciezka, bez adresow", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, () => "mp3");

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "audio", format: "mp3", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(json.files.length, 1);

    const name = json.files[0].name;

    assert.match(name, /^the #1 100% pewny\? film & zażółć=gęś\+x \[[0-9a-f]{8}\]\.mp3$/);
    assert.deepEqual(json.files, [fileEntry(name)]);
    assert.equal("downloadUrl" in json, false);
    assert.equal("downloadUrls" in json, false);
    assert.equal(json.message, "Audio gotowe do pobrania.");
    assert.equal("receivedData" in json, false);
});

test("B2: POST /api/download film - files ma jeden element z nazwa i pelna sciezka, bez adresow", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, () => "mkv");

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "video", format: "mkv", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 1);

    const name = json.files[0].name;

    assert.match(name, /^the #1 100% pewny\? film & zażółć=gęś\+x \[[0-9a-f]{8}\]\.mkv$/);
    assert.deepEqual(json.files, [fileEntry(name)]);
    assert.equal("downloadUrl" in json, false);
    assert.equal("downloadUrls" in json, false);
    assert.equal(json.message, "Video gotowe do pobrania.");
});

for (const format of ["mkv", "mp4"]) {
    test(`B2: POST /api/download tryb osobno (${format}) - files ma dwa elementy (wideo, audio) z nazwa i pelna sciezka, bez adresow`, async (t) => {
        calls.length = 0;
        fakeDownloads(t, hardTitle, (args) => (args.includes("-x") ? "mp3" : format));

        const server = await startServer(t);
        const { status, json } = await postDownload(server, { url: testUrl, type: "separate", format, resolution: "best", bitrate: "best", experimental: noEffects });

        assert.equal(status, 200, JSON.stringify(json));

        assert.equal(json.files.length, 2);

        const videoName = json.files[0].name;
        const audioName = json.files[1].name;

        assert.match(videoName, new RegExp(`^the #1 100% pewny\\? film & zażółć=gęś\\+x video \\[[0-9a-f]{8}\\]\\.${format}$`));
        assert.match(audioName, /^the #1 100% pewny\? film & zażółć=gęś\+x audio \[[0-9a-f]{8}\]\.mp3$/);
        assert.deepEqual(json.files, [fileEntry(videoName), fileEntry(audioName)]);
        assert.equal("downloadUrl" in json, false);
        assert.equal("downloadUrls" in json, false);
        assert.equal(json.message, "Video i audio osobno gotowe do pobrania.");
    });
}

// po przetwarzaniu w ffmpeg plik koncowy ma inna nazwe niz pobrany (mjpeg -> .avi): files ma wskazywac plik koncowy
test("B2: POST /api/download film mjpeg - files wskazuje plik koncowy (.avi), a nie pobrany (.mp4)", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, () => "mp4");

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "video", format: "mjpeg", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 1);
    assert.match(json.files[0].name, /^the #1 100% pewny\? film & zażółć=gęś\+x \[[0-9a-f]{8}\]\.avi$/);
    assert.deepEqual(json.files, [fileEntry(json.files[0].name)]);
});

test("B2: POST /api/download tryb osobno mjpeg + normalizacja - files wskazuje pliki koncowe (wideo .avi, audio .mp3)", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, (args) => (args.includes("-x") ? "mp3" : "mp4"));

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "separate", format: "mjpeg", resolution: "best", bitrate: "best", experimental: { ...noEffects, normalize: true } });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 2);
    assert.match(json.files[0].name, / video \[[0-9a-f]{8}\]\.avi$/);
    assert.match(json.files[1].name, / audio \[[0-9a-f]{8}\]\.mp3$/);
    assert.deepEqual(json.files, json.files.map(file => fileEntry(file.name)));
});

test("B2: POST /api/download - odpowiedz z bledem nie ma pola files ani adresow", async (t) => {
    calls.length = 0;

    // atrapa yt-dlp niczego nie "pobiera": lista downloads jest pusta, wiec serwer odpowiada 500
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => (
        path.resolve(String(target)) === path.resolve(appModule.downloadsDir) ? [] : originalReaddirSync(target, ...rest)
    ));

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "audio", format: "mp3", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 500);
    assert.equal(json.success, false);
    assert.equal("files" in json, false);
    assert.equal("downloadUrl" in json, false);
    assert.equal("downloadUrls" in json, false);
});
