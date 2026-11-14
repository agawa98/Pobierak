// Testy zadania U2: postep na przycisku "Pobierz".
// W czasie pobierania linie "[download] NN%" z logow backendu ustawiaja napis "Pobieram... NN%",
// logi typu zaczynajacego sie od FFMPEG ustawiaja "Przetwarzam...", po zakonczeniu napis wraca do "Pobierz".
// Z public/script.js sa wycinane: obsluga logow backendu (od utworzenia EventSource do funkcji trimLogs)
// oraz handleDownloadSubmit z walidacja. Calosc dziala bez przegladarki, na atrapach strony, EventSource i fetch.
// Nic nie pobieraja z internetu.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

// wycina z public/script.js cala funkcje o podanym naglowku (do pierwszej klamry } na poczatku linii)
function cutFunction(header) {
    const start = scriptSource.indexOf(header);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${header}`);

    const rest = scriptSource.slice(start);
    const end = rest.search(/\r?\n\}/);

    assert.notEqual(end, -1, `nie znaleziono konca funkcji: ${header}`);

    return rest.slice(0, end) + "\n}";
}

// wycina z public/script.js czesc z obsluga logow backendu
function cutLogsPart() {
    const startMark = "const backendLogs = new EventSource(";
    const endMark = "function trimLogs() {";
    const start = scriptSource.indexOf(startMark);
    const end = scriptSource.indexOf(endMark);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${startMark}`);
    assert.notEqual(end, -1, `w public/script.js nie ma: ${endMark}`);
    assert.ok(start < end, "obsluga logow backendu ma stac przed funkcja trimLogs");

    return scriptSource.slice(start, end);
}

// buduje strone-atrape: przycisk, logi backendu (atrapa EventSource) i fetch, ktory czeka na decyzje testu
function buildPage({ trimStart = "", trimEnd = "" } = {}) {
    const logs = [];          // kazde wywolanie addLog: [typ, tresc]
    const texts = [];         // kazda zmiana napisu przycisku, po kolei
    const sources = [];
    const pending = [];       // wiszace zadania fetch: { resolve, reject }

    function EventSource(url) {
        this.url = url;
        this.onopen = null;
        this.onerror = null;
        this.onmessage = null;
        sources.push(this);
    }

    const downloadButton = { disabled: false };

    const loaderClasses = new Set(["button-loader", "hidden"]);
    const buttonLoader = {
        classList: {
            add(name) { loaderClasses.add(name); },
            remove(name) { loaderClasses.delete(name); },
            contains(name) { return loaderClasses.has(name); }
        }
    };

    const buttonText = {
        _text: "Pobierz",
        get textContent() { return this._text; },
        set textContent(value) { this._text = String(value); texts.push(this._text); }
    };

    const validationClasses = new Set();
    const trimValidation = {
        textContent: "",
        classList: {
            add(name) { validationClasses.add(name); },
            remove(name) { validationClasses.delete(name); },
            contains(name) { return validationClasses.has(name); }
        }
    };

    const context = {
        EventSource,
        downloadButton,
        buttonLoader,
        buttonText,
        trimValidation,
        trimStartInput: { value: trimStart },
        trimEndInput: { value: trimEnd },
        resolutionSelect: { value: "best" },
        formatSelect: { value: "mp3" },
        document: {
            querySelector: () => ({ value: "https://example.invalid/film" }),
            createElement: () => ({ click() {} }),
            body: { appendChild() {}, removeChild() {} }
        },
        console: { error() {} },
        setTimeout,
        addLog: (type, message) => logs.push([type, message]),
        clearStatus() {},
        showStatusError() {},
        showStatusSuccess() {},
        getSelectedType: () => "audio",
        getSelectedBitrate: () => "best",
        getExperimentalOptions: () => ({ trimStart, trimEnd }),
        fetch: () => new Promise((resolve, reject) => { pending.push({ resolve, reject }); })
    };

    vm.createContext(context);
    vm.runInContext([
        cutLogsPart(),
        cutFunction("function parseTimeToSeconds(value) {"),
        cutFunction("function validateTrim() {"),
        cutFunction("async function handleDownloadSubmit(event) {")
    ].join("\n\n"), context);

    assert.equal(sources.length, 1, "strona ma otwierac dokladnie jedno polaczenie z logami");

    const source = sources[0];
    const page = {
        logs,
        texts,
        pending,
        downloadButton,
        buttonText,
        text: () => buttonText.textContent,

        // wiadomosc z backendu, tak jak przychodzi przez /api/logs
        message: (type, text) => source.onmessage({ data: JSON.stringify({ type, message: text }) }),

        // klik "Pobierz": zwraca obietnice konca handleDownloadSubmit; zadanie fetch wisi do finish*/fail
        start() {
            const done = context.handleDownloadSubmit({ preventDefault() {} });

            return done;
        },

        // serwer odpowiada JSON-em
        respond(status, body) {
            pending.shift().resolve({ ok: status >= 200 && status < 300, status, json: async () => body });
        },

        // serwer odpowiada czyms, co nie jest JSON-em
        respondBroken(status) {
            pending.shift().resolve({
                ok: status >= 200 && status < 300,
                status,
                json: async () => { throw new SyntaxError("Unexpected token '<'"); }
            });
        },

        // serwer w ogole nie odpowiada
        fail() {
            pending.shift().reject(new TypeError("Failed to fetch"));
        }
    };

    return page;
}

