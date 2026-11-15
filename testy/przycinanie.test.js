// Testy zadania B11: przycinanie. Zostal wariant awaryjny z zadania: yt-dlp pobiera caly film, tnie ffmpeg
// (-ss/-to przed -i, obraz kodowany libx264 veryfast crf 20 yuv420p, dzwiek aac 192k), bo pobieranie samego wycinka
// (--download-sections) cielo audio niedokladnie (krotki opis w DOKUMENTACJA.md, sekcja o panelu EXPERIMENTAL).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp. spawn jest podmieniony na atrape; pliki robocze leza w os.tmpdir().
// Ostatnia czesc uruchamia prawdziwy ffmpeg na probce z generatora, ktora ma JEDNA klatke kluczowa (na poczatku):
// ciecie przez kopiowanie strumienia musi wtedy zabrac obraz od zera. W mkv widac to po klatkach z dekodowania.
// W mp4 ffmpeg chowa nadmiarowe klatki lista edycji (dekoder ich nie pokazuje), dlatego liczone sa tez pakiety w pliku:
// plik ciety dokladnie ma tyle pakietow obrazu, ile klatek. Gdy ffmpeg albo ffprobe nie ma, te testy sa pomijane.

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

const spawnState = { calls: [], real: false };

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
const { processDownloadedFile, buildTrimVideoArgs, shouldProcessMedia } = appModule;

function options(overrides) {
    return { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "", ...overrides };
}

function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b11-"));

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

    const finalFile = await processDownloadedFile({ bitrate: "best", experimental: options(), dir, ...overrides });

    if (spawnState.calls.length === 0) {
        return { args: null, dir, finalFile };
    }

    assert.equal(spawnState.calls.length, 1);
    assert.equal(spawnState.calls[0].command, appModule.ffmpegPath);

    return { args: spawnState.calls[0].args, dir, finalFile };
}

const trimVideo = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p"];

// -ss i -to maja stac przed -i (ciecie po stronie wejscia), kazde najwyzej raz
function assertTrimBeforeInput(args, start, end) {
    const inputIndex = args.indexOf("-i");

    assert.ok(inputIndex !== -1);
    assert.equal(args.filter(arg => arg === "-i").length, 1);

    if (start === null) {
        assert.equal(args.includes("-ss"), false, "bez startu nie ma -ss");
    } else {
        assert.equal(args.filter(arg => arg === "-ss").length, 1);
        assert.ok(args.indexOf("-ss") < inputIndex, "-ss stoi przed -i");
        assert.equal(args[args.indexOf("-ss") + 1], String(start));
    }

    if (end === null) {
        assert.equal(args.includes("-to"), false, "bez konca nie ma -to");
    } else {
        assert.equal(args.filter(arg => arg === "-to").length, 1);
        assert.ok(args.indexOf("-to") < inputIndex, "-to stoi przed -i");
        assert.equal(args[args.indexOf("-to") + 1], String(end));
    }

    assert.equal(args.includes("-t"), false, "-t (dlugosc) zamiast -to (koniec) dalby zly koniec");
}

// zaden strumien nie moze byc kopiowany - kopiowanie tnie tylko na klatkach kluczowych
function assertNoStreamCopy(args) {
    for (const option of ["-c", "-c:v", "-c:a", "-codec", "-vcodec", "-acodec"]) {
        const index = args.indexOf(option);

        if (index !== -1) {
            assert.notEqual(args[index + 1], "copy", `${option} copy przy przycinaniu`);
        }
    }
}

// ---------- buildTrimVideoArgs ----------

test("B11: buildTrimVideoArgs - libx264, preset veryfast, crf 20, yuv420p", () => {
    assert.deepEqual(buildTrimVideoArgs(), trimVideo);
});

// ---------- film z dzwiekiem ----------

test("B11: film mp4 i mkv przyciety 5-12 bez efektow - dokladne argumenty: -ss/-to przed -i, obraz libx264 crf 20, dzwiek aac 192k", async (t) => {
    for (const format of ["mp4", "mkv"]) {
        const name = `tytul [abcd1234].${format}`;
        const { args, dir, finalFile } = await ffmpegArgsFor(t, { generatedFile: name, trimStartSeconds: 5, trimEndSeconds: 12, mediaType: "video", format });

        assert.deepEqual(args, [
            "-y", "-nostdin",
            "-ss", "5", "-to", "12",
            "-i", path.join(dir, name),
            ...trimVideo,
            "-c:a", "aac", "-b:a", "192k",
            path.join(dir, `tmp-${name}`)
        ], format);
        assert.equal(finalFile, name);
        assert.deepEqual(fs.readdirSync(dir), [name]);
    }
});

