// Testy zadania B2: kodowanie nazw plikow w adresach /downloads/... i tablica "files" w odpowiedzi /api/download.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: spawn jest podmieniony na atrape.
// Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana, a przy pobieraniu pliku przez GET
// odczyt z downloads jest przekierowany do folderu roboczego w os.tmpdir().

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

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
const { buildDownloadUrl, buildDownloadFiles } = appModule;

// opcje eksperymentalne bez efektow: po pobraniu ffmpeg nie jest uruchamiany (poza wideo "osobno" mp4)
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

// tytul ze znakami, ktore psuja niezakodowany adres
const hardTitle = "the #1 100% pewny? film & zażółć=gęś+x";
const hardTitleEncoded = "the%20%231%20100%25%20pewny%3F%20film%20%26%20za%C5%BC%C3%B3%C5%82%C4%87%3Dg%C4%99%C5%9B%2Bx";

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
        body: JSON.stringify(body),
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

// ---------- buildDownloadUrl ----------

test("B2: buildDownloadUrl koduje znaki, ktore psuja adres (#, %, ?, &, spacja, nawiasy, polskie litery)", () => {
    assert.equal(buildDownloadUrl("a#b.mp3"), "/downloads/a%23b.mp3");
    assert.equal(buildDownloadUrl("100% prawdy.mp3"), "/downloads/100%25%20prawdy.mp3");
    assert.equal(buildDownloadUrl("co? to.mp4"), "/downloads/co%3F%20to.mp4");
    assert.equal(buildDownloadUrl("a&b=c+d.mkv"), "/downloads/a%26b%3Dc%2Bd.mkv");
    assert.equal(buildDownloadUrl("tytul [abcd1234].mp3"), "/downloads/tytul%20%5Babcd1234%5D.mp3");
    assert.equal(buildDownloadUrl("zażółć.flac"), "/downloads/za%C5%BC%C3%B3%C5%82%C4%87.flac");
    assert.equal(buildDownloadUrl(`${hardTitle} [abcd1234].mp3`), `/downloads/${hardTitleEncoded}%20%5Babcd1234%5D.mp3`);
});

test("B2: buildDownloadUrl - nazwa wygladajaca na juz zakodowana jest kodowana jeszcze raz (plik %20.mp3 to nie plik ze spacja)", () => {
    assert.equal(buildDownloadUrl("a%20b.mp3"), "/downloads/a%2520b.mp3");
    assert.equal(buildDownloadUrl("a%23b.mp3"), "/downloads/a%2523b.mp3");
});

test("B2: buildDownloadUrl - ukosniki w nazwie nie tworza dodatkowych czesci sciezki", () => {
    assert.equal(buildDownloadUrl("a/b.mp3"), "/downloads/a%2Fb.mp3");
    assert.equal(buildDownloadUrl("..\\x.mp3"), "/downloads/..%5Cx.mp3");
});

test("B2: buildDownloadUrl - zwykla nazwa zostaje bez zmian", () => {
    assert.equal(buildDownloadUrl("zwykly-plik_1.mp3"), "/downloads/zwykly-plik_1.mp3");
});

