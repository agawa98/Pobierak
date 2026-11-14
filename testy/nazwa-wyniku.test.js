// Testy zadania B13g: bez przedrostka "processed-" (buildProcessedFileName, buildTempFileName, processDownloadedFile).
// ffmpeg pisze do pliku "tmp-<nazwa>", po sukcesie oryginal znika, a wynik dostaje nazwe oryginalu z wlasciwym rozszerzeniem.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. spawn jest podmieniony na atrape, ktora udaje ffmpeg:
// tworzy plik wynikowy (ostatni argument) albo konczy sie bledem. Pliki robocze leza w os.tmpdir() (parametr "dir"),
// testy nie pisza do folderu downloads. Ostatnia czesc uruchamia prawdziwy ffmpeg na probce z generatora;
// gdy ffmpeg albo ffprobe nie ma, te testy sa pomijane.

const { folderDocelowy } = require("./folder-docelowy-pomoc");       // UL-2b: zadanie pobrania musi miec pole folder
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");
const originalSpawn = childProcess.spawn;

// zachowanie atrapy ustawia kazdy test: funkcja (command, args, fake) -> kod wyjscia albo obiekt bledu uruchomienia
const spawnState = { calls: [], behavior: null, real: false };

// wczytuje app.js od nowa z atrapa spawn (app.js bierze spawn przy require)
function loadApp() {
    childProcess.spawn = (command, args) => {
        spawnState.calls.push({ command, args });

        if (spawnState.real) {
            return originalSpawn(command, args);
        }

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            const result = spawnState.behavior ? spawnState.behavior(command, args, fake) : 0;

            if (result instanceof Error) {
                fake.emit("error", result);
                return;
            }

            fake.emit("close", result);
        });

        return fake;
    };

    delete require.cache[require.resolve(appPath)];

    try {
        return require(appPath);
    } finally {
        childProcess.spawn = originalSpawn;
    }
}

const appModule = loadApp();
const { buildProcessedFileName, buildTempFileName, processDownloadedFile } = appModule;

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

// nowy pusty folder roboczy w os.tmpdir(), usuwany po tescie
function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b13g-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

function reset(behavior) {
    spawnState.calls.length = 0;
    spawnState.behavior = behavior;
    spawnState.real = false;
}

// udany ffmpeg: zapisuje plik wynikowy (ostatni argument) i konczy sie kodem 0. zapamietuje, co lezalo w folderze w trakcie pracy
function ffmpegOk(seen) {
    return (command, args) => {
        const outputPath = args[args.length - 1];

        if (seen) {
            seen.duringRun = fs.readdirSync(path.dirname(outputPath)).sort();
        }

        fs.writeFileSync(outputPath, "WYNIK FFMPEG");

        return 0;
    };
}

// nieudany ffmpeg: zostawia niedokonczony plik wynikowy, wypisuje blad i konczy sie kodem 1
function ffmpegFails(command, args, fake) {
    fs.writeFileSync(args[args.length - 1], "NIEDOKONCZONY");
    fake.stderr.emit("data", Buffer.from("Error while filtering: cos poszlo nie tak\n"));

    return 1;
}

function run(dir, overrides) {
    return processDownloadedFile({ trimStartSeconds: null, trimEndSeconds: null, bitrate: "best", dir, ...overrides });
}

// ---------- nazwy ----------

test("B13g: buildProcessedFileName - audio dostaje dokladnie nazwe oryginalu, bez przedrostka", () => {
    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        assert.equal(buildProcessedFileName(`tytul [abcd1234].${format}`, format, "audio"), `tytul [abcd1234].${format}`);
    }

    assert.equal(buildProcessedFileName("tytul audio [abcd1234].mp3", "mp3", "audio"), "tytul audio [abcd1234].mp3");
});

test("B13g: buildProcessedFileName - wideo dostaje nazwe oryginalu z rozszerzeniem formatu (mjpeg -> avi), bez przedrostka", () => {
    for (const mediaType of ["video", "videoOnly"]) {
        assert.equal(buildProcessedFileName("tytul [abcd1234].webm", "mp4", mediaType), "tytul [abcd1234].mp4");
        assert.equal(buildProcessedFileName("tytul [abcd1234].mp4", "mp4", mediaType), "tytul [abcd1234].mp4");
        assert.equal(buildProcessedFileName("tytul [abcd1234].mp4", "mkv", mediaType), "tytul [abcd1234].mkv");
        assert.equal(buildProcessedFileName("tytul [abcd1234].mp4", "mpeg", mediaType), "tytul [abcd1234].mpeg");
        assert.equal(buildProcessedFileName("tytul [abcd1234].mp4", "mjpeg", mediaType), "tytul [abcd1234].avi");
    }
});

