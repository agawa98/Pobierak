// Testy zadania B13c: wspolna walidacja czasu przycinania.
// parseTimeToSeconds z app.js (backend) i z public/script.js (strona) maja dawac identyczne wyniki:
// przechodzi tylko zapis ^\d+(:\d+){0,2}$, minuty i sekundy w MM:SS i GG:MM:SS najwyzej 59.
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg: zadania do /api/download
// maja zawsze bledny czas, wiec serwer odrzuca je (400) przed pobieraniem.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appModule = require(path.join(__dirname, "..", "app.js"));
const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

// wycina funkcje parseTimeToSeconds z public/script.js i uruchamia ja bez przegladarki (reszta pliku potrzebuje DOM)
function loadFrontendParse() {
    const match = scriptSource.match(/function parseTimeToSeconds\(value\) \{[\s\S]*?\r?\n\}/);

    assert.ok(match, "w public/script.js nie ma funkcji parseTimeToSeconds(value)");

    return vm.runInNewContext(`(${match[0]})`);
}

const sides = [
    { name: "backend (app.js)", parse: appModule.parseTimeToSeconds },
    { name: "strona (public/script.js)", parse: loadFrontendParse() }
];

// poprawne zapisy: [wpisany tekst, oczekiwane sekundy]
const validCases = [
    // przyklady z zadania
    ["90", 90],
    ["1:30", 90],
    ["1:02:03", 3723],
    // same sekundy nie maja limitu 59
    ["0", 0],
    ["59", 59],
    ["60", 60],
    ["75", 75],
    ["3600", 3600],
    ["007", 7],
    // MM:SS
    ["0:00", 0],
    ["0:59", 59],
    ["1:00", 60],
    ["01:05", 65],
    ["1:5", 65],
    ["59:59", 3599],
    // pierwsza czesc nie ma limitu (minuty w MM:SS, godziny w GG:MM:SS)
    ["60:00", 3600],
    ["90:00", 5400],
    ["100:00:00", 360000],
    // GG:MM:SS
    ["0:00:00", 0],
    ["0:00:59", 59],
    ["0:59:00", 3540],
    ["0:59:59", 3599],
    ["1:00:00", 3600],
    ["01:02:03", 3723],
    ["10:59:59", 39599],
    // spacje dookola sa obcinane
    ["  90  ", 90],
    [" 1:30\t", 90],
    ["\n1:02:03\n", 3723]
];

// puste pole = brak przyciecia
const emptyCases = ["", " ", "   ", "\t", " \n "];

// bledne zapisy: wynik NaN
const invalidCases = [
    // przyklady z zadania
    "1:75", "1::2", "0x10", "1e3", "-5", "1.5",
    // limit 59 dla minut i sekund
    "1:60", "0:60", "1:99", "1:100",
    "1:60:00", "1:00:60", "1:59:60", "1:60:59", "0:75:00", "0:00:75", "1:100:00",
    // puste czesci
    ":", "::", ":30", "1:", "1:30:", ":1:30", "1::", "::1", "1:2:",
    // za duzo czesci
    "1:2:3:4", "0:0:0:0",
    // znaki i ulamki
    "+5", "-1:30", "1:-30", "1:+30", "1.5:00", "1:30.5", "1,5", "1:30,5", ".5", "5.",
    // inne zapisy liczb, ktore Number() by przyjal
    "0b11", "0o17", "0X10", "1E3", "1e-3", "Infinity", "NaN", "1_000",
    // spacje w srodku
    "1 :30", "1: 30", "1 30", "1 : 30",
    // litery i inne teksty
    "abc", "1:3a", "a:30", "90s", "1m30s", "1h", "null", "undefined", "true",
    // cyfry spoza ASCII
    "１２", "١٢"
];

for (const side of sides) {
    test(`B13c: ${side.name} - poprawne zapisy daja sekundy`, () => {
        for (const [input, expected] of validCases) {
            assert.strictEqual(side.parse(input), expected, `"${input}" powinno dac ${expected}`);
        }
    });

    test(`B13c: ${side.name} - puste pole daje null`, () => {
        for (const input of emptyCases) {
            assert.strictEqual(side.parse(input), null, `${JSON.stringify(input)} powinno dac null`);
        }
    });

    test(`B13c: ${side.name} - bledne zapisy daja NaN`, () => {
        for (const input of invalidCases) {
            const result = side.parse(input);

            assert.ok(Number.isNaN(result), `"${input}" powinno dac NaN, a dalo ${result}`);
        }
    });
}