test("B2: adres da sie odkodowac z powrotem do dokladnej nazwy pliku i nie zawiera znakow ucinajacych adres", () => {
    const names = [
        "the #1 NO SCOPE player in rivals [ede398c2].mp3",
        "100% prawdy [aaaaaaaa].mp4",
        "50%",
        "%zz.mp3",
        "co? [bbbbbbbb].mkv",
        "a#b#c ## [cccccccc].avi",
        "ｆｕｌｌ　ｗｉｄｔｈ 日本語 😀 [dddddddd].flac",
        `${hardTitle} video [eeeeeeee].mp4`
    ];

    for (const name of names) {
        const url = buildDownloadUrl(name);

        assert.ok(url.startsWith("/downloads/"));

        const encoded = url.slice("/downloads/".length);

        assert.equal(decodeURIComponent(encoded), name);
        assert.doesNotMatch(encoded, /[#?\/ ]/, `adres ${url} ma znak, ktory go ucina albo dzieli`);
        assert.doesNotMatch(encoded, /%(?![0-9A-F]{2})/, `adres ${url} ma znak % bez dwoch cyfr szesnastkowych`);

        // tak adres rozumie przegladarka: cala nazwa zostaje w sciezce, nic nie ucieka do kotwicy ani zapytania
        const parsed = new URL(url, "http://127.0.0.1");

        assert.equal(parsed.hash, "");
        assert.equal(parsed.search, "");
        assert.equal(decodeURIComponent(parsed.pathname), `/downloads/${name}`);
    }
});

// ---------- buildDownloadFiles ----------

test("B2: buildDownloadFiles zwraca obiekty { name, url } w podanej kolejnosci, nazwa bez kodowania, adres zakodowany", () => {
    assert.deepEqual(buildDownloadFiles(["a#b video [abcd1234].mp4", "a#b audio [abcd1234].mp3"]), [
        { name: "a#b video [abcd1234].mp4", url: "/downloads/a%23b%20video%20%5Babcd1234%5D.mp4" },
        { name: "a#b audio [abcd1234].mp3", url: "/downloads/a%23b%20audio%20%5Babcd1234%5D.mp3" }
    ]);
    assert.deepEqual(buildDownloadFiles(["x.mp3"]), [{ name: "x.mp3", url: "/downloads/x.mp3" }]);
    assert.deepEqual(buildDownloadFiles([]), []);
});

// ---------- cala droga: POST /api/download ----------

test("B2: POST /api/download audio - downloadUrl zakodowany, files ma jeden element, brak downloadUrls", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, () => "mp3");

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "audio", format: "mp3", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.match(json.downloadUrl, new RegExp(`^/downloads/${hardTitleEncoded.replace(/[+]/g, "\\+")}%20%5B[0-9a-f]{8}%5D\\.mp3$`));

    const name = decodeURIComponent(json.downloadUrl.slice("/downloads/".length));

    assert.match(name, /^the #1 100% pewny\? film & zażółć=gęś\+x \[[0-9a-f]{8}\]\.mp3$/);
    assert.deepEqual(json.files, [{ name, url: json.downloadUrl }]);
    assert.equal("downloadUrls" in json, false);
    assert.equal(json.message, "Audio gotowe do pobrania.");
    assert.equal(json.receivedData.type, "audio");
});

test("B2: POST /api/download film - downloadUrl zakodowany, files ma jeden element", async (t) => {
    calls.length = 0;
    fakeDownloads(t, hardTitle, () => "mkv");

    const server = await startServer(t);
    const { status, json } = await postDownload(server, { url: testUrl, type: "video", format: "mkv", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.match(json.downloadUrl, new RegExp(`^/downloads/${hardTitleEncoded.replace(/[+]/g, "\\+")}%20%5B[0-9a-f]{8}%5D\\.mkv$`));

    const name = decodeURIComponent(json.downloadUrl.slice("/downloads/".length));

    assert.match(name, /^the #1 100% pewny\? film & zażółć=gęś\+x \[[0-9a-f]{8}\]\.mkv$/);
    assert.deepEqual(json.files, [{ name, url: json.downloadUrl }]);
    assert.equal("downloadUrls" in json, false);
    assert.equal(json.message, "Video gotowe do pobrania.");
});

for (const format of ["mkv", "mp4"]) {
    test(`B2: POST /api/download tryb osobno (${format}) - files ma dwa elementy (wideo, audio), downloadUrls i downloadUrl zostaja i sa zakodowane`, async (t) => {
        calls.length = 0;
        fakeDownloads(t, hardTitle, (args) => (args.includes("-x") ? "mp3" : format));

        const server = await startServer(t);
        const { status, json } = await postDownload(server, { url: testUrl, type: "separate", format, resolution: "best", bitrate: "best", experimental: noEffects });

        assert.equal(status, 200, JSON.stringify(json));

        const encodedTitle = hardTitleEncoded.replace(/[+]/g, "\\+");

        assert.equal(json.downloadUrls.length, 2);
        assert.match(json.downloadUrls[0], new RegExp(`^/downloads/${encodedTitle}%20video%20%5B[0-9a-f]{8}%5D\\.${format}$`));
        assert.match(json.downloadUrls[1], new RegExp(`^/downloads/${encodedTitle}%20audio%20%5B[0-9a-f]{8}%5D\\.mp3$`));
        assert.equal(json.downloadUrl, json.downloadUrls[1]);

        const videoName = decodeURIComponent(json.downloadUrls[0].slice("/downloads/".length));
        const audioName = decodeURIComponent(json.downloadUrls[1].slice("/downloads/".length));

        assert.deepEqual(json.files, [
            { name: videoName, url: json.downloadUrls[0] },
            { name: audioName, url: json.downloadUrls[1] }
        ]);
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
    assert.equal(json.files[0].url, `/downloads/${encodeURIComponent(json.files[0].name)}`);
    assert.equal(json.files[0].url, json.downloadUrl);
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
    assert.deepEqual(json.files.map(file => file.url), json.downloadUrls);
    assert.deepEqual(json.files.map(file => file.url), json.files.map(file => `/downloads/${encodeURIComponent(file.name)}`));
    assert.equal(json.downloadUrl, json.files[1].url);
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
});

// ---------- pobranie pliku pod adresem z odpowiedzi (GET) ----------

// przekierowuje odczyt plikow z folderu downloads do folderu roboczego (express.static czyta przez fs.stat i fs.createReadStream),
// zeby test mogl pobrac prawdziwy plik z prawdziwego serwera programu bez pisania do downloads
function redirectDownloadsTo(t, dir) {
    const originalStat = fs.stat;
    const originalCreateReadStream = fs.createReadStream;
    const downloads = path.resolve(appModule.downloadsDir);

    const redirect = (target) => {
        const resolved = path.resolve(String(target));

        if (resolved === downloads || resolved.startsWith(downloads + path.sep)) {
            return path.join(dir, path.relative(downloads, resolved));
        }

        return target;
    };

    t.mock.method(fs, "stat", (target, ...rest) => originalStat(redirect(target), ...rest));
    t.mock.method(fs, "createReadStream", (target, ...rest) => originalCreateReadStream(redirect(target), ...rest));
}

function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b2-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

// znak ? nie moze wystapic w nazwie pliku na Windowsie; na macOS i Linuksie yt-dlp go zostawia
const realTitle = process.platform === "win32" ? "the #1 100% film & %zz #shorts" : "the #1 100% film? & %zz #shorts";

test("B2: GET pod adres z odpowiedzi /api/download zwraca 200 i tresc pliku z # i % w nazwie", async (t) => {
    calls.length = 0;

    const dir = makeDir(t);

    fakeDownloads(t, realTitle, () => "mp3");
    redirectDownloadsTo(t, dir);

    const server = await startServer(t);
    const base = `http://127.0.0.1:${server.address().port}`;
    const { status, json } = await postDownload(server, { url: testUrl, type: "audio", format: "mp3", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 1);
    assert.ok(json.files[0].name.startsWith(`${realTitle} [`), json.files[0].name);

    // plik "pobrany" przez yt-dlp: prawdziwy plik o tej nazwie w folderze roboczym
    const content = `TRESC PLIKU B2 ${json.files[0].name}`;

    fs.writeFileSync(path.join(dir, json.files[0].name), content);

    for (const url of [json.files[0].url, json.downloadUrl]) {
        const response = await fetch(base + url, { signal: AbortSignal.timeout(10000) });

        assert.equal(response.status, 200, `GET ${url}`);
        assert.equal(await response.text(), content);
    }

    // kontrola: ten sam plik pod adresem bez kodowania (tak bylo przed B2) nie jest osiagalny
    const raw = await fetch(`${base}/downloads/${json.files[0].name}`, { signal: AbortSignal.timeout(10000) });

    assert.equal(raw.status, 404, "adres bez kodowania nie powinien dzialac - inaczej test niczego nie sprawdza");
    await raw.arrayBuffer();
});

test("B2: GET w trybie osobno - oba adresy z files zwracaja wlasciwy plik", async (t) => {
    calls.length = 0;

    const dir = makeDir(t);

    fakeDownloads(t, realTitle, (args) => (args.includes("-x") ? "mp3" : "mkv"));
    redirectDownloadsTo(t, dir);

    const server = await startServer(t);
    const base = `http://127.0.0.1:${server.address().port}`;
    const { status, json } = await postDownload(server, { url: testUrl, type: "separate", format: "mkv", resolution: "best", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 2);
    assert.match(json.files[0].name, / video \[[0-9a-f]{8}\]\.mkv$/);
    assert.match(json.files[1].name, / audio \[[0-9a-f]{8}\]\.mp3$/);

    for (const file of json.files) {
        fs.writeFileSync(path.join(dir, file.name), `TRESC ${file.name}`);
    }

    for (const file of json.files) {
        const response = await fetch(base + file.url, { signal: AbortSignal.timeout(10000) });

        assert.equal(response.status, 200, `GET ${file.url}`);
        assert.equal(await response.text(), `TRESC ${file.name}`);
    }
});

test("B2: GET pod zakodowany adres pliku, ktorego nie ma, zwraca 404 (przekierowanie odczytu w tescie nie udaje plikow)", async (t) => {
    const dir = makeDir(t);

    redirectDownloadsTo(t, dir);

    const server = await startServer(t);
    const response = await fetch(`http://127.0.0.1:${server.address().port}${buildDownloadUrl("nie ma #takiego [abcd1234].mp3")}`, { signal: AbortSignal.timeout(10000) });

    assert.equal(response.status, 404);
    await response.arrayBuffer();
});