test("B11: film mp4 - sam start bez konca: tylko -ss; sam koniec bez startu: tylko -to; start 0 tez jest przycieciem", async (t) => {
    const name = "tytul [abcd1234].mp4";

    for (const [start, end] of [[25, null], [null, 8], [0, 8], [0, null], [3723, 3725]]) {
        const { args } = await ffmpegArgsFor(t, { generatedFile: name, trimStartSeconds: start, trimEndSeconds: end, mediaType: "video", format: "mp4" });

        assert.ok(args, `ffmpeg ma ruszyc dla ${start}-${end}`);
        assertTrimBeforeInput(args, start, end);
        assertNoStreamCopy(args);

        const inputIndex = args.indexOf("-i");

        assert.deepEqual(args.slice(inputIndex + 2, -1), [...trimVideo, "-c:a", "aac", "-b:a", "192k"], `${start}-${end}`);
    }
});

test("B11: film mp4 przyciety + efekty audio - filtry zostaja, obraz dalej kodowany (nie kopiowany)", async (t) => {
    const name = "tytul [abcd1234].mp4";
    const { args, dir } = await ffmpegArgsFor(t, {
        generatedFile: name, trimStartSeconds: 5, trimEndSeconds: 12, mediaType: "video", format: "mp4",
        experimental: options({ normalize: true, channels: "mono" })
    });

    assert.deepEqual(args, [
        "-y", "-nostdin",
        "-ss", "5", "-to", "12",
        "-i", path.join(dir, name),
        "-af", "loudnorm,aresample=48000",
        "-ac", "1",
        ...trimVideo,
        "-c:a", "aac", "-b:a", "192k",
        path.join(dir, `tmp-${name}`)
    ]);
});

test("B11: film mpeg i mjpeg przyciety - kodeki formatu bez zmian (i tak koduja od nowa), -ss/-to przed -i", async (t) => {
    const expected = {
        mpeg: ["-c:v", "mpeg2video", "-q:v", "5", "-c:a", "mp2", "-b:a", "192k", "-f", "mpeg"],
        mjpeg: ["-c:v", "mjpeg", "-q:v", "5", "-c:a", "libmp3lame", "-b:a", "192k", "-f", "avi"]
    };

    for (const format of ["mpeg", "mjpeg"]) {
        const { args } = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp4", trimStartSeconds: 5, trimEndSeconds: 12, mediaType: "video", format });

        assertTrimBeforeInput(args, 5, 12);
        assertNoStreamCopy(args);
        assert.deepEqual(args.slice(args.indexOf("-i") + 2, -1), expected[format], format);
    }
});

// ---------- tryb osobno, wideo ----------

test("B11: wideo trybu osobno (mp4, mkv) przyciete - obraz libx264 crf 20 bez dzwieku, nic nie jest kopiowane", async (t) => {
    for (const [format, source] of [["mp4", "tytul video [abcd1234].mp4"], ["mkv", "tytul video [abcd1234].webm"], ["mkv", "tytul video [abcd1234].mkv"]]) {
        const { args, dir } = await ffmpegArgsFor(t, { generatedFile: source, trimStartSeconds: 5, trimEndSeconds: 12, mediaType: "videoOnly", format });

        assert.deepEqual(args, [
            "-y", "-nostdin",
            "-ss", "5", "-to", "12",
            "-i", path.join(dir, source),
            ...trimVideo,
            "-an",
            path.join(dir, `tmp-tytul video [abcd1234].${format}`)
        ], `${format} z ${source}`);
    }
});

