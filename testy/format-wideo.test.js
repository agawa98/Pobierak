// Testy zadania B13f: zapasowy wybor formatu (buildVideoFormat, buildVideoOnlyFormat).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp: spawn jest podmieniony na atrape, ktora zapisuje argumenty.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const appPath = path.join(__dirname, "..", "app.js");

// wczytuje app.js od nowa z atrapa spawn (app.js bierze spawn przy require)
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
const { buildVideoFormat, buildVideoOnlyFormat } = appModule;

const h264Formats = ["mp4", "mpeg", "mjpeg"];
const resolutions = ["144", "360", "480", "720", "1080"];

// yt-dlp probuje wariantow rozdzielonych "/" po kolei od lewej i bierze pierwszy, ktory pasuje
function alternatives(selector) {
    return selector.split("/");
}

// ---------- buildVideoFormat (film z dzwiekiem) ----------

for (const format of h264Formats) {
    test(`B13f: buildVideoFormat ${format} + best - dokladny napis z wariantem zapasowym na koncu`, () => {
        assert.equal(
            buildVideoFormat("best", format),
            "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b"
        );
    });

    for (const resolution of resolutions) {
        test(`B13f: buildVideoFormat ${format} + ${resolution} - dokladny napis z wariantem zapasowym na koncu`, () => {
            assert.equal(
                buildVideoFormat(resolution, format),
                `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][height<=${resolution}]/bv*[height<=${resolution}]+ba/b[height<=${resolution}]`
            );
        });
    }

    test(`B13f: buildVideoFormat ${format} - H.264 ma pierwszenstwo, warianty bez kodeka sa dopiero po nim`, () => {
        for (const resolution of ["best", ...resolutions]) {
            const parts = alternatives(buildVideoFormat(resolution, format));

            assert.equal(parts.length, 4);
            assert.match(parts[0], /^bv\*\[ext=mp4\]\[vcodec\^=avc1\]/, "pierwszy wariant ma wymagac H.264");
            assert.match(parts[0], /\+ba\[ext=m4a\]\[acodec\^=mp4a\]$/, "pierwszy wariant ma wymagac dzwieku AAC");
            assert.match(parts[1], /^b\[ext=mp4\]/, "drugi wariant to gotowy plik mp4");

            // dwa ostatnie warianty nie maja zadnego wymogu kodeka ani kontenera
            for (const part of parts.slice(2)) {
                assert.equal(/vcodec|acodec|ext=/.test(part), false, `wariant zapasowy "${part}" nie moze wymagac kodeka ani kontenera`);
            }
        }
    });

    test(`B13f: buildVideoFormat ${format} - kazdy wariant pilnuje wybranej rozdzielczosci`, () => {
        for (const resolution of resolutions) {
            for (const part of alternatives(buildVideoFormat(resolution, format))) {
                assert.ok(part.includes(`[height<=${resolution}]`), `wariant "${part}" nie ma limitu ${resolution}`);
            }
        }

        assert.equal(buildVideoFormat("best", format).includes("height"), false, "best nie ma limitu wysokosci");
    });
}

// ---------- buildVideoOnlyFormat (tryb "osobno") ----------

for (const format of h264Formats) {
    test(`B13f: buildVideoOnlyFormat ${format} + best - dokladny napis z wariantem zapasowym na koncu`, () => {
        assert.equal(buildVideoOnlyFormat("best", format), "bv*[ext=mp4][vcodec^=avc1]/bv*");
    });

    for (const resolution of resolutions) {
        test(`B13f: buildVideoOnlyFormat ${format} + ${resolution} - dokladny napis z wariantem zapasowym na koncu`, () => {
            assert.equal(
                buildVideoOnlyFormat(resolution, format),
                `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]/bv*[height<=${resolution}]`
            );
        });
    }

    test(`B13f: buildVideoOnlyFormat ${format} - wariant zapasowy nie dociaga dzwieku`, () => {
        for (const resolution of ["best", ...resolutions]) {
            const selector = buildVideoOnlyFormat(resolution, format);

            assert.equal(selector.includes("+"), false, "tryb osobno pobiera sam obraz");
            assert.equal(/(^|\/)b(\[|\/|$)/.test(selector), false, "wariant b (gotowy plik z dzwiekiem) nie pasuje do trybu osobno");
        }
    });
}

// ---------- mkv: bez zmian ----------

test("B13f: mkv zostaje bez zmian (juz bylo bez wymogu kodeka)", () => {
    assert.equal(buildVideoFormat("best", "mkv"), "bv*+ba/b");
    assert.equal(buildVideoFormat("720", "mkv"), "bv*[height<=720]+ba/b[height<=720]");
    assert.equal(buildVideoOnlyFormat("best", "mkv"), "bv*");
    assert.equal(buildVideoOnlyFormat("720", "mkv"), "bv*[height<=720]");
});

// ---------- to, co naprawde dostaje yt-dlp ----------

const url = "https://www.youtube.com/shorts/jBoKCUKJkiY";
const jobId = "test-b13f-brak-takiego-pliku";

// atrapa nie tworzy pliku, wiec funkcja konczy sie bledem "nie znaleziono" - to oczekiwane
async function formatsPassedToYtDlp(run) {
    calls.length = 0;

    await assert.rejects(run, (error) => {
        assert.match(error.message, /nie znaleziono/);
        return true;
    });

    return calls.filter(call => call.args.includes("-f")).map(call => call.args[call.args.indexOf("-f") + 1]);
}

test("B13f: downloadVideo przekazuje do yt-dlp po -f filtr z wariantem zapasowym", async () => {
    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadVideo(url, "720", "mp4", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1][height<=720]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b[height<=720]"]
    );

    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadVideo(url, "best", "mjpeg", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b"]
    );
});

test("B13f: downloadSeparate przekazuje do yt-dlp po -f filtr z wariantem zapasowym (tylko wywolanie obrazu)", async () => {
    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadSeparate(url, "480", "mp4", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1][height<=480]/bv*[height<=480]"]
    );

    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadSeparate(url, "best", "mpeg", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1]/bv*"]
    );
});