test("B13c: obie funkcje daja identyczny wynik dla kazdego zapisu z list", () => {
    const [backend, frontend] = sides;
    const inputs = [...validCases.map(item => item[0]), ...emptyCases, ...invalidCases];

    for (const input of inputs) {
        assert.ok(Object.is(backend.parse(input), frontend.parse(input)),
            `rozny wynik dla ${JSON.stringify(input)}: backend ${backend.parse(input)}, strona ${frontend.parse(input)}`);
    }
});

test("B13c: obie funkcje daja identyczny i poprawny wynik dla wszystkich krotkich zapisow ze znakow 0 1 5 6 9 : . - e x i spacji", () => {
    const [backend, frontend] = sides;
    const alphabet = ["0", "1", "5", "6", "9", ":", ".", "-", "e", "x", " "];
    let inputs = [""];
    let checked = 0;

    // wszystkie napisy o dlugosci 1-5 z tego zestawu (ok. 177 tys.)
    for (let length = 1; length <= 5; length++) {
        inputs = inputs.flatMap(prefix => alphabet.map(char => prefix + char));

        for (const input of inputs) {
            const fromBackend = backend.parse(input);
            const fromFrontend = frontend.parse(input);

            if (!Object.is(fromBackend, fromFrontend)) {
                assert.fail(`rozny wynik dla ${JSON.stringify(input)}: backend ${fromBackend}, strona ${fromFrontend}`);
            }

            // oczekiwany wynik liczony niezaleznie od kodu programu, wedlug reguly z zadania:
            // pusty -> null, zapis spoza ^\d+(:\d+){0,2}$ -> NaN, minuty i sekundy ponad 59 -> NaN
            const trimmed = input.trim();
            let expected;

            if (trimmed === "") {
                expected = null;
            } else if (!/^[0-9]+(:[0-9]+){0,2}$/.test(trimmed)) {
                expected = NaN;
            } else {
                const numbers = trimmed.split(":").map(part => parseInt(part, 10));

                expected = numbers.slice(1).some(part => part > 59)
                    ? NaN
                    : numbers.reduce((sum, part) => sum * 60 + part, 0);
            }

            if (!Object.is(fromBackend, expected)) {
                assert.fail(`${JSON.stringify(input)} powinno dac ${expected}, a dalo ${fromBackend}`);
            }

            checked++;
        }
    }

    assert.equal(checked, 11 + 11 ** 2 + 11 ** 3 + 11 ** 4 + 11 ** 5);
});

// ---------- endpoint /api/download: bledny czas jest odrzucany przed pobieraniem ----------

function startServer() {
    return new Promise((resolve, reject) => {
        const server = appModule.app.listen(0, "127.0.0.1", () => resolve(server));
        server.on("error", reject);
    });
}

function stopServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

// wysyla poprawne zadanie audio z podanymi czasami przyciecia. adres jest zmyslony i nigdy nie jest pobierany,
// bo kazde zadanie w tych testach ma bledny czas
async function postDownload(server, trimStart, trimEnd) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url: "http://127.0.0.1:9/nie-istnieje",
            type: "audio",
            format: "mp3",
            bitrate: "best",
            resolution: "best",
            experimental: { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart, trimEnd }
        })
    });

    return { status: response.status, body: await response.json() };
}

// endpoint wypisuje kazde zadanie przez console.log; na czas testu wyciszamy, zeby nie zasmiecac wyniku
async function withQuietServer(run) {
    const server = await startServer();
    const originalLog = console.log;

    console.log = () => {};

    try {
        await run(server);
    } finally {
        console.log = originalLog;
        await stopServer(server);
    }
}

test("B13c: /api/download odrzuca bledne zapisy czasu odpowiedzia 400", async () => {
    await withQuietServer(async (server) => {
        for (const input of ["1:75", "1::2", "0x10", "1e3", "-5", "1.5", "1:60:00", "1:2:3:4"]) {
            for (const [trimStart, trimEnd] of [[input, ""], ["", input]]) {
                const result = await postDownload(server, trimStart, trimEnd);

                assert.equal(result.status, 400, `start "${trimStart}", koniec "${trimEnd}"`);
                assert.deepEqual(result.body, { success: false, message: "Nieprawidłowy format czasu przycinania." });
            }
        }
    });
});

test("B13c: /api/download liczy 1:30 i 90 jako ten sam czas (poczatek rowny koncowi)", async () => {
    await withQuietServer(async (server) => {
        for (const [trimStart, trimEnd] of [["1:30", "90"], ["90", "1:30"], ["1:02:03", "3723"], ["0:01:30", " 90 "]]) {
            const result = await postDownload(server, trimStart, trimEnd);

            assert.equal(result.status, 400, `start "${trimStart}", koniec "${trimEnd}"`);
            assert.deepEqual(result.body, { success: false, message: "Początek przycinania musi być mniejszy niż koniec." });
        }
    });
});
