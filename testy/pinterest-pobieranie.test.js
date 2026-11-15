// Testy zadania UL-8c: poprawki pobierania z Pinteresta.
// 1) pin bez filmu -> "Ten pin nie zawiera filmu.", 2) wybor formatu w trybie "osobno" dla pinow,
// 3) plik wideo trybu "osobno" zawsze bez dzwieku (-an takze dla mkv), 4) film bez dzwieku -> "Ten film nie ma dźwięku.".
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp: spawn jest podmieniony na atrape. Linie bledow yt-dlp sa
// przepisane z rozpoznania UL-8a (yt-dlp 2026.10.26). Ostatnia czesc uruchamia prawdziwy ffmpeg na probce z generatora
// (pomijana, gdy ffmpeg albo ffprobe nie ma). Pliki robocze leza w os.tmpdir().

const { folderDocelowy } = require("./folder-docelowy-pomoc");
const test = require("node:test");

// UL-8d: oczekiwany wariant z limitem krotszego boku - najpierw film pionowy (szerokosc <= R, wysokosc > R),
// potem dotychczasowy limit wysokosci (film poziomy)
function shorterSide(prefix, resolution, suffix = "") {
    return `${prefix}[width<=${resolution}][height>${resolution}]${suffix}/${prefix}[height<=${resolution}]${suffix}`;
}
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");
const originalSpawn = childProcess.spawn;

// stan atrapy spawn: scenarios - kolejne wyniki wywolan ({ stderr, code }); gdy lista sie skonczy, wywolanie konczy sie kodem 0.
// real - uruchamiaj prawdziwy program. writeOutput - atrapa ffmpeg zapisuje plik wynikowy (ostatni argument)
const spawnState = { calls: [], scenarios: [], real: false, writeOutput: false };

