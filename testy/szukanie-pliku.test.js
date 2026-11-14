// Testy zadania B3: dokladne szukanie pliku w trybie "osobno" (findGeneratedFile).
// Plik jest rozpoznawany po dokladnej koncowce nazwy: "<etykieta> [<jobId>]." albo "[<jobId>]." bez etykiety,
// a nie po slowie "video"/"audio" gdziekolwiek w nazwie (to slowo moze byc tez w tytule filmu).
// Nic nie jest pobierane z internetu, yt-dlp i ffmpeg nie sa uruchamiane (spawn jest podmieniony na atrape).
// Testy nie pisza do folderu downloads: lista jego plikow jest podstawiana.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn. onSpawn(args) pozwala testowi udawac yt-dlp
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

// podstawia liste plikow folderu downloads (inne foldery sa czytane normalnie)
function fakeDownloads(t, appModule, getFiles) {
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) === path.resolve(appModule.downloadsDir)) {
            return getFiles().slice();
        }

        return originalReaddirSync(target, ...rest);
    });
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
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)      // gdyby serwer nie odpowiedzial, test pada zamiast wisiec
    });

    return { status: response.status, json: await response.json() };
}

function outputTemplateOf(args) {
    const index = args.indexOf("-o");

    assert.notEqual(index, -1, "w argumentach yt-dlp nie ma opcji -o");

    return args[index + 1];
}

const jobId = "ab12cd34";
const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };

// ---------- findGeneratedFile: tryb "osobno" ----------

// tytuly, w ktorych slowo etykiety stoi w samym tytule (w roznych miejscach)
const trickyTitles = [
    "my video essay",
    "video",
    "audio",
    "my audio video mix",
    "video audio",
    "audio video",
    "best audio",
    "best video",
    "video [live] audio",
    "the #1 NO SCOPE player in rivals"
];

for (const title of trickyTitles) {
    test(`B3: tytul "${title}" - etykieta "video" daje plik wideo, a "audio" plik audio (w kazdej kolejnosci listy)`, (t) => {
        const { appModule } = loadApp();
        const videoFile = `${title} video [${jobId}].mp4`;
        const audioFile = `${title} audio [${jobId}].mp3`;
        let files = [];

        fakeDownloads(t, appModule, () => files);

        for (const order of [[audioFile, videoFile], [videoFile, audioFile]]) {
            files = order;

            assert.equal(appModule.findGeneratedFile(jobId, "video"), videoFile);
            assert.equal(appModule.findGeneratedFile(jobId, "audio"), audioFile);
        }
    });
}

test("B3: etykieta w tytule nie wystarcza - gdy pliku z dana koncowka nie ma, wynik jest pusty", (t) => {
    const { appModule } = loadApp();
    let files = [];

    fakeDownloads(t, appModule, () => files);

    // jest tylko plik audio filmu ze slowem "video" w tytule
    files = [`my video essay audio [${jobId}].mp3`];
    assert.equal(appModule.findGeneratedFile(jobId, "video"), undefined);
    assert.equal(appModule.findGeneratedFile(jobId, "audio"), files[0]);

    // jest tylko plik wideo filmu ze slowem "audio" w tytule
    files = [`my audio essay video [${jobId}].webm`];
    assert.equal(appModule.findGeneratedFile(jobId, "audio"), undefined);
    assert.equal(appModule.findGeneratedFile(jobId, "video"), files[0]);
});

test("B3: plik z innym identyfikatorem nie jest brany", (t) => {
    const { appModule } = loadApp();
    const files = [
        `film video [ffffffff].mp4`,
        `film audio [ffffffff].mp3`,
        `film video [${jobId}0].mp4`,
        `film video [0${jobId}].mp4`,
        `film [${jobId}] video [ffffffff].mp4`
    ];

    fakeDownloads(t, appModule, () => files);

    assert.equal(appModule.findGeneratedFile(jobId, "video"), undefined);
    assert.equal(appModule.findGeneratedFile(jobId, "audio"), undefined);
    assert.equal(appModule.findGeneratedFile(jobId), undefined);
});

test("B3: etykieta musi stac tuz przed identyfikatorem, a po identyfikatorze musi byc kropka", (t) => {
    const { appModule } = loadApp();
    let files = [];

    fakeDownloads(t, appModule, () => files);

    for (const name of [
        `video film [${jobId}].mp4`,          // etykieta na poczatku, nie przed identyfikatorem
        `film video  [${jobId}].mp4`,         // dwie spacje
        `film video[${jobId}].mp4`,           // bez spacji
        `film video x [${jobId}].mp4`,        // cos miedzy etykieta a identyfikatorem
        `film video [${jobId}] kopia.mp4`,    // po identyfikatorze nie ma kropki
        `film video [${jobId}]`,              // bez rozszerzenia
        `film video ${jobId}.mp4`,            // bez nawiasow
        `film VIDEO [${jobId}].mp4`           // inna wielkosc liter niz etykieta programu
    ]) {
        files = [name];
        assert.equal(appModule.findGeneratedFile(jobId, "video"), undefined, `plik "${name}" nie powinien pasowac`);
    }
});

