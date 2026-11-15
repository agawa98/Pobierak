// Testy zadania B12: wideo trybu "osobno" w mp4 nie jest juz kodowane od nowa (libx264 crf 23),
// tylko przepakowywane: -c copy -an -movflags +faststart. Przyciecie dalej koduje (zadanie B11), mkv/mpeg/mjpeg bez zmian.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. spawn jest podmieniony na atrape; pliki robocze leza w os.tmpdir().
// Ostatnia czesc uruchamia prawdziwy ffmpeg na probce z generatora i sprawdza, ze obraz jest skopiowany bit w bit
// (ta sama suma pakietow co w zrodle), indeks (moov) stoi przed danymi (mdat), plik dekoduje sie bez bledow i nie ma dzwieku.
// Gdy ffmpeg albo ffprobe nie ma, te testy sa pomijane. Odtwarzanie w przegladarce: testy/przegladarka/odtwarzanie.przegladarka.js.

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

const spawnState = { calls: [], real: false, writeOutput: true };

// wczytuje app.js od nowa z atrapa spawn (app.js bierze spawn przy require).
// atrapa ffmpeg zapisuje plik wynikowy (ostatni argument), atrapa yt-dlp nic nie tworzy
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
            if (spawnState.writeOutput) {
                fs.writeFileSync(args[args.length - 1], "WYNIK FFMPEG");
            }

            fake.emit("close", 0);
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
const { processDownloadedFile, addVideoCodecArgs, shouldProcessMedia } = appModule;

// oczekiwane argumenty przepakowania (zadanie: -c copy -movflags +faststart; -an zostalo z poprzedniego kodu)
const REMUX = ["-c", "copy", "-an", "-movflags", "+faststart"];
const OLD_ENCODING = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-an"];
const TRIM_ENCODING = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b12-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

function reset() {
    spawnState.calls.length = 0;
    spawnState.real = false;
    spawnState.writeOutput = true;
}

// uruchamia processDownloadedFile na pliku-atrapie w folderze tymczasowym i zwraca argumenty ffmpeg (albo null, gdy ffmpeg nie ruszyl)
async function ffmpegArgsFor(t, overrides) {
    const dir = makeDir(t);

    fs.writeFileSync(path.join(dir, overrides.generatedFile), "ORYGINAL");
    reset();

    const finalFile = await processDownloadedFile({
        bitrate: "best", experimental: options(), trimStartSeconds: null, trimEndSeconds: null, dir, ...overrides
    });

    if (spawnState.calls.length === 0) {
        return { args: null, dir, finalFile };
    }

    assert.equal(spawnState.calls.length, 1);
    assert.equal(spawnState.calls[0].command, appModule.ffmpegPath);

    return { args: spawnState.calls[0].args, dir, finalFile };
}

// w argumentach nie ma zadnego kodowania obrazu
function assertNoVideoEncoding(args, label) {
    for (const word of ["libx264", "-crf", "-preset", "-pix_fmt", "-c:v"]) {
        assert.equal(args.includes(word), false, `${label}: w argumentach jest ${word}`);
    }
}

// ---------- addVideoCodecArgs ----------

test("B12: addVideoCodecArgs dla videoOnly + mp4 daje przepakowanie: -c copy -an -movflags +faststart, bez kodowania", () => {
    for (const sampleRate of ["default", "8000", "24000", "48000"]) {
        const args = [];

        addVideoCodecArgs(args, "mp4", "videoOnly", sampleRate);

        assert.deepEqual(args, REMUX, `sample rate ${sampleRate}`);
        assert.notDeepEqual(args, OLD_ENCODING);
        assertNoVideoEncoding(args, `sample rate ${sampleRate}`);
    }
});

test("B12: addVideoCodecArgs dopisuje przepakowanie na koniec listy i nie rusza tego, co juz w niej bylo", () => {
    const args = ["-y", "-nostdin", "-i", "plik.mp4"];

    addVideoCodecArgs(args, "mp4", "videoOnly", "default");

    assert.deepEqual(args, ["-y", "-nostdin", "-i", "plik.mp4", ...REMUX]);
});

test("B12: opcja +faststart stoi zaraz po -movflags i wystepuje raz", () => {
    const args = [];

    addVideoCodecArgs(args, "mp4", "videoOnly", "default");

    assert.equal(args.filter(arg => arg === "-movflags").length, 1);
    assert.equal(args[args.indexOf("-movflags") + 1], "+faststart");
    assert.equal(args[args.indexOf("-c") + 1], "copy");
});