test("B11: wideo trybu osobno (mp4, mkv) - sam start, sam koniec, start 0: tez kodowanie, nic nie jest kopiowane", async (t) => {
    for (const [format, source] of [["mp4", "tytul video [abcd1234].mp4"], ["mkv", "tytul video [abcd1234].webm"], ["mkv", "tytul video [abcd1234].mkv"]]) {
        for (const [start, end] of [[25, null], [null, 8], [0, null], [0, 8]]) {
            const { args } = await ffmpegArgsFor(t, { generatedFile: source, trimStartSeconds: start, trimEndSeconds: end, mediaType: "videoOnly", format });

            assert.ok(args, `ffmpeg ma ruszyc: ${format} z ${source}, ${start}-${end}`);
            assertTrimBeforeInput(args, start, end);
            assertNoStreamCopy(args);
            assert.deepEqual(args.slice(args.indexOf("-i") + 2, -1), [...trimVideo, "-an"], `${format} z ${source}, ${start}-${end}`);
        }
    }
});

test("B11: wideo trybu osobno mpeg i mjpeg przyciete - kodeki formatu, bez dzwieku, -ss/-to przed -i", async (t) => {
    const expected = {
        mpeg: ["-c:v", "mpeg2video", "-q:v", "5", "-an", "-f", "mpeg"],
        mjpeg: ["-c:v", "mjpeg", "-q:v", "5", "-an", "-f", "avi"]
    };

    for (const format of ["mpeg", "mjpeg"]) {
        const { args } = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mp4", trimStartSeconds: null, trimEndSeconds: 12, mediaType: "videoOnly", format });

        assertTrimBeforeInput(args, null, 12);
        assert.deepEqual(args.slice(args.indexOf("-i") + 2, -1), expected[format], format);
    }
});

// ---------- audio ----------

test("B11: audio przyciete bez efektow - ffmpeg rusza, -ss/-to przed -i, jakosc ustawiona jawnie, bez kopiowania", async (t) => {
    const quality = { mp3: ["-q:a", "0"], m4a: ["-b:a", "256k"], wav: [], flac: [] };

    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        const name = `tytul [abcd1234].${format}`;
        const { args, dir, finalFile } = await ffmpegArgsFor(t, { generatedFile: name, trimStartSeconds: 5, trimEndSeconds: 12, mediaType: "audio", format });

        assert.deepEqual(args, [
            "-y", "-nostdin",
            "-ss", "5", "-to", "12",
            "-i", path.join(dir, name),
            ...quality[format],
            path.join(dir, `tmp-${name}`)
        ], format);
        assert.equal(finalFile, name);
    }
});

test("B11: audio - sam start i sam koniec", async (t) => {
    for (const [start, end] of [[25, null], [null, 8], [0, null]]) {
        const { args } = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp3", trimStartSeconds: start, trimEndSeconds: end, mediaType: "audio", format: "mp3", bitrate: "128" });

        assert.ok(args, `ffmpeg ma ruszyc dla ${start}-${end}`);
        assertTrimBeforeInput(args, start, end);
        assert.deepEqual(args.slice(args.indexOf("-i") + 2, -1), ["-b:a", "128K"]);
    }
});

// ---------- bez przycinania nic sie nie zmienia ----------

test("B11: bez przycinania - nie ma -ss/-to, film dalej jest kopiowany, wideo osobno mp4 jak dotad, bez efektow ffmpeg nie rusza", async (t) => {
    const noTrim = { trimStartSeconds: null, trimEndSeconds: null };

    // film webm -> mp4 bez efektow: samo przepakowanie
    let result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].webm", ...noTrim, mediaType: "video", format: "mp4" });

    assert.deepEqual(result.args.slice(2, -1), ["-i", path.join(result.dir, "tytul [abcd1234].webm"), "-c", "copy"]);

    // film mp4 + mono: obraz kopiowany
    result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp4", ...noTrim, mediaType: "video", format: "mp4", experimental: options({ channels: "mono" }) });

    assert.deepEqual(result.args.slice(4, -1), ["-ac", "1", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k"]);
    assert.equal(result.args.includes("-ss") || result.args.includes("-to"), false);

    // wideo osobno mkv z webm: kopiowanie. UL-8c dodalo -an (plik wideo trybu osobno nie moze miec dzwieku)
    result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].webm", ...noTrim, mediaType: "videoOnly", format: "mkv" });

    assert.deepEqual(result.args.slice(4, -1), ["-c", "copy", "-an"]);

    // wideo osobno mp4: ffmpeg rusza takze bez przycinania (stan sprzed B11), bez -ss/-to i nie z ustawieniami przycinania (crf 20).
    // od zadania B12 to przepakowanie zamiast kodowania crf 23 (szczegolowe testy: przepakowanie-osobno.test.js)
    result = await ffmpegArgsFor(t, { generatedFile: "tytul video [abcd1234].mp4", ...noTrim, mediaType: "videoOnly", format: "mp4" });

    assert.ok(result.args);
    assert.equal(result.args.includes("-ss") || result.args.includes("-to"), false);
    assert.deepEqual(result.args.slice(4, -1), ["-c", "copy", "-an", "-movflags", "+faststart"]);

    // film mp4 i audio mp3 bez efektow: ffmpeg nie rusza
    result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp4", ...noTrim, mediaType: "video", format: "mp4" });
    assert.equal(result.args, null);
    assert.equal(fs.readFileSync(path.join(result.dir, "tytul [abcd1234].mp4"), "utf8"), "ORYGINAL");

    result = await ffmpegArgsFor(t, { generatedFile: "tytul [abcd1234].mp3", ...noTrim, mediaType: "audio", format: "mp3" });
    assert.equal(result.args, null);
});