test("B3: rozszerzenie pliku jest dowolne", (t) => {
    const { appModule } = loadApp();
    let files = [];

    fakeDownloads(t, appModule, () => files);

    for (const ext of ["mp4", "webm", "mkv", "mp3", "m4a", "f137.mp4"]) {
        files = [`film video [${jobId}].${ext}`];
        assert.equal(appModule.findGeneratedFile(jobId, "video"), files[0]);
    }
});

// ---------- findGeneratedFile: bez etykiety (audio, film) ----------

test("B3: bez etykiety szuka koncowki \"[jobId].\"", (t) => {
    const { appModule } = loadApp();
    let files = [];

    fakeDownloads(t, appModule, () => files);

    files = [`inny film [ffffffff].mp3`, `my video essay [${jobId}].mp3`];
    assert.equal(appModule.findGeneratedFile(jobId), files[1]);
    assert.equal(appModule.findGeneratedFile(jobId, ""), files[1]);

    // identyfikator bez kropki za nawiasem albo bez nawiasow nie pasuje
    for (const name of [`film [${jobId}] kopia.mp3`, `film [${jobId}]`, `film ${jobId}.mp3`, `film [${jobId}0].mp3`]) {
        files = [name];
        assert.equal(appModule.findGeneratedFile(jobId), undefined, `plik "${name}" nie powinien pasowac`);
    }
});

test("B3: pusty folder daje pusty wynik", (t) => {
    const { appModule } = loadApp();

    fakeDownloads(t, appModule, () => []);

    assert.equal(appModule.findGeneratedFile(jobId), undefined);
    assert.equal(appModule.findGeneratedFile(jobId, "video"), undefined);
    assert.equal(appModule.findGeneratedFile(jobId, "audio"), undefined);
});

// ---------- cala droga: POST /api/download w trybie "osobno" ----------

for (const title of ["my video essay", "audio video", "zwykly tytul"]) {
    test(`B3: POST /api/download (separate) dla tytulu "${title}" zwraca plik wideo i plik audio, kazdy na swoim miejscu`, async (t) => {
        const produced = [];

        // atrapa udaje yt-dlp bez pisania na dysk: zapamietuje nazwe pliku zlozona z szablonu -o.
        // wywolanie z -x to sciezka audio (mp3), pozostale to obraz (mkv)
        const { appModule, calls } = loadApp((args) => {
            // wywolanie bez -o to nie yt-dlp (np. ffmpeg uruchomiony po zle dobranym pliku) - atrapa nic wtedy nie tworzy
            if (!args.includes("-o")) {
                return;
            }

            const ext = args.includes("-x") ? "mp3" : "mkv";

            produced.push(path.basename(outputTemplateOf(args)).replace("%(title).150B", title).replace("%(ext)s", ext));
        });

        // lista posortowana alfabetycznie, tak jak zwraca ja system: plik audio stoi przed plikiem wideo
        fakeDownloads(t, appModule, () => produced.slice().sort());

        const server = await startServer(appModule);

        try {
            const result = await postDownload(server, { url: testUrl, type: "separate", format: "mkv", resolution: "best", bitrate: "best", experimental: noEffects });

            assert.equal(result.status, 200, JSON.stringify(result.json));
            assert.equal(calls.length, 2, "tryb osobno bez efektow to dwa wywolania yt-dlp i zadnego ffmpeg");
            assert.equal(produced.length, 2);

            const videoName = produced.find(name => name.endsWith(".mkv"));
            const audioName = produced.find(name => name.endsWith(".mp3"));

            assert.match(videoName, / video \[[0-9a-f]{8}\]\.mkv$/);
            assert.match(audioName, / audio \[[0-9a-f]{8}\]\.mp3$/);

            const urls = result.json.downloadUrls.map(url => decodeURIComponent(url));

            assert.equal(urls.length, 2);
            assert.ok(urls[0].endsWith(`/${videoName}`), `pierwszy adres ${urls[0]} nie wskazuje pliku wideo ${videoName}`);
            assert.ok(urls[1].endsWith(`/${audioName}`), `drugi adres ${urls[1]} nie wskazuje pliku audio ${audioName}`);
            assert.ok(decodeURIComponent(result.json.downloadUrl).endsWith(`/${audioName}`));
        } finally {
            await new Promise(resolve => server.close(resolve));
        }
    });
}