test("B12: pozostale galezie addVideoCodecArgs bez zmian (film mp4, mkv, mpeg, mjpeg) i bez -movflags", () => {
    const expected = [
        ["mp4", "video", ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]],
        ["mkv", "video", ["-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]],
        ["mkv", "videoOnly", ["-c:v", "copy", "-an"]],
        ["mpeg", "videoOnly", ["-c:v", "mpeg2video", "-q:v", "5", "-an", "-f", "mpeg"]],
        ["mpeg", "video", ["-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "192k", "-f", "mpeg"]],
        ["mjpeg", "videoOnly", ["-c:v", "mjpeg", "-q:v", "5", "-an", "-f", "avi"]],
        ["mjpeg", "video", ["-c:v", "mjpeg", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "avi"]]
    ];

    for (const [format, mediaType, list] of expected) {
        const args = [];

        addVideoCodecArgs(args, format, mediaType, "default");

        assert.deepEqual(args, list, `${format} ${mediaType}`);
        assert.equal(args.includes("-movflags"), false, `${format} ${mediaType}`);
    }
});

// ---------- shouldProcessMedia ----------

test("B12: shouldProcessMedia - wideo osobno mp4 dalej przechodzi przez ffmpeg (przepakowanie), takze bez efektow i bez przyciecia", () => {
    assert.equal(shouldProcessMedia(options(), null, null, "videoOnly", "mp4", "tytul video [abcd1234].mp4"), true);
    assert.equal(shouldProcessMedia(options(), null, null, "videoOnly", "mp4", "tytul video [abcd1234].webm"), true);
    assert.equal(shouldProcessMedia(options({ normalize: true, channels: "mono" }), null, null, "videoOnly", "mp4", "tytul video [abcd1234].mp4"), true);

    // dla porownania: mkv z pliku mkv nie wymaga niczego, a film mp4 (tryb laczny) bez efektow tez nie
    assert.equal(shouldProcessMedia(options(), null, null, "videoOnly", "mkv", "tytul video [abcd1234].mkv"), false);
    assert.equal(shouldProcessMedia(options(), null, null, "video", "mp4", "tytul [abcd1234].mp4"), false);
});

// ---------- processDownloadedFile (ffmpeg to atrapa) ----------

test("B12: processDownloadedFile - wideo osobno mp4 bez przyciecia: cale polecenie ffmpeg to przepakowanie", async (t) => {
    const name = "tytul video [abcd1234].mp4";
    const { args, dir, finalFile } = await ffmpegArgsFor(t, { generatedFile: name, mediaType: "videoOnly", format: "mp4" });

    assert.deepEqual(args, ["-y", "-nostdin", "-i", path.join(dir, name), ...REMUX, path.join(dir, `tmp-${name}`)]);
    assertNoVideoEncoding(args, "mp4 z mp4");
    assert.equal(finalFile, name);
    assert.deepEqual(fs.readdirSync(dir), [name]);
    assert.equal(fs.readFileSync(path.join(dir, name), "utf8"), "WYNIK FFMPEG");
});

test("B12: processDownloadedFile - tytul ze znakami #, % i slowem video: te same argumenty, nazwa bez zmian", async (t) => {
    const name = "the #1 100% video player video [abcd1234].mp4";
    const { args, dir, finalFile } = await ffmpegArgsFor(t, { generatedFile: name, mediaType: "videoOnly", format: "mp4" });

    assert.deepEqual(args, ["-y", "-nostdin", "-i", path.join(dir, name), ...REMUX, path.join(dir, `tmp-${name}`)]);
    assert.equal(finalFile, name);
});

test("B12: processDownloadedFile - wideo osobno mp4 ze zrodla webm (wariant zapasowy formatu): tez przepakowanie, plik dostaje .mp4", async (t) => {
    const { args, dir, finalFile } = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].webm", mediaType: "videoOnly", format: "mp4" });

    assert.deepEqual(args, [
        "-y", "-nostdin", "-i", path.join(dir, "tytul video [abcd1234].webm"), ...REMUX, path.join(dir, "tmp-tytul video [abcd1234].mp4")
    ]);
    assert.equal(finalFile, "tytul video [abcd1234].mp4");
    assert.deepEqual(fs.readdirSync(dir), ["tytul video [abcd1234].mp4"]);
});

test("B12: efekty audio (normalizacja, mono, bitcrush, sample rate) nie zmieniaja przepakowania wideo osobno mp4", async (t) => {
    for (const experimental of [
        options({ normalize: true }),
        options({ channels: "mono" }),
        options({ bitcrush: 8 }),
        options({ sampleRate: "8000" }),
        options({ normalize: true, channels: "mono", bitcrush: 15, sampleRate: "16000" })
    ]) {
        const { args } = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mp4", mediaType: "videoOnly", format: "mp4", experimental });

        assert.deepEqual(args.slice(4, -1), REMUX, JSON.stringify(experimental));
        assert.equal(args.includes("-af") || args.includes("-ac"), false, JSON.stringify(experimental));
    }
});

test("B12: przyciecie wideo osobno mp4 dalej koduje obraz (B11), nie kopiuje i nie dostaje +faststart z przepakowania", async (t) => {
    for (const [start, end] of [[5, 12], [5, null], [null, 12], [0, null]]) {
        const { args } = await ffmpegArgsFor(t, {
            generatedFile: "tytul video [abcd1234].mp4", mediaType: "videoOnly", format: "mp4", trimStartSeconds: start, trimEndSeconds: end
        });

        assert.deepEqual(args.slice(args.indexOf("-i") + 2, -1), [...TRIM_ENCODING, "-an"], `${start}-${end}`);
        assert.equal(args.includes("copy"), false, `${start}-${end}`);
        assert.equal(args.includes("-movflags"), false, `${start}-${end}`);
    }
});

test("B12: wideo osobno w mkv, mpeg i mjpeg bez zmian; film mp4 (tryb laczny) bez zmian", async (t) => {
    // mkv z webm: kopiowanie jak dotad, bez -movflags. UL-8c dodalo -an (plik wideo trybu osobno nie moze miec dzwieku)
    let result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].webm", mediaType: "videoOnly", format: "mkv" });

    assert.deepEqual(result.args.slice(4, -1), ["-c", "copy", "-an"]);

    // mkv z mkv: ffmpeg nie rusza
    result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mkv", mediaType: "videoOnly", format: "mkv" });

    assert.equal(result.args, null);

    result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mp4", mediaType: "videoOnly", format: "mpeg" });

    assert.deepEqual(result.args.slice(4, -1), ["-c:v", "mpeg2video", "-q:v", "5", "-an", "-f", "mpeg"]);

    result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mp4", mediaType: "videoOnly", format: "mjpeg" });

    assert.deepEqual(result.args.slice(4, -1), ["-c:v", "mjpeg", "-q:v", "5", "-an", "-f", "avi"]);

    // film mp4 bez efektow: ffmpeg nie rusza; z mono: obraz kopiowany, dzwiek aac - bez -movflags
    result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp4", mediaType: "video", format: "mp4" });

    assert.equal(result.args, null);

    result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp4", mediaType: "video", format: "mp4", experimental: options({ channels: "mono" }) });

    assert.deepEqual(result.args.slice(4, -1), ["-ac", "1", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]);
});

// ---------- cala droga przez POST /api/download (yt-dlp i ffmpeg to atrapy) ----------

// podstawia liste plikow folderu downloads (pliki "pobrane" przez atrape yt-dlp powstaja z szablonu -o)
// oraz zmiane nazwy i usuwanie w tym folderze - nic nie jest zapisywane ani kasowane
function fakeDownloads(t, extensionFor) {
    const originalReaddirSync = fs.readdirSync;
    const originalRenameSync = fs.renameSync;
    const originalUnlinkSync = fs.unlinkSync;
    const inDownloads = (target) => path.resolve(path.dirname(String(target))) === path.resolve(appModule.downloadsDir);

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

    t.mock.method(fs, "renameSync", (from, to) => (inDownloads(from) ? undefined : originalRenameSync(from, to)));
    t.mock.method(fs, "unlinkSync", (target) => (inDownloads(target) ? undefined : originalUnlinkSync(target)));
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
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

function ffmpegCalls() {
    return spawnState.calls.filter(call => call.command === appModule.ffmpegPath).map(call => call.args);
}

test("B12: POST /api/download tryb osobno mp4 bez efektow - ffmpeg rusza raz, tylko dla pliku wideo, i tylko przepakowuje", async (t) => {
    for (const resolution of ["720", "best"]) {
        reset();
        spawnState.writeOutput = false;
        fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mp4"));

        const { status, json } = await postDownload(t, {
            url: testUrl, type: "separate", bitrate: "best", resolution, format: "mp4", experimental: options()
        });

        assert.equal(status, 200, JSON.stringify(json));
        // UL-2b: zamiast adresow odpowiedz niesie nazwy plikow i pelne sciezki w folderze docelowym
        assert.equal(json.files.length, 2);
        assert.ok(json.files[0].name.endsWith(".mp4"));
        assert.equal(json.files[0].path, path.join(folderDocelowy, json.files[0].name));

        const calls = ffmpegCalls();

        assert.equal(calls.length, 1, "plik audio bez efektow nie idzie przez ffmpeg");

        const [videoArgs] = calls;
        const input = videoArgs[videoArgs.indexOf("-i") + 1];

        assert.ok(path.basename(input).includes(" video ["), input);
        assert.deepEqual(videoArgs.slice(0, 3), ["-y", "-nostdin", "-i"]);
        assert.deepEqual(videoArgs.slice(4, -1), REMUX);
        assert.equal(path.basename(videoArgs[videoArgs.length - 1]), `tmp-${path.basename(input)}`);

        t.mock.restoreAll();
    }
});

test("B12: POST /api/download tryb osobno mp4 + normalizacja + mono - wideo przepakowane, efekty ida tylko do pliku audio", async (t) => {
    reset();
    spawnState.writeOutput = false;
    fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mp4"));

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "separate", bitrate: "best", resolution: "720", format: "mp4",
        experimental: options({ normalize: true, channels: "mono" })
    });

    assert.equal(status, 200, JSON.stringify(json));

    const calls = ffmpegCalls();

    assert.equal(calls.length, 2);

    const [videoArgs, audioArgs] = calls;

    assert.ok(path.basename(videoArgs[videoArgs.indexOf("-i") + 1]).includes(" video ["));
    assert.deepEqual(videoArgs.slice(4, -1), REMUX);

    assert.ok(path.basename(audioArgs[audioArgs.indexOf("-i") + 1]).includes(" audio ["));
    assert.deepEqual(audioArgs.slice(4, -1), ["-af", "loudnorm,aresample=48000", "-ac", "1", "-q:a", "0"]);
    assert.equal(audioArgs.includes("-movflags"), false);
});

