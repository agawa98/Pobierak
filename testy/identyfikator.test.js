// Testy zadania B13h: dluzszy identyfikator zadania (getJobId daje 8 znakow zamiast 4).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: spawn jest podmieniony na atrape,
// ktora zapisuje argumenty. Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana.

const { folderDocelowy } = require("./folder-docelowy-pomoc");       // UL-2b: zadanie pobrania musi miec pole folder
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn. atrapa dziala takze po wczytaniu (app.js bierze spawn przy require).
// onSpawn(args) pozwala tescie udawac yt-dlp
function loadApp(onSpawn = () => {}) {
    const calls = [];
    const originalSpawn = childProcess.spawn;

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            onSpawn(args);
            fake.emit("close", 0);
        });

        return fake;
    };

    delete require.cache[require.resolve(appPath)];

    try {
        return { appModule: require(appPath), calls };
    } finally {
        childProcess.spawn = originalSpawn;
    }
}

function startServer(appModule) {
    return new Promise((resolve) => {
        const server = appModule.app.listen(0, "127.0.0.1", () => resolve(server));
    });
}

async function postDownload(server, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderDocelowy, ...body })
    });

    return { status: response.status, json: await response.json() };
}

// wartosc stojaca po opcji -o w argumentach yt-dlp
function outputTemplateOf(args) {
    const index = args.indexOf("-o");

    assert.notEqual(index, -1, "w argumentach yt-dlp nie ma opcji -o");

    return args[index + 1];
}

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

// opcje eksperymentalne bez efektow: po pobraniu ffmpeg nie jest uruchamiany
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };

// ---------- getJobId ----------

test("B13h: getJobId zwraca 8 znakow szesnastkowych (poczatek UUID, bez myslnika)", () => {
    const { appModule } = loadApp();

    for (let i = 0; i < 200; i++) {
        const jobId = appModule.getJobId();

        assert.equal(typeof jobId, "string");
        assert.equal(jobId.length, 8, `identyfikator "${jobId}" nie ma 8 znakow`);
        assert.match(jobId, /^[0-9a-f]{8}$/);
    }
});

test("B13h: kolejne identyfikatory sa rozne", () => {
    const { appModule } = loadApp();
    const ids = new Set();

    for (let i = 0; i < 2000; i++) {
        ids.add(appModule.getJobId());
    }

    // przy 8 znakach (4 miliardy mozliwosci) powtorka w 2000 losowaniach praktycznie sie nie zdarza;
    // przy dawnych 4 znakach (65536 mozliwosci) powtorek byloby okolo 30
    // (>= 1999, bo jedna powtorka przy dobrym kodzie zdarza sie raz na okolo 2000 uruchomien)
    assert.ok(ids.size >= 1999, `tylko ${ids.size} roznych identyfikatorow na 2000`);
});

// ---------- nazwa pliku ----------

test("B13h: szablon nazwy pliku ma identyfikator w nawiasach kwadratowych tuz przed rozszerzeniem", () => {
    const { appModule } = loadApp();
    const jobId = appModule.getJobId();

    assert.equal(
        appModule.buildOutputTemplate(jobId),
        path.join(appModule.downloadsDir, `%(title).150B [${jobId}].%(ext)s`)
    );
    assert.equal(
        appModule.buildOutputTemplate(jobId, "video"),
        path.join(appModule.downloadsDir, `%(title).150B video [${jobId}].%(ext)s`)
    );
});

// ---------- cala droga: POST /api/download ----------

for (const [type, expectedCalls] of [["audio", 1], ["video", 1], ["separate", 2]]) {
    test(`B13h: POST /api/download (${type}) przekazuje do yt-dlp szablon nazwy z 8-znakowym identyfikatorem`, async () => {
        // atrapa nie tworzy pliku, wiec odpowiedz to 500 "nie znaleziono" - tu liczy sie tylko szablon -o
        const { appModule, calls } = loadApp();
        const server = await startServer(appModule);

        try {
            const result = await postDownload(server, { url: testUrl, type, format: type === "audio" ? "mp3" : "mp4", resolution: "best", bitrate: "best", experimental: noEffects });

            assert.equal(result.status, 500);
            assert.equal(calls.length, expectedCalls);

            const ids = calls.map(call => {
                const match = path.basename(outputTemplateOf(call.args)).match(/\[([^\]]*)\]\.%\(ext\)s$/);

                assert.ok(match, `szablon ${outputTemplateOf(call.args)} nie konczy sie na [identyfikator].%(ext)s`);
                assert.match(match[1], /^[0-9a-f]{8}$/);

                return match[1];
            });

            // tryb "osobno": oba pliki (wideo i audio) maja ten sam identyfikator
            assert.equal(new Set(ids).size, 1);
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
}

test("B13h: nazwa pliku w odpowiedzi serwera zawiera 8-znakowy identyfikator w nawiasach kwadratowych", async (t) => {
    const produced = [];

    // atrapa udaje yt-dlp bez pisania na dysk: zapamietuje nazwe pliku zlozona z szablonu -o
    const { appModule } = loadApp((args) => {
        produced.push(path.basename(outputTemplateOf(args)).replace("%(title).150B", "probny tytul B13h").replace("%(ext)s", "mp3"));
    });

    // lista plikow folderu downloads jest podstawiona (testy nie pisza do downloads); inne foldery czytane normalnie
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) === path.resolve(appModule.downloadsDir)) {
            return produced.slice();
        }

        return originalReaddirSync(target, ...rest);
    });

    const server = await startServer(appModule);

    try {
        const result = await postDownload(server, { url: testUrl, type: "audio", format: "mp3", resolution: "best", bitrate: "best", experimental: noEffects });

        assert.equal(result.status, 200, JSON.stringify(result.json));
        assert.equal(produced.length, 1);
        assert.match(produced[0], /^probny tytul B13h \[[0-9a-f]{8}\]\.mp3$/);
        // UL-2b: zamiast adresu odpowiedz niesie nazwe pliku i pelna sciezke w folderze docelowym
        assert.deepEqual(result.json.files, [{ name: produced[0], path: path.join(folderDocelowy, produced[0]) }]);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
});