test("B13g: buildProcessedFileName - tytul zaczynajacy sie od processed- albo tmp- zostaje nietkniety", () => {
    assert.equal(buildProcessedFileName("processed-moj film [abcd1234].mp3", "mp3", "audio"), "processed-moj film [abcd1234].mp3");
    assert.equal(buildProcessedFileName("tmp-moj film [abcd1234].webm", "mp4", "video"), "tmp-moj film [abcd1234].mp4");
});

test("B13g: buildTempFileName - przedrostek tmp- przed cala nazwa", () => {
    assert.equal(buildTempFileName("tytul [abcd1234].mp3"), "tmp-tytul [abcd1234].mp3");
    assert.equal(buildTempFileName("tytul video [abcd1234].avi"), "tmp-tytul video [abcd1234].avi");
});

test("B13g: w app.js nie ma juz przedrostka processed-", () => {
    assert.equal(fs.readFileSync(appPath, "utf8").includes("processed-"), false);
});

// ---------- sukces ffmpeg ----------

test("B13g: audio mp3 + normalizacja - ffmpeg pisze do tmp-, wynik ma nazwe oryginalu, w folderze zostaje jeden plik", async (t) => {
    const dir = makeDir(t);
    const name = "the #1 NO SCOPE player in rivals [abcd1234].mp3";
    const seen = {};

    fs.writeFileSync(path.join(dir, name), "ORYGINAL");
    reset(ffmpegOk(seen));

    const finalFile = await run(dir, { generatedFile: name, experimental: options({ normalize: true }), mediaType: "audio", format: "mp3" });

    assert.equal(spawnState.calls.length, 1);
    assert.equal(spawnState.calls[0].command, appModule.ffmpegPath);

    const args = spawnState.calls[0].args;

    assert.equal(args[args.indexOf("-i") + 1], path.join(dir, name), "ffmpeg czyta oryginal");
    assert.equal(args[args.length - 1], path.join(dir, `tmp-${name}`), "ffmpeg pisze do pliku tymczasowego");
    assert.deepEqual(seen.duringRun, [name], "w trakcie pracy ffmpeg oryginal jeszcze lezy na miejscu");

    assert.equal(finalFile, name);
    assert.equal(finalFile.includes("processed-"), false);
    assert.equal(finalFile.startsWith("tmp-"), false);
    assert.deepEqual(fs.readdirSync(dir), [name], "nie zostaje ani oryginal pod inna nazwa, ani plik tymczasowy");
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "WYNIK FFMPEG", "pod koncowa nazwa lezy wynik ffmpeg, nie oryginal");
});

test("B13g: audio z kazdym efektem osobno - zawsze nazwa oryginalu i jeden plik", async (t) => {
    const effects = [{ normalize: true }, { channels: "mono" }, { bitcrush: 5 }, { sampleRate: "22050" }];

    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        for (const effect of effects) {
            const dir = makeDir(t);
            const name = `tytul [abcd1234].${format}`;

            fs.writeFileSync(path.join(dir, name), "ORYGINAL");
            reset(ffmpegOk());

            const finalFile = await run(dir, { generatedFile: name, experimental: options(effect), mediaType: "audio", format });

            assert.equal(finalFile, name, `${format} ${JSON.stringify(effect)}`);
            assert.deepEqual(fs.readdirSync(dir), [name]);
            assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "WYNIK FFMPEG");
        }
    }
});

test("B13g: film ze zmiana rozszerzenia (webm -> mp4) - wynik to nazwa oryginalu z .mp4, oryginal .webm znika", async (t) => {
    const dir = makeDir(t);

    fs.writeFileSync(path.join(dir, "tytul [abcd1234].webm"), "ORYGINAL");
    reset(ffmpegOk());

    const finalFile = await run(dir, { generatedFile: "tytul [abcd1234].webm", experimental: options(), mediaType: "video", format: "mp4" });

    const args = spawnState.calls[0].args;

    assert.equal(args[args.length - 1], path.join(dir, "tmp-tytul [abcd1234].mp4"));
    assert.equal(finalFile, "tytul [abcd1234].mp4");
    assert.deepEqual(fs.readdirSync(dir), ["tytul [abcd1234].mp4"]);
    assert.equal(fs.readFileSync(path.join(dir, finalFile), "utf8"), "WYNIK FFMPEG");
});