const success = { success: true, message: "Pobrano audio.", receivedData: {} };

// prawdziwe linie z yt-dlp (uruchomionego z --newline) i z ffmpeg
const progressLine = (percent) => `[download] ${String(percent).padStart(5)}% of    5.00MiB at    2.00MiB/s ETA 00:01`;
const ffmpegLine = "size=     512KiB time=00:00:21.84 bitrate= 192.0kbits/s speed=43.6x";

// ---------- przed pobieraniem ----------

test("U2: bez trwajacego pobierania linia postepu nie zmienia napisu przycisku", () => {
    const page = buildPage();

    page.message("YT-DLP AUDIO", progressLine("45.3"));
    page.message("FFMPEG", ffmpegLine);

    assert.equal(page.text(), "Pobierz");
    assert.deepEqual(page.texts, []);
});

test("U2: start pobierania ustawia sam napis Pobieram..., bez procentu", async () => {
    const page = buildPage();
    const done = page.start();

    assert.equal(page.text(), "Pobieram...");
    assert.equal(page.downloadButton.disabled, true);

    page.respond(200, success);
    await done;
});

// ---------- procent ----------

test("U2: linia [download] NN% w czasie pobierania ustawia napis Pobieram... NN%", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", progressLine("45.3"));
    assert.equal(page.text(), "Pobieram... 45%");

    page.respond(200, success);
    await done;
});

test("U2: procent jest zaokraglany w dol", async () => {
    const page = buildPage();
    const done = page.start();

    const cases = [
        ["0.0", "Pobieram... 0%"],
        ["0.5", "Pobieram... 0%"],
        ["9.99", "Pobieram... 9%"],
        ["45.9", "Pobieram... 45%"],
        ["99.9", "Pobieram... 99%"],
        ["100.0", "Pobieram... 100%"],
        ["100", "Pobieram... 100%"],
        ["7", "Pobieram... 7%"]
    ];

    for (const [percent, expected] of cases) {
        page.message("YT-DLP VIDEO", progressLine(percent));
        assert.equal(page.text(), expected, `procent ${percent}`);
    }

    page.respond(200, success);
    await done;
});

test("U2: procent rosnie razem z kolejnymi liniami postepu", async () => {
    const page = buildPage();
    const done = page.start();

    for (const percent of ["1.2", "20.0", "55.5", "80.1", "100"]) {
        page.message("YT-DLP AUDIO", progressLine(percent));
    }

    assert.deepEqual(page.texts, [
        "Pobieram...",
        "Pobieram... 1%",
        "Pobieram... 20%",
        "Pobieram... 55%",
        "Pobieram... 80%",
        "Pobieram... 100%"
    ]);

    page.respond(200, success);
    await done;
});

test("U2: kilka linii postepu w jednej wiadomosci - na przycisku zostaje ostatnia", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", `${progressLine("10.0")}\n${progressLine("20.0")}\r\n${progressLine("37.8")}\n`);
    assert.equal(page.text(), "Pobieram... 37%");

    page.respond(200, success);
    await done;
});

test("U2: rozne odstepy po [download] (takze koncowe 100% bez wyrownania) sa rozpoznawane", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", "[download]   3.1% of ~  5.00MiB at  1.00MiB/s ETA 00:05 (frag 1/30)");
    assert.equal(page.text(), "Pobieram... 3%");

    page.message("YT-DLP AUDIO", "[download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s");
    assert.equal(page.text(), "Pobieram... 100%");

    page.respond(200, success);
    await done;
});