test("B11: shouldProcessMedia - samo przyciecie (start, koniec albo oba, takze start 0) wymaga ffmpeg w kazdym trybie", () => {
    for (const [start, end] of [[5, 12], [5, null], [null, 12], [0, null]]) {
        assert.equal(shouldProcessMedia(options(), start, end, "audio", "mp3", "tytul [abcd1234].mp3"), true, `audio ${start}-${end}`);
        assert.equal(shouldProcessMedia(options(), start, end, "video", "mp4", "tytul [abcd1234].mp4"), true, `film ${start}-${end}`);
        assert.equal(shouldProcessMedia(options(), start, end, "videoOnly", "mkv", "tytul video [abcd1234].mkv"), true, `osobno ${start}-${end}`);
    }

    assert.equal(shouldProcessMedia(options(), null, null, "audio", "mp3", "tytul [abcd1234].mp3"), false);
    assert.equal(shouldProcessMedia(options(), null, null, "video", "mp4", "tytul [abcd1234].mp4"), false);
    assert.equal(shouldProcessMedia(options(), null, null, "videoOnly", "mkv", "tytul video [abcd1234].mkv"), false);
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

function split() {
    return {
        ytDlp: spawnState.calls.filter(call => call.command === appModule.ytDlpPath),
        ffmpeg: spawnState.calls.filter(call => call.command === appModule.ffmpegPath)
    };
}

// yt-dlp pobiera caly film: zadnej opcji wycinka
function assertYtDlpDownloadsWholeFile(calls) {
    for (const call of calls) {
        for (const option of ["--download-sections", "--force-keyframes-at-cuts", "-ss", "-to"]) {
            assert.equal(call.args.includes(option), false, `yt-dlp dostal ${option}`);
        }

        assert.equal(call.args.some(arg => String(arg).startsWith("*")), false);
        assert.equal(call.args[call.args.length - 1], testUrl);
    }
}

test("B11: POST /api/download film mp4 z przycieciem 0:05-0:12 - yt-dlp pobiera calosc, ffmpeg tnie 5-12 z kodowaniem", async (t) => {
    reset();
    spawnState.writeOutput = false;
    fakeDownloads(t, () => "mp4");

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "video", bitrate: "best", resolution: "720", format: "mp4",
        experimental: options({ trimStart: "0:05", trimEnd: "0:12" })
    });

    assert.equal(status, 200, JSON.stringify(json));

    const { ytDlp, ffmpeg } = split();

    assert.equal(ytDlp.length, 1);
    assertYtDlpDownloadsWholeFile(ytDlp);
    assert.equal(ffmpeg.length, 1);
    assertTrimBeforeInput(ffmpeg[0].args, 5, 12);
    assert.deepEqual(ffmpeg[0].args.slice(ffmpeg[0].args.indexOf("-i") + 2, -1), [...trimVideo, "-c:a", "aac", "-b:a", "192k"]);
});