test("B13g: film mp4 + efekty (to samo rozszerzenie) - wynik zastepuje oryginal pod ta sama nazwa", async (t) => {
    const dir = makeDir(t);
    const name = "tytul [abcd1234].mp4";

    fs.writeFileSync(path.join(dir, name), "ORYGINAL");
    reset(ffmpegOk());

    const finalFile = await run(dir, { generatedFile: name, experimental: options({ normalize: true, channels: "mono" }), mediaType: "video", format: "mp4" });

    assert.equal(finalFile, name);
    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "WYNIK FFMPEG");
});

test("B13g: film mpeg i mjpeg - nazwa oryginalu z .mpeg / .avi, bez przedrostka", async (t) => {
    for (const [format, extension] of [["mpeg", "mpeg"], ["mjpeg", "avi"]]) {
        const dir = makeDir(t);

        fs.writeFileSync(path.join(dir, "tytul [abcd1234].mp4"), "ORYGINAL");
        reset(ffmpegOk());

        const finalFile = await run(dir, { generatedFile: "tytul [abcd1234].mp4", experimental: options(), mediaType: "video", format });

        assert.equal(finalFile, `tytul [abcd1234].${extension}`);
        assert.deepEqual(fs.readdirSync(dir), [`tytul [abcd1234].${extension}`]);
    }
});

test("B13g: tryb osobno, wideo (galaz videoOnly) - ta sama zasada: tmp-, potem nazwa oryginalu", async (t) => {
    for (const [format, source, expected] of [
        ["mp4", "tytul video [abcd1234].mp4", "tytul video [abcd1234].mp4"],
        ["mkv", "tytul video [abcd1234].webm", "tytul video [abcd1234].mkv"],
        ["mjpeg", "tytul video [abcd1234].mp4", "tytul video [abcd1234].avi"]
    ]) {
        const dir = makeDir(t);
        const seen = {};

        fs.writeFileSync(path.join(dir, source), "ORYGINAL");
        reset(ffmpegOk(seen));

        const finalFile = await run(dir, { generatedFile: source, experimental: options(), mediaType: "videoOnly", format });

        const args = spawnState.calls[0].args;

        assert.equal(args[args.length - 1], path.join(dir, `tmp-${expected}`), format);
        assert.deepEqual(seen.duringRun, [source]);
        assert.equal(finalFile, expected, format);
        assert.deepEqual(fs.readdirSync(dir), [expected], format);
        assert.equal(fs.readFileSync(path.join(dir, expected), "utf8"), "WYNIK FFMPEG");
    }
});

test("B13g: inne pliki w folderze (drugie zadanie, plik audio trybu osobno) zostaja nietkniete", async (t) => {
    const dir = makeDir(t);
    const others = ["tytul audio [abcd1234].mp3", "tytul [ffff0000].mp3", "tmp-inny [ffff0000].mp3"];

    fs.writeFileSync(path.join(dir, "tytul video [abcd1234].mp4"), "ORYGINAL");

    for (const other of others) {
        fs.writeFileSync(path.join(dir, other), "INNY");
    }

    reset(ffmpegOk());

    const finalFile = await run(dir, { generatedFile: "tytul video [abcd1234].mp4", experimental: options(), mediaType: "videoOnly", format: "mpeg" });

    assert.equal(finalFile, "tytul video [abcd1234].mpeg");
    assert.deepEqual(fs.readdirSync(dir).sort(), [...others, "tytul video [abcd1234].mpeg"].sort());

    for (const other of others) {
        assert.equal(fs.readFileSync(path.join(dir, other), "utf8"), "INNY");
    }
});

test("B13g: bez efektow ffmpeg nie jest uruchamiany, plik zostaje pod swoja nazwa", async (t) => {
    const dir = makeDir(t);
    const name = "tytul [abcd1234].mp3";

    fs.writeFileSync(path.join(dir, name), "ORYGINAL");
    reset(ffmpegOk());

    const finalFile = await run(dir, { generatedFile: name, experimental: options(), mediaType: "audio", format: "mp3" });

    assert.equal(spawnState.calls.length, 0);
    assert.equal(finalFile, name);
    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "ORYGINAL");
});

