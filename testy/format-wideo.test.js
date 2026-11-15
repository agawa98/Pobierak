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

// UL-8d: oczekiwany wariant z limitem krotszego boku - najpierw film pionowy (szerokosc <= R, wysokosc > R),
// potem dotychczasowy limit wysokosci (film poziomy)
function shorterSide(prefix, resolution, suffix = "") {
    return `${prefix}[width<=${resolution}][height>${resolution}]${suffix}/${prefix}[height<=${resolution}]${suffix}`;
}

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
                [
                    shorterSide("bv*[ext=mp4][vcodec^=avc1]", resolution, "+ba[ext=m4a][acodec^=mp4a]"),
                    shorterSide("b[ext=mp4]", resolution),
                    shorterSide("bv*", resolution, "+ba"),
                    shorterSide("b", resolution),
                ].join("/")
            );
        });
    }

    test(`B13f: buildVideoFormat ${format} - H.264 ma pierwszenstwo, warianty bez kodeka sa dopiero po nim`, () => {
        for (const resolution of ["best", ...resolutions]) {
            const parts = alternatives(buildVideoFormat(resolution, format));

            // UL-8d: przy limicie rozdzielczosci kazdy wariant jest podwojony (pionowy + poziomy)
            const step = resolution === "best" ? 1 : 2;

            assert.equal(parts.length, 4 * step);

            for (const part of parts.slice(0, step)) {
                assert.match(part, /^bv\*\[ext=mp4\]\[vcodec\^=avc1\]/, "pierwszy wariant ma wymagac H.264");
                assert.match(part, /\+ba\[ext=m4a\]\[acodec\^=mp4a\]$/, "pierwszy wariant ma wymagac dzwieku AAC");
            }

            for (const part of parts.slice(step, 2 * step)) {
                assert.match(part, /^b\[ext=mp4\]/, "drugi wariant to gotowy plik mp4");
            }

            // dwa ostatnie warianty nie maja zadnego wymogu kodeka ani kontenera
            for (const part of parts.slice(2 * step)) {
                assert.equal(/vcodec|acodec|ext=/.test(part), false, `wariant zapasowy "${part}" nie moze wymagac kodeka ani kontenera`);
            }
        }
    });

    test(`B13f: buildVideoFormat ${format} - kazdy wariant pilnuje wybranej rozdzielczosci`, () => {
        for (const resolution of resolutions) {
            for (const part of alternatives(buildVideoFormat(resolution, format))) {
                // UL-8d: limit krotszego boku - albo wysokosc <= R, albo (film pionowy) szerokosc <= R przy wysokosci > R
                assert.ok(
                    part.includes(`[height<=${resolution}]`) || part.includes(`[width<=${resolution}][height>${resolution}]`),
                    `wariant "${part}" nie ma limitu ${resolution}`
                );
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
                `${shorterSide("bv*[ext=mp4][vcodec^=avc1]", resolution)}/${shorterSide("bv*", resolution)}`
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
    assert.equal(buildVideoFormat("720", "mkv"), `${shorterSide("bv*", "720", "+ba")}/${shorterSide("b", "720")}`);
    assert.equal(buildVideoOnlyFormat("best", "mkv"), "bv*");
    assert.equal(buildVideoOnlyFormat("720", "mkv"), shorterSide("bv*", "720"));
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
        [[
            shorterSide("bv*[ext=mp4][vcodec^=avc1]", "720", "+ba[ext=m4a][acodec^=mp4a]"),
            shorterSide("b[ext=mp4]", "720"),
            shorterSide("bv*", "720", "+ba"),
            shorterSide("b", "720"),
        ].join("/")]
    );

    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadVideo(url, "best", "mjpeg", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]/bv*+ba/b"]
    );
});

test("B13f: downloadSeparate przekazuje do yt-dlp po -f filtr z wariantem zapasowym (tylko wywolanie obrazu)", async () => {
    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadSeparate(url, "480", "mp4", jobId)),
        [`${shorterSide("bv*[ext=mp4][vcodec^=avc1]", "480")}/${shorterSide("bv*", "480")}`]
    );

    assert.deepEqual(
        await formatsPassedToYtDlp(() => appModule.downloadSeparate(url, "best", "mpeg", jobId)),
        ["bv*[ext=mp4][vcodec^=avc1]/bv*"]
    );
});

// ---------- UL-8d: rozdzielczosc ogranicza krotszy bok ----------
// Maly symulator wyboru formatu w stylu yt-dlp: warianty rozdzielone "/" po kolei od lewej, w wariancie
// "obraz+dzwiek", filtry [pole op wartosc] (brak pola = nie pasuje, jak w yt-dlp bez "?"), z pasujacych
// bierze najwieksza rozdzielczosc. Wystarcza do sprawdzenia, ktory rozmiar obrazu wybierze wyrazenie.

const allResolutions = ["144", "360", "480", "720", "1080", "1440", "2160"];
const ladder = [144, 240, 360, 480, 720, 1080, 1440, 2160];

function matchesFilter(format, key, op, value) {
    const actual = format[key];

    if (actual === undefined) {
        return false;
    }

    switch (op) {
        case "<=": return actual <= Number(value);
        case ">": return actual > Number(value);
        case "=": return String(actual) === value;
        case "^=": return String(actual).startsWith(value);
        case "!*=": return !String(actual).includes(value);
        default: throw new Error(`symulator nie zna operatora ${op}`);
    }
}