test("B11: POST /api/download audio mp3 z samym koncem i z samym startem - czasy z formularza trafiaja do ffmpeg", async (t) => {
    for (const [trimStart, trimEnd, start, end] of [["", "8", null, 8], ["25", "", 25, null], ["1:02:03", "", 3723, null]]) {
        reset();
        spawnState.writeOutput = false;
        fakeDownloads(t, () => "mp3");

        const { status, json } = await postDownload(t, {
            url: testUrl, type: "audio", bitrate: "best", resolution: "best", format: "mp3",
            experimental: options({ trimStart, trimEnd })
        });

        assert.equal(status, 200, JSON.stringify(json));

        const { ytDlp, ffmpeg } = split();

        assertYtDlpDownloadsWholeFile(ytDlp);
        assert.equal(ffmpeg.length, 1);
        assertTrimBeforeInput(ffmpeg[0].args, start, end);

        t.mock.restoreAll();
    }
});

test("B11: POST /api/download tryb osobno mp4 z przycieciem - oba pliki (wideo i audio) sa ciete tymi samymi czasami", async (t) => {
    reset();
    spawnState.writeOutput = false;
    fakeDownloads(t, (args) => (args.includes("-x") ? "mp3" : "mp4"));

    const { status, json } = await postDownload(t, {
        url: testUrl, type: "separate", bitrate: "best", resolution: "720", format: "mp4",
        experimental: options({ trimStart: "5", trimEnd: "12" })
    });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.files.length, 2);       // UL-2b: zamiast adresow odpowiedz niesie liste plikow

    const { ytDlp, ffmpeg } = split();

    assert.equal(ytDlp.length, 2);
    assertYtDlpDownloadsWholeFile(ytDlp);
    assert.equal(ffmpeg.length, 2);

    const [videoArgs, audioArgs] = ffmpeg.map(call => call.args);

    assertTrimBeforeInput(videoArgs, 5, 12);
    assert.ok(path.basename(videoArgs[videoArgs.indexOf("-i") + 1]).includes(" video ["));
    assert.deepEqual(videoArgs.slice(videoArgs.indexOf("-i") + 2, -1), [...trimVideo, "-an"]);

    assertTrimBeforeInput(audioArgs, 5, 12);
    assert.ok(path.basename(audioArgs[audioArgs.indexOf("-i") + 1]).includes(" audio ["));
    assert.deepEqual(audioArgs.slice(audioArgs.indexOf("-i") + 2, -1), ["-q:a", "0"]);
});