test("B12: POST /api/download film mp4 (tryb laczny) bez efektow - ffmpeg dalej nie rusza", async (t) => {
    reset();
    spawnState.writeOutput = false;
    fakeDownloads(t, () => "mp4");

    const { status } = await postDownload(t, {
        url: testUrl, type: "video", bitrate: "best", resolution: "720", format: "mp4", experimental: options()
    });

    assert.equal(status, 200);
    assert.equal(ffmpegCalls().length, 0);
});

// ---------- prawdziwy ffmpeg na probce z generatora ----------

function programWorks(command, versionArg) {
    try {
        return childProcess.spawnSync(command, [versionArg], { encoding: "utf8" }).status === 0;
    } catch {
        return false;
    }
}

const ffmpeg = appModule.ffmpegPath;
const haveFfmpeg = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version");
const skip = haveFfmpeg ? false : "brak ffmpeg albo ffprobe";

function runFfmpeg(args) {
    const result = childProcess.spawnSync(ffmpeg, ["-y", "-nostdin", "-v", "error", ...args], { maxBuffer: 64 * 1024 * 1024 });

    assert.equal(result.status, 0, String(result.stderr));

    return result.stdout;
}

const FPS = 30;
const SECONDS = 10;
const CHANGE = 3;       // w 3. sekundzie probki obraz zmienia sie z czarnego na bialy