test("B13g: bez parametru dir ffmpeg pisze do tmp- w folderze downloads programu", async () => {
    reset(() => 0);     // atrapa niczego nie tworzy

    const originalRenameSync = fs.renameSync;
    const renames = [];

    fs.renameSync = (from, to) => { renames.push([from, to]); };

    try {
        const finalFile = await processDownloadedFile({
            generatedFile: "brak takiego pliku [b13gtest].mp3", experimental: options({ normalize: true }),
            trimStartSeconds: null, trimEndSeconds: null, mediaType: "audio", format: "mp3", bitrate: "best"
        });

        const args = spawnState.calls[0].args;
        const tempPath = path.join(appModule.downloadsDir, "tmp-brak takiego pliku [b13gtest].mp3");
        const finalPath = path.join(appModule.downloadsDir, "brak takiego pliku [b13gtest].mp3");

        assert.equal(args[args.length - 1], tempPath);
        assert.equal(args[args.indexOf("-i") + 1], finalPath);
        assert.deepEqual(renames, [[tempPath, finalPath]]);
        assert.equal(finalFile, "brak takiego pliku [b13gtest].mp3");
    } finally {
        fs.renameSync = originalRenameSync;
    }
});

// ---------- blad ffmpeg ----------

test("B13g: blad ffmpeg - plik tymczasowy jest usuwany, oryginal zostaje, blad idzie dalej", async (t) => {
    for (const [mediaType, format, name, experimental] of [
        ["audio", "mp3", "tytul [abcd1234].mp3", options({ normalize: true })],
        ["video", "mp4", "tytul [abcd1234].mp4", options({ channels: "mono" })],
        ["video", "mjpeg", "tytul [abcd1234].mp4", options()],
        ["videoOnly", "mp4", "tytul video [abcd1234].mp4", options()]
    ]) {
        const dir = makeDir(t);
        let tempExistedAtFailure = false;

        fs.writeFileSync(path.join(dir, name), "ORYGINAL");
        reset((command, args, fake) => {
            const code = ffmpegFails(command, args, fake);

            tempExistedAtFailure = fs.existsSync(args[args.length - 1]) && path.basename(args[args.length - 1]).startsWith("tmp-");

            return code;
        });

        await assert.rejects(
            run(dir, { generatedFile: name, experimental, mediaType, format }),
            (error) => {
                assert.match(error.message, /FFMPEG/);
                assert.match(error.error, /cos poszlo nie tak/);
                return true;
            },
            `${mediaType} ${format}`
        );

        assert.equal(tempExistedAtFailure, true, "atrapa naprawde zostawila plik tymczasowy");
        assert.deepEqual(fs.readdirSync(dir), [name], `${mediaType} ${format}: zostaje tylko oryginal`);
        assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "ORYGINAL");
    }
});

test("B13g: blad ffmpeg, zanim powstal plik tymczasowy - dalej blad ffmpeg (nie blad usuwania), oryginal zostaje", async (t) => {
    const dir = makeDir(t);
    const name = "tytul [abcd1234].mp3";

    fs.writeFileSync(path.join(dir, name), "ORYGINAL");
    reset((command, args, fake) => {
        fake.stderr.emit("data", Buffer.from("Invalid data found when processing input\n"));

        return 1;
    });

    await assert.rejects(
        run(dir, { generatedFile: name, experimental: options({ normalize: true }), mediaType: "audio", format: "mp3" }),
        (error) => {
            assert.match(error.error, /Invalid data found/);
            return true;
        }
    );

    assert.deepEqual(fs.readdirSync(dir), [name]);
});

test("B13g: ffmpeg nie daje sie uruchomic - blad idzie dalej, oryginal zostaje, nic nie jest przemianowane", async (t) => {
    const dir = makeDir(t);
    const name = "tytul [abcd1234].mp3";

    fs.writeFileSync(path.join(dir, name), "ORYGINAL");
    reset(() => Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }));

    await assert.rejects(
        run(dir, { generatedFile: name, experimental: options({ normalize: true }), mediaType: "audio", format: "mp3" }),
        (error) => {
            assert.match(error.error, /ENOENT/);
            return true;
        }
    );

    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "ORYGINAL");
});

// ---------- nieudana zmiana nazwy ----------