test("B11: POST /api/download bez przyciecia i bez efektow - ffmpeg nie rusza dla filmu mp4", async (t) => {
    reset();
    spawnState.writeOutput = false;
    fakeDownloads(t, () => "mp4");

    const { status } = await postDownload(t, {
        url: testUrl, type: "video", bitrate: "best", resolution: "720", format: "mp4", experimental: options()
    });

    assert.equal(status, 200);
    assert.equal(split().ffmpeg.length, 0);
    assertYtDlpDownloadsWholeFile(split().ytDlp);
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
const CHANGE = 3;       // w 3. sekundzie probki obraz zmienia sie z czarnego na bialy i zaczyna sie ton

// probka 10 s: obraz czarny do 3 s, potem bialy; dzwiek: cisza do 3 s, potem ton 1 kHz.
// -g 600 i -sc_threshold 0: jedyna klatka kluczowa jest na poczatku, wiec kopiowanie strumienia nie umie zaczac od 2 s
function makeVideoSample(filePath, withAudio) {
    const args = [
        "-f", "lavfi", "-i", `color=c=black:s=160x120:r=${FPS}:d=${CHANGE}`,
        "-f", "lavfi", "-i", `color=c=white:s=160x120:r=${FPS}:d=${10 - CHANGE}`
    ];

    if (withAudio) {
        args.push(
            "-f", "lavfi", "-i", `anullsrc=r=48000:cl=stereo:d=${CHANGE}`,
            "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=${10 - CHANGE}`,
            "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v];[3:a]aformat=channel_layouts=stereo[t];[2:a][t]concat=n=2:v=0:a=1[a]",
            "-map", "[v]", "-map", "[a]", "-c:a", "aac", "-b:a", "128k"
        );
    } else {
        args.push("-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]");
    }

    args.push("-c:v", "libx264", "-preset", "ultrafast", "-g", "600", "-keyint_min", "600", "-sc_threshold", "0", "-pix_fmt", "yuv420p", filePath);
    runFfmpeg(args);
}

// probka audio 10 s w mp3: cisza do 3 s, potem ton
function makeAudioSample(filePath) {
    runFfmpeg([
        "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${CHANGE}`,
        "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=44100:duration=${10 - CHANGE}`,
        "-filter_complex", "[1:a]aformat=channel_layouts=stereo[t];[0:a][t]concat=n=2:v=0:a=1[a]",
        "-map", "[a]", "-c:a", "libmp3lame", "-b:a", "128k", filePath
    ]);
}

// jasnosc kazdej klatki (1 bajt na klatke) -> { frames, firstWhite }
function measureVideo(filePath) {
    const raw = runFfmpeg(["-i", filePath, "-an", "-vf", "scale=1:1", "-pix_fmt", "gray", "-f", "rawvideo", "-"]);

    return { frames: raw.length, firstWhite: raw.findIndex(value => value > 128) };
}

// dzwiek jako probki mono 8 kHz -> { seconds, toneStart } (toneStart w sekundach)
function measureAudio(filePath) {
    const raw = runFfmpeg(["-i", filePath, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
    const samples = raw.length / 2;
    let first = -1;

    for (let index = 0; index < samples; index++) {
        if (Math.abs(raw.readInt16LE(index * 2)) > 2000) {
            first = index;
            break;
        }
    }

    return { seconds: samples / 8000, toneStart: first / 8000 };
}

// liczba pakietow obrazu zapisanych w pliku (bez dekodowania, wiec lista edycji mp4 niczego nie ukrywa)
function videoPackets(filePath) {
    const result = childProcess.spawnSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0", "-count_packets", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return Number(result.stdout.trim().split(/\r?\n/)[0].replace(/,+$/, ""));
}

// plik ciety dokladnie nie ma w srodku klatek sprzed poczatku wycinka: pakietow obrazu jest tyle, ile klatek
function assertNoHiddenFrames(filePath, frames, label) {
    near(videoPackets(filePath), frames, 1, `${label}: liczba pakietow obrazu w pliku (kopiowanie strumienia zostawia klatki sprzed wycinka)`);
}

function keyframeCount(filePath) {
    const result = childProcess.spawnSync("ffprobe", [
        "-v", "error", "-select_streams", "v:0", "-skip_frame", "nokey", "-show_entries", "frame=pts_time", "-of", "csv=p=0", filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim().split(/\r?\n/).filter(line => line.trim() !== "").length;
}

function codecs(filePath) {
    const result = childProcess.spawnSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", filePath], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return result.stdout.trim().split(/\r?\n/).map(line => line.trim().replace(/,+$/, "")).filter(line => line !== "");
}

async function runReal(t, dir, overrides) {
    reset();
    spawnState.real = true;
    t.after(() => { spawnState.real = false; });

    return processDownloadedFile({ bitrate: "best", experimental: options(), dir, ...overrides });
}

function near(actual, expected, tolerance, label) {
    assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual}, oczekiwane ${expected} +/- ${tolerance}`);
}

test("B11: prawdziwy ffmpeg - probka ma jedna klatke kluczowa i zmiane obrazu/dzwieku w 3. sekundzie (kontrola samej probki)", { skip }, (t) => {
    const dir = makeDir(t);
    const file = path.join(dir, "probka.mp4");

    makeVideoSample(file, true);

    assert.equal(keyframeCount(file), 1);

    const video = measureVideo(file);
    const audio = measureAudio(file);

    assert.equal(video.frames, 10 * FPS);
    assert.equal(video.firstWhite, CHANGE * FPS);
    near(audio.toneStart, CHANGE, 0.03, "start tonu w probce");
});

test("B11: prawdziwy ffmpeg - film mp4 i mkv 2-6 s: dlugosc 4 s, obraz zaczyna sie w zadanej klatce, obraz i dzwiek zsynchronizowane", { skip }, async (t) => {
    for (const format of ["mp4", "mkv"]) {
        const dir = makeDir(t);
        const name = `probka [abcd1234].${format}`;

        makeVideoSample(path.join(dir, name), true);

        const finalFile = await runReal(t, dir, { generatedFile: name, trimStartSeconds: 2, trimEndSeconds: 6, mediaType: "video", format });

        assert.equal(finalFile, name);
        assert.deepEqual(fs.readdirSync(dir), [name]);

        const video = measureVideo(path.join(dir, name));
        const audio = measureAudio(path.join(dir, name));

        assert.deepEqual(codecs(path.join(dir, name)), ["h264", "aac"], format);

        // 4 s = 120 klatek; zmiana na bialy byla w 3 s probki, czyli ma wypasc 1 s po poczatku wycinka (klatka 30)
        near(video.frames, 4 * FPS, 1, `${format}: liczba klatek`);
        assertNoHiddenFrames(path.join(dir, name), 4 * FPS, format);
        near(video.firstWhite, 1 * FPS, 1, `${format}: klatka, od ktorej obraz jest bialy`);
        near(audio.seconds, 4, 0.1, `${format}: dlugosc dzwieku`);
        near(audio.toneStart, 1, 0.05, `${format}: start tonu`);
        // synchronizacja: ton zaczyna sie w tej samej chwili, w ktorej obraz robi sie bialy
        near(audio.toneStart, video.firstWhite / FPS, 0.07, `${format}: rozjazd obrazu i dzwieku`);
    }
});

test("B11: prawdziwy ffmpeg - film mp4: sam start (2 s do konca) i sam koniec (od poczatku do 6 s)", { skip }, async (t) => {
    for (const [start, end, frames, firstWhite] of [[2, null, 8 * FPS, 1 * FPS], [null, 6, 6 * FPS, 3 * FPS]]) {
        const dir = makeDir(t);
        const name = "probka [abcd1234].mp4";

        makeVideoSample(path.join(dir, name), true);

        await runReal(t, dir, { generatedFile: name, trimStartSeconds: start, trimEndSeconds: end, mediaType: "video", format: "mp4" });

        const video = measureVideo(path.join(dir, name));
        const audio = measureAudio(path.join(dir, name));

        near(video.frames, frames, 1, `${start}-${end}: liczba klatek`);
        assertNoHiddenFrames(path.join(dir, name), frames, `${start}-${end}`);
        near(video.firstWhite, firstWhite, 1, `${start}-${end}: pierwsza biala klatka`);
        near(audio.seconds, frames / FPS, 0.1, `${start}-${end}: dlugosc dzwieku`);
        near(audio.toneStart, firstWhite / FPS, 0.05, `${start}-${end}: start tonu`);
    }
});

test("B11: prawdziwy ffmpeg - film mp4 2-6 s + normalizacja + mono: dalej 4 s i obraz od zadanej klatki", { skip }, async (t) => {
    const dir = makeDir(t);
    const name = "probka [abcd1234].mp4";

    makeVideoSample(path.join(dir, name), true);

    await runReal(t, dir, {
        generatedFile: name, trimStartSeconds: 2, trimEndSeconds: 6, mediaType: "video", format: "mp4",
        experimental: options({ normalize: true, channels: "mono" })
    });

    const video = measureVideo(path.join(dir, name));

    near(video.frames, 4 * FPS, 1, "liczba klatek");
    assertNoHiddenFrames(path.join(dir, name), 4 * FPS, "mp4 + efekty");
    near(video.firstWhite, 1 * FPS, 1, "pierwsza biala klatka");
    near(measureAudio(path.join(dir, name)).seconds, 4, 0.1, "dlugosc dzwieku");
});

test("B11: prawdziwy ffmpeg - wideo trybu osobno (mp4, mkv) 2-6 s: 4 s, obraz od zadanej klatki, bez dzwieku", { skip }, async (t) => {
    for (const format of ["mp4", "mkv"]) {
        const dir = makeDir(t);
        const name = `probka video [abcd1234].${format}`;

        makeVideoSample(path.join(dir, name), false);

        const finalFile = await runReal(t, dir, { generatedFile: name, trimStartSeconds: 2, trimEndSeconds: 6, mediaType: "videoOnly", format });

        assert.equal(finalFile, name);

        const video = measureVideo(path.join(dir, name));

        assert.deepEqual(codecs(path.join(dir, name)), ["h264"], format);
        near(video.frames, 4 * FPS, 1, `${format}: liczba klatek`);
        assertNoHiddenFrames(path.join(dir, name), 4 * FPS, format);
        near(video.firstWhite, 1 * FPS, 1, `${format}: pierwsza biala klatka`);
    }
});

test("B11: prawdziwy ffmpeg - wideo trybu osobno (mp4, mkv): sam start (2 s do konca) i sam koniec (do 6 s)", { skip }, async (t) => {
    for (const format of ["mp4", "mkv"]) {
        for (const [start, end, frames, firstWhite] of [[2, null, 8 * FPS, 1 * FPS], [null, 6, 6 * FPS, 3 * FPS]]) {
            const dir = makeDir(t);
            const name = `probka video [abcd1234].${format}`;

            makeVideoSample(path.join(dir, name), false);

            await runReal(t, dir, { generatedFile: name, trimStartSeconds: start, trimEndSeconds: end, mediaType: "videoOnly", format });

            const video = measureVideo(path.join(dir, name));

            near(video.frames, frames, 1, `${format} ${start}-${end}: liczba klatek`);
            assertNoHiddenFrames(path.join(dir, name), frames, `${format} ${start}-${end}`);
            near(video.firstWhite, firstWhite, 1, `${format} ${start}-${end}: pierwsza biala klatka`);
        }
    }
});

test("B11: prawdziwy ffmpeg - film mpeg 2-6 s: 4 s, obraz i dzwiek od zadanego miejsca", { skip }, async (t) => {
    const dir = makeDir(t);

    makeVideoSample(path.join(dir, "probka [abcd1234].mp4"), true);

    const finalFile = await runReal(t, dir, { generatedFile: "probka [abcd1234].mp4", trimStartSeconds: 2, trimEndSeconds: 6, mediaType: "video", format: "mpeg" });

    assert.equal(finalFile, "probka [abcd1234].mpeg");

    const video = measureVideo(path.join(dir, finalFile));
    const audio = measureAudio(path.join(dir, finalFile));

    near(video.frames, 4 * FPS, 2, "liczba klatek");
    near(video.firstWhite, 1 * FPS, 1, "pierwsza biala klatka");
    near(audio.toneStart, 1, 0.08, "start tonu");
});

test("B11: prawdziwy ffmpeg - audio (mp3, m4a, wav, flac) 2-6 s: 4 s i ton zaczyna sie 1 s po poczatku wycinka", { skip }, async (t) => {
    for (const format of ["mp3", "m4a", "wav", "flac"]) {
        const dir = makeDir(t);
        const name = `probka [abcd1234].${format}`;

        // yt-dlp oddaje plik juz w wybranym formacie, wiec probka tez jest w tym formacie
        makeAudioSample(path.join(dir, "zrodlo.mp3"));
        runFfmpeg(["-i", path.join(dir, "zrodlo.mp3"), path.join(dir, name)]);
        fs.unlinkSync(path.join(dir, "zrodlo.mp3"));

        const finalFile = await runReal(t, dir, { generatedFile: name, trimStartSeconds: 2, trimEndSeconds: 6, mediaType: "audio", format });

        assert.equal(finalFile, name);
        assert.deepEqual(fs.readdirSync(dir), [name]);

        const audio = measureAudio(path.join(dir, name));

        near(audio.seconds, 4, 0.1, `${format}: dlugosc`);
        near(audio.toneStart, 1, 0.06, `${format}: start tonu`);
    }
});

test("B11: prawdziwy ffmpeg - audio mp3: sam start (2 s do konca) i sam koniec (do 6 s)", { skip }, async (t) => {
    for (const [start, end, seconds, toneStart] of [[2, null, 8, 1], [null, 6, 6, 3]]) {
        const dir = makeDir(t);
        const name = "probka [abcd1234].mp3";

        makeAudioSample(path.join(dir, name));

        await runReal(t, dir, { generatedFile: name, trimStartSeconds: start, trimEndSeconds: end, mediaType: "audio", format: "mp3" });

        const audio = measureAudio(path.join(dir, name));

        near(audio.seconds, seconds, 0.1, `${start}-${end}: dlugosc`);
        near(audio.toneStart, toneStart, 0.06, `${start}-${end}: start tonu`);
    }
});