// probka 10 s w H.264: obraz czarny do 3 s, potem bialy; klatka kluczowa co sekunde.
// kind: "zwykly" - mp4 prosto z ffmpeg (indeks moov na koncu pliku), "fragmenty" - mp4 w kawalkach (moof), jak strumienie DASH,
// "z-dzwiekiem" - zwykly mp4 ze sciezka aac (yt-dlp potrafi dla "bv*" wybrac format, ktory ma tez dzwiek)
function makeSample(filePath, kind) {
    const args = [
        "-f", "lavfi", "-i", `color=c=black:s=160x120:r=${FPS}:d=${CHANGE}`,
        "-f", "lavfi", "-i", `color=c=white:s=160x120:r=${FPS}:d=${SECONDS - CHANGE}`
    ];

    if (kind === "z-dzwiekiem") {
        args.push(
            "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=${SECONDS}`,
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]", "-map", "2:a", "-c:a", "aac", "-b:a", "128k"
        );
    } else {
        args.push("-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]");
    }

    args.push("-c:v", "libx264", "-preset", "ultrafast", "-g", String(FPS), "-pix_fmt", "yuv420p");

    if (kind === "fragmenty") {
        args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof");
    }

    args.push(filePath);
    runFfmpeg(args);
}

// nazwy kolejnych "pudelek" najwyzszego poziomu w pliku mp4 (ftyp, moov, mdat, moof...)
function topLevelAtoms(filePath) {
    const data = fs.readFileSync(filePath);
    const atoms = [];
    let position = 0;

    while (position + 8 <= data.length) {
        let size = data.readUInt32BE(position);
        const type = data.toString("latin1", position + 4, position + 8);

        if (size === 1) {
            size = Number(data.readBigUInt64BE(position + 8));
        } else if (size === 0) {
            size = data.length - position;
        }

        assert.ok(size >= 8, `zly rozmiar pudelka ${type} w ${filePath}`);
        atoms.push(type);
        position += size;
    }

    return atoms;
}