test("U2: linie yt-dlp bez procentu nie zmieniaja napisu", async () => {
    const page = buildPage();
    const done = page.start();

    const lines = [
        "[youtube] Extracting URL: https://www.youtube.com/shorts/jBoKCUKJkiY",
        "[youtube] jBoKCUKJkiY: Downloading webpage",
        "[info] jBoKCUKJkiY: Downloading 1 format(s): 251",
        "[download] Destination: F:\\downloads\\the #1 NO SCOPE player in rivals [0a1b2c3d].webm",
        "[ExtractAudio] Destination: F:\\downloads\\the #1 NO SCOPE player in rivals [0a1b2c3d].mp3",
        "Deleting original file F:\\downloads\\film 50% [0a1b2c3d].webm (pass -k to keep)",
        "[download] film 100% [0a1b2c3d].mp3 has already been downloaded"
    ];

    for (const line of lines) {
        page.message("YT-DLP AUDIO", line);
        assert.equal(page.text(), "Pobieram...", line);
    }

    page.message("YT-DLP AUDIO", progressLine("60.0"));

    for (const line of lines) {
        page.message("YT-DLP AUDIO", line);
        assert.equal(page.text(), "Pobieram... 60%", line);
    }

    page.respond(200, success);
    await done;
});

// ---------- pobieranie bez linii z procentem ----------

test("U2: bledny zapis procentu (1.2.3%) albo brak odstepu po [download] nie zmienia napisu", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", "[download] 1.2.3% of 5.00MiB");
    page.message("YT-DLP AUDIO", "[download]45.0% of 5.00MiB");

    assert.equal(page.text(), "Pobieram...");
    assert.deepEqual(page.texts, ["Pobieram..."]);

    page.respond(200, success);
    await done;
});

test("U2: gdy yt-dlp nie podaje procentow (np. pobiera przez ffmpeg), zostaje samo Pobieram...", async () => {
    const page = buildPage({ trimStart: "5", trimEnd: "12" });
    const done = page.start();

    // tak wyglada pobieranie wycinka przez --download-sections: yt-dlp wypisuje linie ffmpeg pod wlasna etykieta.
    // program dzis tak nie pobiera (po B11 tnie ffmpeg po pobraniu calosci), ale regula jest ta sama: brak procentu = brak zmiany
    const lines = [
        "[download] Destination: F:\\downloads\\the #1 NO SCOPE player in rivals [0a1b2c3d].webm",
        "Input #0, matroska,webm, from 'https://rr1---sn.googlevideo.com/videoplayback':",
        "size=     128KiB time=00:00:07.00 bitrate= 149.8kbits/s speed=12.1x",
        "[download] 131.07KiB at  1.52MiB/s (00:00:02)",
        "frame=  210 fps= 60 q=-1.0 Lsize=    1024KiB time=00:00:07.00 bitrate=1198.1kbits/s speed=   2x"
    ];

    for (const line of lines) {
        page.message("YT-DLP AUDIO", line);
    }

    assert.equal(page.text(), "Pobieram...");
    assert.deepEqual(page.texts, ["Pobieram..."]);

    page.respond(200, success);
    await done;

    assert.equal(page.text(), "Pobierz");
});

// ---------- ffmpeg ----------

test("U2: log typu FFMPEG w czasie pobierania ustawia napis Przetwarzam...", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", progressLine("100"));
    page.message("FFMPEG", ffmpegLine);

    assert.equal(page.text(), "Przetwarzam...");

    page.respond(200, success);
    await done;
});

test("U2: typ zaczynajacy sie od FFMPEG (FFMPEG VIDEO ONLY) tez daje Przetwarzam...", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("FFMPEG VIDEO ONLY", "frame=  990 fps=0.0 q=-1.0 Lsize=   20647KiB time=00:00:32.96 speed= 512x");

    assert.equal(page.text(), "Przetwarzam...");

    page.respond(200, success);
    await done;
});

test("U2: slowo ffmpeg w tresci albo w srodku typu nie daje Przetwarzam...", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", "FFMPEG: Stream mapping");
    page.message("YT-DLP AUDIO", "[ffmpeg] Merging formats into \"film.mp4\"");
    page.message("YT-DLP FFMPEG", "linia");
    page.message("system", "FFMPEG gotowy");

    assert.equal(page.text(), "Pobieram...");

    page.respond(200, success);
    await done;
});

test("U2: linia ffmpeg z procentem w tresci daje Przetwarzam..., nie procent", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("FFMPEG", "[download] 50.0% of 5.00MiB");

    assert.equal(page.text(), "Przetwarzam...");

    page.respond(200, success);
    await done;
});