test("B13g: gdy zmiana nazwy sie nie uda, wynik zostaje pod nazwa tymczasowa i ta nazwa jest zwracana", async (t) => {
    const dir = makeDir(t);

    fs.writeFileSync(path.join(dir, "tytul [abcd1234].webm"), "ORYGINAL");
    reset(ffmpegOk());

    t.mock.method(fs, "renameSync", () => {
        throw Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" });
    });

    const finalFile = await run(dir, { generatedFile: "tytul [abcd1234].webm", experimental: options(), mediaType: "video", format: "mp4" });

    assert.equal(finalFile, "tmp-tytul [abcd1234].mp4");
    assert.deepEqual(fs.readdirSync(dir), ["tmp-tytul [abcd1234].mp4"]);
    assert.equal(fs.readFileSync(path.join(dir, finalFile), "utf8"), "WYNIK FFMPEG");
});

// ---------- cala droga przez POST /api/download (yt-dlp i ffmpeg to atrapy, nic nie jest zapisywane) ----------

// podstawia liste plikow folderu downloads (pliki "pobrane" przez atrape yt-dlp powstaja z szablonu -o)
// oraz zmiane nazwy i usuwanie w tym folderze - zapisuje je zamiast wykonywac
function fakeDownloads(t, extensionFor) {
    const originalReaddirSync = fs.readdirSync;
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;
    const inDownloads = (target) => path.resolve(path.dirname(String(target))) === path.resolve(appModule.downloadsDir);
    const operations = [];

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) !== path.resolve(appModule.downloadsDir)) {
            return originalReaddirSync(target, ...rest);
        }

        return spawnState.calls
            .filter(call => call.command === appModule.ytDlpPath)
            .map(call => {
                const template = path.basename(call.args[call.args.indexOf("-o") + 1]);

                return template.replace("%(title).150B", "tytul").replace("%(ext)s", extensionFor(call.args));
            });
    });

    t.mock.method(fs, "renameSync", (from, to) => {
        if (!inDownloads(from)) {
            return originalRenameSync(from, to);
        }

        operations.push(["rename", path.basename(from), path.basename(to)]);
    });

    t.mock.method(fs, "unlinkSync", (target) => {
        if (!inDownloads(target)) {
            return originalUnlinkSync(target);
        }

        operations.push(["unlink", path.basename(target)]);
    });

    return operations;
}

async function postDownload(t, body) {
    const server = await new Promise((resolve) => {
        const created = appModule.app.listen(0, "127.0.0.1", () => resolve(created));
    });

    t.after(() => server.close());

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderDocelowy, ...body }),
        signal: AbortSignal.timeout(10000)      // gdyby serwer nie odpowiedzial, test pada zamiast wisiec
    });

    return { status: response.status, json: await response.json() };
}

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

test("B13g: POST /api/download audio mp3 + normalizacja - adres bez processed- i bez tmp-, oryginal usuniety przed zmiana nazwy", async (t) => {
    reset(() => 0);

    const operations = fakeDownloads(t, () => "mp3");

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "audio", bitrate: "128", resolution: "best", format: "mp3",
        experimental: options({ normalize: true })
    });

    assert.equal(status, 200, JSON.stringify(json));
    // UL-2b: zamiast adresu odpowiedz niesie nazwe pliku i pelna sciezke w folderze docelowym
    assert.equal(json.files.length, 1);
    assert.match(json.files[0].name, /^tytul \[[0-9a-f]{8}\]\.mp3$/);
    assert.equal(json.files[0].path, path.join(folderDocelowy, json.files[0].name));

    const name = json.files[0].name;
    const ffmpegCalls = spawnState.calls.filter(call => call.command === appModule.ffmpegPath);

    assert.equal(ffmpegCalls.length, 1);
    assert.equal(ffmpegCalls[0].args[ffmpegCalls[0].args.length - 1], path.join(appModule.downloadsDir, `tmp-${name}`));
    assert.deepEqual(operations, [["unlink", name], ["rename", `tmp-${name}`, name]]);
});

