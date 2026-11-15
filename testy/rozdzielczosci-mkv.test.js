// Testy zadania UL-1: 1440p i 2160p sa dozwolone tylko z formatem mkv.
// Serwer: allowedResolutions ma "1440" i "2160", validateRequest odrzuca je dla innych formatow (400),
// a argumenty yt-dlp ograniczaja wysokosc do 1440 i 2160.
// Nic nie jest pobierane z internetu: spawn jest podmieniony na atrape, serwer slucha na losowym porcie 127.0.0.1,
// jedyny zapisywany folder to folder tymczasowy z folder-docelowy-pomoc.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");
const { folderDocelowy } = require("./folder-docelowy-pomoc.js");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn, ktora zapisuje argumenty i od razu konczy sie kodem 0 (bez tworzenia plikow)
function loadApp() {
    const calls = [];
    const originalSpawn = childProcess.spawn;

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();
        fake.kill = () => {};
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
const { buildVideoFormat, buildVideoOnlyFormat } = appModule;

// UL-8d: oczekiwany wariant z limitem krotszego boku - najpierw film pionowy (szerokosc <= R, wysokosc > R),
// potem dotychczasowy limit wysokosci (film poziomy)
function shorterSide(prefix, resolution, suffix = "") {
    return `${prefix}[width<=${resolution}][height>${resolution}]${suffix}/${prefix}[height<=${resolution}]${suffix}`;
}

const mkvOnlyMessage = "Ta rozdzielczość jest dostępna tylko w formacie MKV.";
const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };

function body(type, format, resolution) {
    return { url: testUrl, type, format, resolution, bitrate: "best", experimental: noEffects, folder: folderDocelowy };
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

async function postDownload(server, requestBody) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

function ytDlpFormats() {
    return calls.filter(call => call.args.includes("-f")).map(call => call.args[call.args.indexOf("-f") + 1]);
}

// ---------- walidacja na serwerze ----------

for (const type of ["video", "separate"]) {
    for (const format of ["mp4", "mpeg", "mjpeg"]) {
        for (const resolution of ["1440", "2160"]) {
            test(`UL-1: ${type} + ${format} + ${resolution} daje 400 z komunikatem o MKV i niczego nie uruchamia`, async (t) => {
                muteConsole(t);
                const server = await startServer(t);
                calls.length = 0;

                const { status, json } = await postDownload(server, body(type, format, resolution));

                assert.equal(status, 400, JSON.stringify(json));
                assert.equal(json.success, false);
                assert.equal(json.message, mkvOnlyMessage);
                assert.equal(calls.length, 0, "odrzucone zadanie nie moze uruchomic yt-dlp");
                assert.equal(appModule.activeJobs.size, 0);
            });
        }
    }

    for (const resolution of ["1440", "2160"]) {
        test(`UL-1: ${type} + mkv + ${resolution} przechodzi walidacje i trafia do yt-dlp z limitem ${resolution}`, async (t) => {
            muteConsole(t);
            const server = await startServer(t);
            calls.length = 0;

            // atrapa nie tworzy pliku, wiec samo pobieranie konczy sie bledem "nie znaleziono" (500) - wazne,
            // ze walidacja przepuscila zadanie i yt-dlp dostal wlasciwy filtr
            const { status, json } = await postDownload(server, body(type, "mkv", resolution));

            assert.notEqual(status, 400, JSON.stringify(json));
            assert.notEqual(json.message, mkvOnlyMessage);

            const expected = type === "video"
                ? `${shorterSide("bv*", resolution, "+ba")}/${shorterSide("b", resolution)}`
                : shorterSide("bv*", resolution);

            assert.equal(ytDlpFormats()[0], expected);
        });
    }
}

test("UL-1: dotychczasowe rozdzielczosci dalej przechodza z kazdym formatem wideo (1080 z mp4 nie dostaje komunikatu o MKV)", async (t) => {
    muteConsole(t);
    const server = await startServer(t);

    for (const format of ["mp4", "mpeg", "mjpeg", "mkv"]) {
        for (const resolution of ["144", "1080", "best"]) {
            const { status, json } = await postDownload(server, body("video", format, resolution));

            assert.notEqual(status, 400, `${format} + ${resolution}: ${JSON.stringify(json)}`);
        }
    }
});

test("UL-1: nieznana rozdzielczosc dalej daje stary komunikat, nie komunikat o MKV", async (t) => {
    muteConsole(t);
    const server = await startServer(t);

    for (const format of ["mp4", "mkv"]) {
        const { status, json } = await postDownload(server, body("video", format, "4320"));

        assert.equal(status, 400);
        assert.equal(json.message, "Nieprawidłowa rozdzielczość.");
    }
});

// ---------- argumenty yt-dlp dla nowych wartosci ----------

test("UL-1: buildVideoFormat i buildVideoOnlyFormat dla mkv ograniczaja (od UL-8d krotszy bok) do 1440 i 2160", () => {
    assert.equal(buildVideoFormat("1440", "mkv"), `${shorterSide("bv*", "1440", "+ba")}/${shorterSide("b", "1440")}`);
    assert.equal(buildVideoFormat("2160", "mkv"), `${shorterSide("bv*", "2160", "+ba")}/${shorterSide("b", "2160")}`);
    assert.equal(buildVideoOnlyFormat("1440", "mkv"), shorterSide("bv*", "1440"));
    assert.equal(buildVideoOnlyFormat("2160", "mkv"), shorterSide("bv*", "2160"));
});