test("U2: tryb osobno - procent drugiego pliku, potem przetwarzanie", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP VIDEO ONLY", progressLine("50.0"));
    page.message("YT-DLP VIDEO ONLY", progressLine("100"));
    page.message("YT-DLP AUDIO ONLY", progressLine("12.5"));
    assert.equal(page.text(), "Pobieram... 12%");

    page.message("YT-DLP AUDIO ONLY", progressLine("100"));
    page.message("FFMPEG VIDEO ONLY", ffmpegLine);
    page.message("FFMPEG", ffmpegLine);
    assert.equal(page.text(), "Przetwarzam...");

    page.respond(200, success);
    await done;

    assert.equal(page.text(), "Pobierz");
});

// ---------- po zakonczeniu ----------

test("U2: po udanym pobraniu napis wraca do Pobierz, a spoznione linie go nie zmieniaja", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", progressLine("73.0"));
    page.respond(200, success);
    await done;

    assert.equal(page.text(), "Pobierz");
    assert.equal(page.downloadButton.disabled, false);

    page.message("YT-DLP AUDIO", progressLine("99.0"));
    page.message("FFMPEG", ffmpegLine);

    assert.equal(page.text(), "Pobierz");
});

test("U2: po bledzie serwera napis wraca do Pobierz, a spoznione linie go nie zmieniaja", async () => {
    const page = buildPage();
    const done = page.start();

    page.message("YT-DLP AUDIO", progressLine("12.0"));
    page.respond(500, { success: false, message: "YT-DLP AUDIO: ERROR: Video unavailable" });
    await done;

    assert.equal(page.text(), "Pobierz");

    page.message("YT-DLP AUDIO", progressLine("13.0"));
    page.message("FFMPEG", ffmpegLine);

    assert.equal(page.text(), "Pobierz");
});

test("U2: po zerwanym polaczeniu i po odpowiedzi niebedacej JSON-em napis wraca do Pobierz na stale", async () => {
    for (const finish of [page => page.fail(), page => page.respondBroken(502)]) {
        const page = buildPage();
        const done = page.start();

        page.message("FFMPEG", ffmpegLine);
        finish(page);
        await done;

        assert.equal(page.text(), "Pobierz");

        page.message("YT-DLP AUDIO", progressLine("50.0"));
        page.message("FFMPEG", ffmpegLine);

        assert.equal(page.text(), "Pobierz");
    }
});

test("U2: blad walidacji przycinania nie wlacza postepu", async () => {
    const page = buildPage({ trimStart: "2:00", trimEnd: "1:00" });

    await page.start();

    assert.equal(page.pending.length, 0, "zadanie nie wyszlo do serwera");

    page.message("YT-DLP AUDIO", progressLine("50.0"));
    page.message("FFMPEG", ffmpegLine);

    assert.equal(page.text(), "Pobierz");
    assert.deepEqual(page.texts, []);
});

test("U2: drugie pobranie zaczyna od Pobieram... i znowu pokazuje procent", async () => {
    const page = buildPage();

    let done = page.start();
    page.message("YT-DLP AUDIO", progressLine("100"));
    page.message("FFMPEG", ffmpegLine);
    page.respond(200, success);
    await done;

    done = page.start();
    assert.equal(page.text(), "Pobieram...");

    page.message("YT-DLP AUDIO", progressLine("31.4"));
    assert.equal(page.text(), "Pobieram... 31%");

    page.respond(200, success);
    await done;

    assert.equal(page.text(), "Pobierz");
});

// ---------- tlo z logami bez zmian ----------

test("U2: linie postepu i ffmpeg dalej trafiaja do tla z logami, w czasie pobierania i poza nim", async () => {
    const page = buildPage();

    page.message("YT-DLP AUDIO", progressLine("10.0"));

    const done = page.start();

    page.message("YT-DLP AUDIO", `${progressLine("20.0")}\n${progressLine("30.0")}`);
    page.message("FFMPEG", ffmpegLine);
    page.respond(200, success);
    await done;

    const backendLines = page.logs.filter(([type]) => type === "YT-DLP AUDIO" || type === "FFMPEG");

    assert.deepEqual(backendLines, [
        ["YT-DLP AUDIO", progressLine("10.0").trim()],
        ["YT-DLP AUDIO", progressLine("20.0").trim()],
        ["YT-DLP AUDIO", progressLine("30.0").trim()],
        ["FFMPEG", ffmpegLine]
    ]);
});