test("B13g: POST /api/download tryb osobno mpeg + normalizacja - oba adresy bez przedrostkow", async (t) => {
    reset(() => 0);

    const operations = fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mp4"));

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "separate", bitrate: "best", resolution: "best", format: "mpeg",
        experimental: options({ normalize: true })
    });

    assert.equal(status, 200, JSON.stringify(json));
    // UL-2b: zamiast adresow odpowiedz niesie nazwy plikow i pelne sciezki w folderze docelowym
    assert.equal(json.files.length, 2);
    assert.match(json.files[0].name, /^tytul video \[[0-9a-f]{8}\]\.mpeg$/);
    assert.match(json.files[1].name, /^tytul audio \[[0-9a-f]{8}\]\.mp3$/);
    assert.deepEqual(json.files.map(file => file.path), json.files.map(file => path.join(folderDocelowy, file.name)));

    const videoName = json.files[0].name;
    const audioName = json.files[1].name;

    assert.deepEqual(operations, [
        ["unlink", videoName.replace(/\.mpeg$/, ".mp4")], ["rename", `tmp-${videoName}`, videoName],
        ["unlink", audioName], ["rename", `tmp-${audioName}`, audioName]
    ]);
});

test("B13g: POST /api/download - blad ffmpeg daje 500, plik tymczasowy usuniety, bez zmiany nazwy i bez usuwania oryginalu", async (t) => {
    reset((command, args, fake) => {
        if (command !== appModule.ffmpegPath) {
            return 0;
        }

        fake.stderr.emit("data", Buffer.from("Conversion failed!\n"));

        return 1;
    });

    const operations = fakeDownloads(t, () => "mp3");

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "audio", bitrate: "128", resolution: "best", format: "mp3",
        experimental: options({ normalize: true })
    });

    assert.equal(status, 500, JSON.stringify(json));
    assert.equal(json.success, false);
    assert.equal(operations.length, 1);
    assert.equal(operations[0][0], "unlink");
    assert.match(operations[0][1], /^tmp-tytul \[[0-9a-f]{8}\]\.mp3$/);
});

// ---------- prawdziwy ffmpeg na probce z generatora ----------

function programWorks(program, versionArg) {
    const result = childProcess.spawnSync(program, [versionArg], { stdio: "ignore" });

    return !result.error && result.status === 0;
}

const ffmpeg = appModule.ffmpegPath;
const haveFfmpeg = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version");
const skip = haveFfmpeg ? false : "brak ffmpeg albo ffprobe";

function probe(filePath, args) {
    const result = childProcess.spawnSync("ffprobe", ["-v", "error", ...args, "-of", "csv=p=0", filePath], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim().split(/\r?\n/)[0].replace(/,+$/, "");
}

// probka: 2 s tonu stereo 44100 Hz w mp3 (jak plik audio z yt-dlp)
function makeSample(filePath) {
    const result = childProcess.spawnSync(ffmpeg, [
        "-y", "-nostdin", "-v", "error",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
        "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
        filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
}

test("B13g: prawdziwy ffmpeg - audio mp3 + normalizacja: ta sama nazwa, jeden plik w folderze, plik jest przetworzony", { skip }, async (t) => {
    const dir = makeDir(t);
    const name = "the #1 NO SCOPE player in rivals [abcd1234].mp3";

    makeSample(path.join(dir, name));
    assert.equal(probe(path.join(dir, name), ["-select_streams", "a:0", "-show_entries", "stream=sample_rate"]), "44100");

    reset(null);
    spawnState.real = true;
    t.after(() => { spawnState.real = false; });

    const finalFile = await run(dir, { generatedFile: name, experimental: options({ normalize: true }), mediaType: "audio", format: "mp3" });

    assert.equal(finalFile, name);
    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(probe(path.join(dir, name), ["-select_streams", "a:0", "-show_entries", "stream=codec_name"]), "mp3");
    // normalizacja wychodzi w 48 kHz (B6), probka miala 44,1 kHz - czyli pod stara nazwa lezy wynik ffmpeg, a nie oryginal
    assert.equal(probe(path.join(dir, name), ["-select_streams", "a:0", "-show_entries", "stream=sample_rate"]), "48000");

    const duration = Number(probe(path.join(dir, name), ["-show_entries", "format=duration"]));

    assert.ok(duration > 1.8 && duration < 2.3, `dlugosc ${duration} s`);
});

test("B13g: prawdziwy ffmpeg - uszkodzony plik wejsciowy: blad, bez pliku tymczasowego, oryginal zostaje", { skip }, async (t) => {
    const dir = makeDir(t);
    const name = "zepsuty [abcd1234].mp3";

    fs.writeFileSync(path.join(dir, name), "to nie jest plik mp3");

    reset(null);
    spawnState.real = true;
    t.after(() => { spawnState.real = false; });

    await assert.rejects(run(dir, { generatedFile: name, experimental: options({ normalize: true }), mediaType: "audio", format: "mp3" }));

    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "to nie jest plik mp3");
});