// suma kontrolna wszystkich pakietow obrazu, bez dekodowania. Kopiowanie strumienia jej nie zmienia, kazde kodowanie od nowa - tak
function videoPacketsMd5(filePath) {
    return runFfmpeg(["-i", filePath, "-map", "0:v:0", "-c", "copy", "-f", "md5", "-"]).toString("utf8").trim();
}

// jasnosc kazdej klatki (1 bajt na klatke) -> { frames, firstWhite }
function measureVideo(filePath) {
    const raw = runFfmpeg(["-i", filePath, "-an", "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "-"]);

    return { frames: raw.length, firstWhite: raw.findIndex(value => value > 128) };
}

function probe(filePath) {
    const result = childProcess.spawnSync("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_name,codec_type,width,height,pix_fmt:format=duration,format_name", "-of", "json", filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return JSON.parse(result.stdout);
}

// sprawdzenie 2 z zadania: pelne dekodowanie nie wypisuje zadnego bledu
function decodeErrors(filePath) {
    const result = childProcess.spawnSync(ffmpeg, ["-nostdin", "-v", "error", "-i", filePath, "-f", "null", "-"], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stderr.trim();
}

async function runReal(t, dir, overrides) {
    reset();
    spawnState.real = true;
    t.after(() => { spawnState.real = false; });

    return processDownloadedFile({ bitrate: "best", experimental: options(), trimStartSeconds: null, trimEndSeconds: null, dir, ...overrides });
}

// wspolne sprawdzenie wyniku przepakowania
function assertRemuxed(resultPath, sourceMd5, label) {
    const info = probe(resultPath);

    // 1) poprawny strumien H.264 i dlugosc, bez dzwieku
    assert.equal(info.streams.length, 1, `${label}: w pliku ma byc sam obraz`);
    assert.equal(info.streams[0].codec_type, "video", label);
    assert.equal(info.streams[0].codec_name, "h264", label);
    assert.equal(info.streams[0].width, 160, label);
    assert.equal(info.streams[0].height, 120, label);
    assert.equal(info.streams[0].pix_fmt, "yuv420p", label);
    assert.ok(Math.abs(Number(info.format.duration) - SECONDS) <= 0.05, `${label}: dlugosc ${info.format.duration}`);
    assert.ok(info.format.format_name.includes("mp4"), label);

    // 2) pelne dekodowanie bez bledow; wszystkie klatki sa i zmiana obrazu jest tam, gdzie byla
    assert.equal(decodeErrors(resultPath), "", label);
    assert.deepEqual(measureVideo(resultPath), { frames: SECONDS * FPS, firstWhite: CHANGE * FPS }, label);

    // obraz skopiowany, nie zakodowany od nowa
    assert.equal(videoPacketsMd5(resultPath), sourceMd5, `${label}: pakiety obrazu roznia sie od zrodla, czyli obraz byl kodowany od nowa`);

    // +faststart: indeks (moov) przed danymi (mdat), zwykly mp4 bez kawalkow
    const atoms = topLevelAtoms(resultPath);

    assert.equal(atoms[0], "ftyp", `${label}: ${atoms.join(" ")}`);
    assert.ok(atoms.includes("moov") && atoms.includes("mdat"), `${label}: ${atoms.join(" ")}`);
    assert.ok(atoms.indexOf("moov") < atoms.indexOf("mdat"), `${label}: moov ma stac przed mdat, jest ${atoms.join(" ")}`);
    assert.equal(atoms.filter(atom => atom === "mdat").length, 1, `${label}: ${atoms.join(" ")}`);
    assert.equal(atoms.includes("moof"), false, `${label}: ${atoms.join(" ")}`);
}

test("B12: prawdziwy ffmpeg - kontrola probek i miar: zwykly mp4 ma moov za mdat, mp4 w kawalkach ma moof, stare kodowanie zmienia sume pakietow", { skip }, (t) => {
    const dir = makeDir(t);
    const plain = path.join(dir, "zwykly.mp4");
    const fragmented = path.join(dir, "fragmenty.mp4");
    const encoded = path.join(dir, "zakodowany.mp4");

    makeSample(plain, "zwykly");
    makeSample(fragmented, "fragmenty");

    const plainAtoms = topLevelAtoms(plain);

    assert.ok(plainAtoms.indexOf("mdat") < plainAtoms.indexOf("moov"), plainAtoms.join(" "));
    assert.ok(topLevelAtoms(fragmented).includes("moof"));
    assert.deepEqual(measureVideo(plain), { frames: SECONDS * FPS, firstWhite: CHANGE * FPS });

    // kodowanie sprzed B12 daje inne pakiety, wiec suma pakietow odroznia kopiowanie od kodowania
    runFfmpeg(["-i", plain, ...OLD_ENCODING, encoded]);

    assert.notEqual(videoPacketsMd5(encoded), videoPacketsMd5(plain));
    assert.equal(videoPacketsMd5(plain), videoPacketsMd5(plain));
});

test("B12: prawdziwy ffmpeg - wideo osobno mp4: obraz skopiowany bit w bit, H.264, 10 s, moov przed mdat, dekodowanie bez bledow", { skip }, async (t) => {
    for (const kind of ["zwykly", "fragmenty"]) {
        const dir = makeDir(t);
        const name = "probka #1 video [abcd1234].mp4";
        const filePath = path.join(dir, name);

        makeSample(filePath, kind);

        const sourceMd5 = videoPacketsMd5(filePath);
        const finalFile = await runReal(t, dir, { generatedFile: name, mediaType: "videoOnly", format: "mp4" });

        assert.equal(finalFile, name);
        assert.deepEqual(fs.readdirSync(dir), [name], `${kind}: w folderze zostaje jeden plik, bez tmp-`);
        assertRemuxed(filePath, sourceMd5, kind);
    }
});

test("B12: prawdziwy ffmpeg - zrodlo z dzwiekiem: plik wideo trybu osobno wychodzi bez dzwieku, obraz dalej skopiowany", { skip }, async (t) => {
    const dir = makeDir(t);
    const name = "probka video [abcd1234].mp4";
    const filePath = path.join(dir, name);

    makeSample(filePath, "z-dzwiekiem");

    assert.deepEqual(probe(filePath).streams.map(stream => stream.codec_name).sort(), ["aac", "h264"]);

    const sourceMd5 = videoPacketsMd5(filePath);

    await runReal(t, dir, { generatedFile: name, mediaType: "videoOnly", format: "mp4", experimental: options({ normalize: true, channels: "mono" }) });

    assertRemuxed(filePath, sourceMd5, "z dzwiekiem");
});

test("B12: prawdziwy ffmpeg - zrodlo mkv z H.264 (inne rozszerzenie niz mp4): wynik to mp4 z tym samym obrazem", { skip }, async (t) => {
    const dir = makeDir(t);
    const source = path.join(dir, "probka video [abcd1234].mkv");

    makeSample(source, "zwykly");

    const sourceMd5 = videoPacketsMd5(source);
    const finalFile = await runReal(t, dir, { generatedFile: "probka video [abcd1234].mkv", mediaType: "videoOnly", format: "mp4" });

    assert.equal(finalFile, "probka video [abcd1234].mp4");
    assert.deepEqual(fs.readdirSync(dir), ["probka video [abcd1234].mp4"]);
    assertRemuxed(path.join(dir, finalFile), sourceMd5, "z mkv");
});