function pickOne(formats, token) {
    const match = /^(bv\*|ba|b)((?:\[[^\]]+\])*)$/.exec(token);
    assert.ok(match, `symulator nie zna wariantu "${token}"`);

    const kinds = {
        "bv*": f => f.vcodec !== "none",
        "b": f => f.vcodec !== "none" && f.acodec !== "none",
        "ba": f => f.vcodec === "none" && f.acodec !== "none",
    };
    const filters = [...match[2].matchAll(/\[(\w+)(<=|>|!\*=|\^=|=)([^\]]+)\]/g)];
    assert.equal(filters.map(f => f[0]).join(""), match[2], `symulator nie rozumie filtrow "${match[2]}"`);

    const candidates = formats.filter(f => kinds[match[1]](f) && filters.every(([, key, op, value]) => matchesFilter(f, key, op, value)));

    candidates.sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)));
    return candidates[0] || null;
}

// zwraca "SZERxWYS" obrazu wybranego przez wyrazenie albo null
function simulate(selector, formats) {
    for (const alternative of selector.split("/")) {
        const picked = alternative.split("+").map(token => pickOne(formats, token));

        if (picked.every(Boolean)) {
            const video = picked[0];
            return `${video.width}x${video.height}`;
        }
    }

    return null;
}

// formaty jak z YouTube: osobne strumienie H.264 mp4 dla kazdej wysokosci, dzwiek m4a, jeden gotowy plik 360p
function formatsFor(sizes, combined = sizes[0][0] >= sizes[0][1] ? [640, 360] : [360, 640]) {
    return [
        ...sizes.map(([width, height]) => ({ format_id: `v${width}x${height}`, ext: "mp4", vcodec: "avc1.640028", acodec: "none", width, height })),
        { format_id: "18", ext: "mp4", vcodec: "avc1.42001E", acodec: "mp4a.40.2", width: combined[0], height: combined[1] },
        { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2" },
    ];
}

const landscape = formatsFor(ladder.map(h => [Math.round(h * 16 / 9), h]));
const portrait = formatsFor(ladder.map(w => [w, Math.round(w * 16 / 9)]));
const square = formatsFor(ladder.map(s => [s, s]), [360, 360]);

// stare wyrazenie sprzed UL-8d (sam limit wysokosci) - do porownania, ze film poziomy wychodzi tak samo
function oldSelector(selector) {
    return selector.split("/").filter(part => !/\[width<=\d+\]\[height>\d+\]/.test(part)).join("/");
}

const builders = [
    ["buildVideoFormat mp4", r => buildVideoFormat(r, "mp4")],
    ["buildVideoFormat mkv", r => buildVideoFormat(r, "mkv")],
    ["buildVideoOnlyFormat mp4", r => buildVideoOnlyFormat(r, "mp4")],
    ["buildVideoOnlyFormat mkv", r => buildVideoOnlyFormat(r, "mkv")],
    ["buildVideoOnlyFormat mp4 pin", r => buildVideoOnlyFormat(r, "mp4", "https://pl.pinterest.com/pin/123/")],
];

for (const [name, build] of builders) {
    test(`UL-8d: ${name} - film pionowy: rozdzielczosc ogranicza szerokosc (krotszy bok), dla kazdej pozycji listy`, () => {
        for (const resolution of allResolutions) {
            const r = Number(resolution);
            assert.equal(simulate(build(resolution), portrait), `${r}x${Math.round(r * 16 / 9)}`, `${resolution}p`);
        }
    });

    test(`UL-8d: ${name} - film poziomy: rozdzielczosc ogranicza wysokosc, wynik jak przed zmiana`, () => {
        for (const resolution of allResolutions) {
            const r = Number(resolution);
            const selector = build(resolution);

            assert.equal(simulate(selector, landscape), `${Math.round(r * 16 / 9)}x${r}`, `${resolution}p`);
            assert.equal(simulate(selector, landscape), simulate(oldSelector(selector), landscape), `${resolution}p jak dawniej`);
        }
    });

    test(`UL-8d: ${name} - film kwadratowy: oba boki do wybranej rozdzielczosci`, () => {
        for (const resolution of allResolutions) {
            assert.equal(simulate(build(resolution), square), `${resolution}x${resolution}`, `${resolution}p`);
        }
    });

    test(`UL-8d: ${name} - film pionowy bez wybranej rozdzielczosci: najblizsza mniejsza, nigdy wieksza`, () => {
        // brak 720 i 1080 szerokosci: 720p ma dac 480x854, 1080p tez 480x854 (wiekszych niz 1080 nie bierze)
        const gaps = formatsFor([[360, 640], [480, 854], [1440, 2560]]);

        assert.equal(simulate(build("720"), gaps), "480x854");
        assert.equal(simulate(build("1080"), gaps), "480x854");
        assert.equal(simulate(build("1440"), gaps), "1440x2560");
    });

    test(`UL-8d: ${name} - Best bez ograniczenia rozmiaru, bierze najwiekszy obraz`, () => {
        const selector = build("best");

        assert.equal(/width|height/.test(selector), false, selector);
        assert.equal(simulate(selector, portrait), "2160x3840");
        assert.equal(simulate(selector, landscape), "3840x2160");
    });
}

test("UL-8d: format bez podanej szerokosci - dawny limit wysokosci dalej dziala", () => {
    const noWidth = [
        { format_id: "a", ext: "mp4", vcodec: "avc1", acodec: "none", height: 480 },
        { format_id: "b", ext: "mp4", vcodec: "avc1", acodec: "none", height: 1080 },
        { format_id: "140", ext: "m4a", vcodec: "none", acodec: "mp4a.40.2" },
    ];

    assert.equal(simulate(buildVideoFormat("720", "mp4"), noWidth), "undefinedx480");
    assert.equal(simulate(buildVideoOnlyFormat("720", "mkv"), noWidth), "undefinedx480");
});