function loadApp() {
    childProcess.spawn = (command, args) => {
        spawnState.calls.push({ command, args });

        if (spawnState.real) {
            return originalSpawn(command, args);
        }

        const scenario = spawnState.scenarios.shift() || { code: 0 };
        const fake = new EventEmitter();

        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            if (scenario.stderr) {
                fake.stderr.emit("data", Buffer.from(scenario.stderr));
            }

            if (spawnState.writeOutput) {
                fs.writeFileSync(args[args.length - 1], "WYNIK FFMPEG");
            }

            fake.emit("close", scenario.code);
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
const {
    recognizeYtDlpError, buildProcessErrorMessage, isPinterestUrl,
    buildVideoFormat, buildVideoOnlyFormat, processDownloadedFile
} = appModule;

function reset(scenarios = []) {
    spawnState.calls.length = 0;
    spawnState.scenarios = scenarios.slice();
    spawnState.real = false;
    spawnState.writeOutput = false;
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

// ---------- linie bledow z rozpoznania UL-8a ----------

// pin D (zdjecie): cale wyjscie stderr yt-dlp
const photoPinStderr = [
    "WARNING: [Pinterest] 128282289370654878: cos mniej waznego",
    "ERROR: [Pinterest] 128282289370654878: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues?q= , filling out the appropriate issue template. Confirm you are on the latest version using  yt-dlp -U",
    ""
].join("\n");

// pin F (film bez sciezki dzwiekowej) przy -x
const noAudioStderr = [
    "WARNING: unable to obtain file audio codec with ffprobe",
    "ERROR: Postprocessing: WARNING: unable to obtain file audio codec with ffprobe",
    ""
].join("\n");

const MSG_NO_VIDEO = "Ten pin nie zawiera filmu.";
const MSG_NO_AUDIO = "Ten film nie ma dźwięku.";

const ytDlpLabels = ["YT-DLP AUDIO", "YT-DLP VIDEO", "YT-DLP VIDEO ONLY", "YT-DLP AUDIO ONLY"];

// ---------- recognizeYtDlpError ----------

test("UL-8c: napisy komunikatow sa dokladnie takie, jak w zadaniu", () => {
    assert.equal(appModule.noVideoInPinMessage, MSG_NO_VIDEO);
    assert.equal(appModule.noAudioMessage, MSG_NO_AUDIO);
});

test("UL-8c: wyjscie yt-dlp dla pina bez filmu daje 'Ten pin nie zawiera filmu.' przy kazdej etykiecie yt-dlp", () => {
    for (const label of ytDlpLabels) {
        assert.equal(recognizeYtDlpError(label, photoPinStderr), MSG_NO_VIDEO, label);
    }

    // konce linii Windows i linia po bledzie niczego nie zmieniaja
    assert.equal(recognizeYtDlpError("YT-DLP VIDEO", photoPinStderr.replace(/\n/g, "\r\n") + "WARNING: po bledzie\r\n"), MSG_NO_VIDEO);
});

test("UL-8c: 'No video formats found!' z innego serwisu niz Pinterest zostaje surowym bledem", () => {
    const stderr = "ERROR: [youtube] aaaaaaaaaaa: No video formats found!; please report this issue on  https://github.com/yt-dlp/yt-dlp/issues\n";

    assert.equal(recognizeYtDlpError("YT-DLP VIDEO", stderr), null);
    assert.equal(recognizeYtDlpError("YT-DLP VIDEO", "ERROR: [PinterestCollection] abc: Unable to download JSON metadata: HTTP Error 404: Not Found\n"), null);
});

test("UL-8c: brak sciezki dzwiekowej daje 'Ten film nie ma dźwięku.' tylko przy wyciaganiu dzwieku (AUDIO i AUDIO ONLY)", () => {
    assert.equal(recognizeYtDlpError("YT-DLP AUDIO", noAudioStderr), MSG_NO_AUDIO);
    assert.equal(recognizeYtDlpError("YT-DLP AUDIO ONLY", noAudioStderr), MSG_NO_AUDIO);

    // wywolania bez -x nie wyciagaja dzwieku: ta linia bylaby tam czyms innym, zostaje surowa
    assert.equal(recognizeYtDlpError("YT-DLP VIDEO", noAudioStderr), null);
    assert.equal(recognizeYtDlpError("YT-DLP VIDEO ONLY", noAudioStderr), null);
});

test("UL-8c: liczy sie ostatnia linia ERROR:, a samo ostrzezenie (WARNING) niczego nie rozpoznaje", () => {
    // sama linia WARNING o ffprobe bez bledu: nieznany blad
    assert.equal(recognizeYtDlpError("YT-DLP AUDIO", "WARNING: unable to obtain file audio codec with ffprobe\n"), null);

    // po rozpoznawalnej linii przyszedl inny blad: wygrywa ostatni, czyli nic nie rozpoznano
    assert.equal(recognizeYtDlpError("YT-DLP AUDIO", noAudioStderr + "ERROR: unable to download video data\n"), null);
    assert.equal(recognizeYtDlpError("YT-DLP VIDEO", photoPinStderr + "ERROR: cos innego\n"), null);

    // odwrotnie: wczesniejszy inny blad, ostatni rozpoznawalny
    assert.equal(recognizeYtDlpError("YT-DLP AUDIO", "ERROR: cos innego\n" + noAudioStderr), MSG_NO_AUDIO);
});

test("UL-8c: zwykle bledy, pusty stderr i etykiety ffmpeg nie sa rozpoznawane", () => {
    for (const stderr of ["", null, undefined, "ERROR: [youtube] aaa: Video unavailable\n", "Conversion failed!\n"]) {
        for (const label of ytDlpLabels) {
            assert.equal(recognizeYtDlpError(label, stderr), null, `${label} / ${stderr}`);
        }
    }

    assert.equal(recognizeYtDlpError("FFMPEG", photoPinStderr), null);
    assert.equal(recognizeYtDlpError("FFMPEG VIDEO ONLY", noAudioStderr), null);
    assert.equal(recognizeYtDlpError(undefined, photoPinStderr), null);
});

test("UL-8c: buildProcessErrorMessage zostaje bez zmian (surowa przyczyna dla nierozpoznanych bledow)", () => {
    assert.equal(
        buildProcessErrorMessage("YT-DLP AUDIO", "ERROR: [youtube] aaaaaaaaaaa: Video unavailable\n", 1),
        "YT-DLP AUDIO: [youtube] aaaaaaaaaaa: Video unavailable"
    );
});

// ---------- runProcess ----------

async function rejectionOf(promise) {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    assert.fail("oczekiwany blad, a wywolanie zakonczylo sie sukcesem");
}

test("UL-8c: runProcess - pin bez filmu odrzuca z gotowym komunikatem, stderr zostaje w polu error", async (t) => {
    muteConsole(t);
    reset([{ stderr: photoPinStderr, code: 1 }]);

    const error = await rejectionOf(appModule.runProcess("yt-dlp", [], "YT-DLP VIDEO"));

    assert.equal(error.message, MSG_NO_VIDEO);
    assert.equal(error.error, photoPinStderr);
    assert.equal(appModule.isYtDlpExitError(error), false, "znany blad nie jest awaria yt-dlp (bez rady o aktualizacji)");
});

test("UL-8c: runProcess - rozpoznawalna linia w stderr przy kodzie 0 dalej jest sukcesem", async (t) => {
    muteConsole(t);
    reset([{ stderr: noAudioStderr, code: 0 }]);

    await assert.doesNotReject(appModule.runProcess("yt-dlp", [], "YT-DLP AUDIO"));
});

test("UL-8c: runProcess - nierozpoznany blad yt-dlp zachowuje sie jak dotad (etykieta, kod wyjscia)", async (t) => {
    muteConsole(t);
    reset([{ stderr: "ERROR: [Pinterest] 1: Unable to download webpage\n", code: 1 }]);

    const error = await rejectionOf(appModule.runProcess("yt-dlp", [], "YT-DLP VIDEO"));

    assert.equal(error.message, "YT-DLP VIDEO: [Pinterest] 1: Unable to download webpage");
    assert.equal(error.exitCode, 1);
    assert.equal(appModule.isYtDlpExitError(error), true);
});

// ---------- POST /api/download ----------

const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const pinUrl = "https://pl.pinterest.com/pin/1028720739878379354/";
const youtubeUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

async function postDownload(t, body) {
    const server = await new Promise((resolve) => {
        const created = appModule.app.listen(0, "127.0.0.1", () => resolve(created));
    });

    t.after(() => {
        server.close();
        server.closeAllConnections();
    });

    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: folderDocelowy, ...body }),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

const bodies = {
    audio: { url: pinUrl, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects },
    video: { url: pinUrl, type: "video", format: "mp4", resolution: "best", bitrate: "best", experimental: noEffects },
    separate: { url: pinUrl, type: "separate", format: "mkv", resolution: "best", bitrate: "best", experimental: noEffects }
};

test("UL-8c: /api/download - pin bez filmu w trzech trybach: 500 i 'Ten pin nie zawiera filmu.', bez kolejnych wywolan", async (t) => {
    muteConsole(t);

    for (const [mode, body] of Object.entries(bodies)) {
        reset([{ stderr: photoPinStderr, code: 1 }]);

        const { status, json } = await postDownload(t, body);

        assert.equal(status, 500, mode);
        assert.equal(json.success, false, mode);
        assert.equal(json.message, MSG_NO_VIDEO, mode);
        assert.equal(json.error, photoPinStderr, `${mode}: surowe wyjscie yt-dlp zostaje w polu error`);
        assert.equal(spawnState.calls.length, 1, `${mode}: po bledzie nie ma kolejnych wywolan`);
    }
});

test("UL-8c: /api/download - film bez dzwieku w trybie 'Tylko audio': 500 i 'Ten film nie ma dźwięku.'", async (t) => {
    muteConsole(t);
    reset([{ stderr: noAudioStderr, code: 1 }]);

    const { status, json } = await postDownload(t, bodies.audio);

    assert.equal(status, 500);
    assert.equal(json.message, MSG_NO_AUDIO);
    assert.ok(spawnState.calls[0].args.includes("-x"));
});

test("UL-8c: /api/download - film bez dzwieku w trybie 'osobno': obraz pobrany, wywolanie dzwieku daje 'Ten film nie ma dźwięku.'", async (t) => {
    muteConsole(t);
    reset([{ code: 0 }, { stderr: noAudioStderr, code: 1 }]);

    const { status, json } = await postDownload(t, bodies.separate);

    assert.equal(status, 500);
    assert.equal(json.message, MSG_NO_AUDIO);
    assert.equal(spawnState.calls.length, 2);
    assert.equal(spawnState.calls[0].args.includes("-x"), false, "pierwsze wywolanie to obraz");
    assert.equal(spawnState.calls[1].args.includes("-x"), true, "drugie wywolanie to dzwiek");
});

test("UL-8c: /api/download - przy starym yt-dlp znane komunikaty nie dostaja rady o aktualizacji, zwykly blad dalej ja dostaje", async (t) => {
    muteConsole(t);

    assert.notEqual(appModule.setYtDlpVersion("2020.01.01", new Date(2026, 10, 15), "win32"), null);
    t.after(() => appModule.setYtDlpVersion(null));

    reset([{ stderr: photoPinStderr, code: 1 }]);
    assert.equal((await postDownload(t, bodies.video)).json.message, MSG_NO_VIDEO);

    reset([{ stderr: noAudioStderr, code: 1 }]);
    assert.equal((await postDownload(t, bodies.audio)).json.message, MSG_NO_AUDIO);

    reset([{ stderr: "ERROR: [Pinterest] 1: Unable to download webpage\n", code: 1 }]);

    const { json } = await postDownload(t, bodies.video);

    assert.ok(json.message.startsWith("YT-DLP VIDEO: [Pinterest] 1: Unable to download webpage"), json.message);
    assert.match(json.message, /zaktualizuj/);
});

// ---------- wybor formatu ----------

const pinterestLinks = [
    "https://pl.pinterest.com/pin/1028720739878379354/",
    "https://www.pinterest.com/pin/664281013778109217/",
    "https://pinterest.com/pin/1/",
    "https://www.pinterest.co.uk/pin/1/",
    "https://pinterest.com.au/pin/1/",
    "https://pin.it/5RNR5E4PX",
    "HTTPS://WWW.PINTEREST.COM/pin/1/"
];

const otherLinks = [
    youtubeUrl,
    "https://youtu.be/jBoKCUKJkiY",
    "https://pinterest.com.example.org/pin/1/",
    "https://notpinterest.com/pin/1/",
    "https://example.com/pin.it/abc",
    "https://pin.it.example.org/abc",
    "to nie jest link",
    "",
    undefined
];

test("UL-8c: isPinterestUrl - hosty Pinteresta i pin.it tak, domeny tylko podobne i inne serwisy nie", () => {
    for (const link of pinterestLinks) {
        assert.equal(isPinterestUrl(link), true, link);
    }

    for (const link of otherLinks) {
        assert.equal(isPinterestUrl(link), false, String(link));
    }
});

test("UL-8c: kazdy link, ktory sprawdzanie linku uznaje za pin, jest Pinterestem takze dla wyboru formatu", () => {
    const hosts = ["pinterest.com", "www.pinterest.com", "pl.pinterest.com", "pinterest.co.uk", "www.pinterest.de", "pinterest.com.mx", "br.pinterest.com", "pinterest.pl", "pinterest.info", "pinterest.co.kr"];

    for (const host of hosts) {
        const link = `https://${host}/pin/123/`;

        assert.equal(appModule.sprawdzLinkYoutube(link), null, `${link} ma byc przyjety jako pin`);
        assert.equal(appModule.sprawdzLinkYoutube(`https://${host}/ktos/tablica/`), "To nie jest link do pina. Wklej link do jednego pina z filmem.", host);
        assert.equal(isPinterestUrl(link), true, link);
    }
});

test("UL-8c: tryb osobno, pin, mp4/mpeg/mjpeg - najlepszy obraz bez wymogu kodeka (bierze tez V_720P), z pominieciem HEVC", () => {
    for (const link of pinterestLinks) {
        for (const format of ["mp4", "mpeg", "mjpeg"]) {
            assert.equal(buildVideoOnlyFormat("best", format, link), "bv*[format_id!*=HEVC]/bv*", `${link} ${format}`);

            for (const resolution of ["144", "360", "480", "720", "1080"]) {
                assert.equal(
                    buildVideoOnlyFormat(resolution, format, link),
                    `${shorterSide("bv*[format_id!*=HEVC]", resolution)}/${shorterSide("bv*", resolution)}`,
                    `${link} ${format} ${resolution}`
                );
            }
        }
    }
});

test("UL-8c: tryb osobno, pin - filtr nie wymaga kodeka avc1 ani kontenera, nie dociaga dzwieku i pilnuje rozdzielczosci", () => {
    for (const resolution of ["best", "480", "1080"]) {
        const selector = buildVideoOnlyFormat(resolution, "mp4", pinUrl);

        assert.equal(/vcodec|ext=/.test(selector), false, selector);
        assert.equal(selector.includes("+"), false, selector);

        for (const part of selector.split("/")) {
            assert.match(part, /^bv\*/, part);

            if (resolution !== "best") {
                // UL-8d: limit krotszego boku
                assert.ok(part.includes(`[height<=${resolution}]`) || part.includes(`[width<=${resolution}][height>${resolution}]`), part);
            }
        }
    }
});

test("UL-8c: tryb osobno, pin, mkv - bez zmian (juz bral najlepszy obraz)", () => {
    assert.equal(buildVideoOnlyFormat("best", "mkv", pinUrl), "bv*");
    assert.equal(buildVideoOnlyFormat("720", "mkv", pinUrl), shorterSide("bv*", "720"));
    assert.equal(buildVideoOnlyFormat("2160", "mkv", pinUrl), shorterSide("bv*", "2160"));
});

test("UL-8c: YouTube i inne serwisy - filtr trybu osobno bez zmian, z linkiem i bez linku", () => {
    for (const link of otherLinks) {
        for (const format of ["mp4", "mpeg", "mjpeg"]) {
            assert.equal(buildVideoOnlyFormat("best", format, link), "bv*[ext=mp4][vcodec^=avc1]/bv*", String(link));
            assert.equal(buildVideoOnlyFormat("720", format, link), `${shorterSide("bv*[ext=mp4][vcodec^=avc1]", "720")}/${shorterSide("bv*", "720")}`, String(link));
        }

        assert.equal(buildVideoOnlyFormat("best", "mkv", link), "bv*", String(link));
        assert.equal(buildVideoOnlyFormat("720", "mkv", link), shorterSide("bv*", "720"), String(link));
    }

    assert.equal(buildVideoOnlyFormat("best", "mp4"), "bv*[ext=mp4][vcodec^=avc1]/bv*");
});

test("UL-8c: tryb 'Film z dźwiękiem' - filtr nie zalezy od linku (rozpoznanie: juz wybieral najlepsza jakosc)", () => {
    for (const format of ["mp4", "mkv"]) {
        for (const resolution of ["best", "720"]) {
            assert.equal(buildVideoFormat(resolution, format, pinUrl), buildVideoFormat(resolution, format), `${format} ${resolution}`);
        }
    }

    assert.equal(buildVideoFormat("best", "mp4"), "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b");
});

// atrapa nie tworzy pliku, wiec pobieranie konczy sie bledem "nie znaleziono" - to oczekiwane
async function formatsPassedToYtDlp(t, run) {
    muteConsole(t);
    reset();

    await assert.rejects(run, (error) => {
        assert.match(error.message, /nie znaleziono/);
        return true;
    });

    return spawnState.calls.filter(call => call.args.includes("-f")).map(call => call.args[call.args.indexOf("-f") + 1]);
}

test("UL-8c: downloadSeparate przekazuje do yt-dlp filtr dla pina, a dla YouTube stary filtr", async (t) => {
    const jobId = "test-ul8c-brak-takiego-pliku";

    assert.deepEqual(await formatsPassedToYtDlp(t, () => appModule.downloadSeparate(pinUrl, "best", "mp4", jobId)), ["bv*[format_id!*=HEVC]/bv*"]);
    assert.deepEqual(
        await formatsPassedToYtDlp(t, () => appModule.downloadSeparate("https://pin.it/5RNR5E4PX", "480", "mjpeg", jobId)),
        [`${shorterSide("bv*[format_id!*=HEVC]", "480")}/${shorterSide("bv*", "480")}`]
    );
    assert.deepEqual(await formatsPassedToYtDlp(t, () => appModule.downloadSeparate(pinUrl, "best", "mkv", jobId)), ["bv*"]);
    assert.deepEqual(await formatsPassedToYtDlp(t, () => appModule.downloadSeparate(youtubeUrl, "best", "mp4", jobId)), ["bv*[ext=mp4][vcodec^=avc1]/bv*"]);
    assert.deepEqual(
        await formatsPassedToYtDlp(t, () => appModule.downloadVideo(pinUrl, "best", "mp4", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b"]
    );
});

// ---------- plik wideo trybu "osobno" bez dzwieku: argumenty ffmpeg ----------

function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-ul8c-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

// uruchamia processDownloadedFile na pliku-atrapie i zwraca argumenty ffmpeg (null, gdy ffmpeg nie ruszyl)
async function ffmpegArgsFor(t, overrides) {
    const dir = makeDir(t);

    fs.writeFileSync(path.join(dir, overrides.generatedFile), "ORYGINAL");
    reset();
    spawnState.writeOutput = true;

    await processDownloadedFile({
        bitrate: "best", experimental: noEffects, trimStartSeconds: null, trimEndSeconds: null, dir, mediaType: "videoOnly", ...overrides
    });

    spawnState.writeOutput = false;

    return spawnState.calls.length === 0 ? null : spawnState.calls[0].args;
}

test("UL-8c: wideo osobno mkv ze zrodla mp4 albo webm - kopiowanie z -an (dotad samo -c copy zostawialo dzwiek)", async (t) => {
    muteConsole(t);

    for (const source of ["tytul video [abcd1234].mp4", "tytul video [abcd1234].webm"]) {
        const args = await ffmpegArgsFor(t, { generatedFile: source, format: "mkv" });

        assert.deepEqual(args.slice(4, -1), ["-c", "copy", "-an"], source);
        assert.equal(path.basename(args[args.length - 1]), "tmp-tytul video [abcd1234].mkv");
    }
});

test("UL-8c: argumenty ffmpeg pliku wideo w trybie osobno zawieraja -an w kazdym formacie, z przycieciem i bez", async (t) => {
    muteConsole(t);

    for (const format of ["mp4", "mkv", "mpeg", "mjpeg"]) {
        for (const [start, end] of [[null, null], [1, 3], [1, null], [null, 3]]) {
            const args = await ffmpegArgsFor(t, {
                generatedFile: "pin video [abcd1234].mp4", format, trimStartSeconds: start, trimEndSeconds: end
            });
            const label = `${format} przyciecie ${start}-${end}`;

            assert.notEqual(args, null, `${label}: ffmpeg musi ruszyc`);
            assert.equal(args.filter(arg => arg === "-an").length, 1, `${label}: ${args.join(" ")}`);
            assert.ok(args.indexOf("-an") > args.indexOf("-i"), `${label}: -an ma dotyczyc wyjscia (stac po -i)`);
            assert.equal(args.includes("-c:a"), false, label);
        }
    }
});

test("UL-8c: film z dzwiekiem (tryb laczny) dalej nie dostaje -an", async (t) => {
    muteConsole(t);

    const args = await ffmpegArgsFor(t, { generatedFile: "pin [abcd1234].mp4", mediaType: "video", format: "mkv" });

    assert.notEqual(args, null);
    assert.equal(args.includes("-an"), false);
});

// ---------- prawdziwy ffmpeg: zrodlo z obrazem i dzwiekiem razem (jak V_720P z Pinteresta) ----------

function programWorks(command, versionArg) {
    try {
        return childProcess.spawnSync(command, [versionArg], { encoding: "utf8" }).status === 0;
    } catch {
        return false;
    }
}

const ffmpeg = appModule.ffmpegPath;
const skip = programWorks(ffmpeg, "-version") && programWorks("ffprobe", "-version") ? false : "brak ffmpeg albo ffprobe";

// probka 2 s: obraz H.264 i dzwiek AAC w jednym pliku mp4
function makeSampleWithAudio(filePath) {
    const result = childProcess.spawnSync(ffmpeg, [
        "-y", "-nostdin", "-v", "error",
        "-f", "lavfi", "-i", "testsrc=s=160x120:r=30:d=2",
        "-f", "lavfi", "-i", "sine=frequency=1000:sample_rate=48000:duration=2",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k",
        filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
}

function streams(filePath) {
    const result = childProcess.spawnSync("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_type,codec_name", "-of", "json", filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);

    return JSON.parse(result.stdout).streams.map(stream => `${stream.codec_type}:${stream.codec_name}`).sort();
}

for (const format of ["mkv", "mp4"]) {
    test(`UL-8c: prawdziwy ffmpeg - zrodlo z obrazem i dzwiekiem razem: plik wideo trybu osobno (${format}) ma sam obraz`, { skip }, async (t) => {
        muteConsole(t);

        const dir = makeDir(t);
        const name = "pin video [abcd1234].mp4";

        makeSampleWithAudio(path.join(dir, name));
        assert.deepEqual(streams(path.join(dir, name)), ["audio:aac", "video:h264"], "probka ma miec obraz i dzwiek");

        reset();
        spawnState.real = true;
        t.after(() => { spawnState.real = false; });

        const finalFile = await processDownloadedFile({
            generatedFile: name, experimental: noEffects, trimStartSeconds: null, trimEndSeconds: null,
            mediaType: "videoOnly", format, bitrate: "best", dir
        });

        assert.equal(finalFile, `pin video [abcd1234].${format}`);
        assert.deepEqual(fs.readdirSync(dir), [finalFile], "zostaje jeden plik, bez oryginalu i bez tmp-");
        assert.deepEqual(streams(path.join(dir, finalFile)), ["video:h264"], "plik wideo nie moze miec sciezki dzwiekowej");
    });
}
