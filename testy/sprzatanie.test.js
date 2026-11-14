// Testy zadania B8: sprzatanie starych plikow (cleanupOldDownloads) nie wywraca programu,
// gdy plik zniknie miedzy odczytaniem listy a statSync/unlinkSync albo gdy nie da sie odczytac folderu.
// Pliki robocze sa w os.tmpdir(); folder downloads programu nie jest ruszany. Nic nie jest pobierane z internetu.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const appPath = path.join(__dirname, "..", "app.js");
const { cleanupOldDownloads, fileMaxAgeMinutes } = require(appPath);

// ---------- pomocnicze ----------

function makeTempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b8-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

// tworzy plik, ktorego data modyfikacji jest o "ageMinutes" minut wczesniejsza niz teraz
function makeFile(dir, name, ageMinutes) {
    const filePath = path.join(dir, name);
    const time = new Date(Date.now() - ageMinutes * 60 * 1000);

    fs.writeFileSync(filePath, "x");
    fs.utimesSync(filePath, time, time);

    return filePath;
}

// podmienia funkcje fs na czas testu (app.js korzysta z tego samego obiektu fs)
function patchFs(t, name, replacement) {
    const original = fs[name];

    fs[name] = replacement(original);
    t.after(() => {
        fs[name] = original;
    });
}

// zbiera wpisy console.log na czas testu
function captureLogs(t) {
    const lines = [];
    const original = console.log;

    console.log = (...args) => {
        lines.push(args.join(" "));
    };
    t.after(() => {
        console.log = original;
    });

    return lines;
}

function enoent(filePath) {
    const error = new Error(`ENOENT: no such file or directory, '${filePath}'`);

    error.code = "ENOENT";

    return error;
}

const oldAge = fileMaxAgeMinutes + 30;

// ---------- zwykle dzialanie (nie moze sie zmienic) ----------

test("B8: limit wieku plikow to dalej 30 minut", () => {
    assert.equal(fileMaxAgeMinutes, 30);
});

test("B8: stary plik jest usuwany, swiezy zostaje, podfolder zostaje", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const oldFile = makeFile(dir, "stary.mp3", oldAge);
    const freshFile = makeFile(dir, "swiezy.mp3", 1);
    const almostOld = makeFile(dir, "prawie-stary.mp3", fileMaxAgeMinutes - 2);
    const subDir = path.join(dir, "podfolder");
    const time = new Date(Date.now() - oldAge * 60 * 1000);

    fs.mkdirSync(subDir);
    fs.utimesSync(subDir, time, time);

    cleanupOldDownloads(dir);

    assert.equal(fs.existsSync(oldFile), false, "stary plik mial zniknac");
    assert.equal(fs.existsSync(freshFile), true, "swiezy plik mial zostac");
    assert.equal(fs.existsSync(almostOld), true, "plik mlodszy niz limit mial zostac");
    assert.equal(fs.existsSync(subDir), true, "podfolder mial zostac");
    assert.deepEqual(logs, ["Usunieto stary plik: stary.mp3"]);
});

test("B8: pusty folder - nic sie nie dzieje", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);

    assert.doesNotThrow(() => cleanupOldDownloads(dir));
    assert.deepEqual(logs, []);
});

test("B8: bez argumentu sprzatany jest folder downloads obok app.js", (t) => {
    const seen = [];

    captureLogs(t);
    patchFs(t, "readdirSync", () => (dirPath) => {
        seen.push(dirPath);

        return [];
    });

    cleanupOldDownloads();

    assert.deepEqual(seen, [path.join(path.dirname(appPath), "downloads")]);
});

// ---------- znikajace pliki ----------

test("B8: plik znika przed statSync - bez wyjatku, wpis w konsoli, pozostale pliki sa dalej sprzatane", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const before = makeFile(dir, "a-stary.mp3", oldAge);
    const after = makeFile(dir, "c-stary.mp3", oldAge);
    const fresh = makeFile(dir, "d-swiezy.mp3", 1);

    // lista zawiera plik, ktorego juz nie ma na dysku (yt-dlp zdazyl go usunac)
    patchFs(t, "readdirSync", (original) => (dirPath) => {
        const names = original(dirPath);

        return ["a-stary.mp3", "b-zniknal.part", ...names.filter(name => name !== "a-stary.mp3")];
    });

    assert.doesNotThrow(() => cleanupOldDownloads(dir));

    assert.equal(fs.existsSync(before), false, "plik przed znikajacym mial byc usuniety");
    assert.equal(fs.existsSync(after), false, "plik po znikajacym mial byc usuniety");
    assert.equal(fs.existsSync(fresh), true);
    assert.deepEqual(logs, [
        "Usunieto stary plik: a-stary.mp3",
        "Pominieto plik, ktory zniknal w trakcie sprzatania: b-zniknal.part",
        "Usunieto stary plik: c-stary.mp3"
    ]);
});

test("B8: plik znika miedzy statSync a unlinkSync - bez wyjatku, wpis w konsoli, pozostale pliki sa dalej sprzatane", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const vanishing = makeFile(dir, "a-znika.mp4", oldAge);
    const other = makeFile(dir, "b-stary.mp4", oldAge);

    patchFs(t, "unlinkSync", (original) => (filePath) => {
        if (filePath === vanishing) {
            original(filePath);
            throw enoent(filePath);
        }

        return original(filePath);
    });

    assert.doesNotThrow(() => cleanupOldDownloads(dir));

    assert.equal(fs.existsSync(other), false, "drugi stary plik mial byc usuniety");
    assert.deepEqual(logs, [
        "Pominieto plik, ktory zniknal w trakcie sprzatania: a-znika.mp4",
        "Usunieto stary plik: b-stary.mp4"
    ]);
});

test("B8: inny blad statSync (np. brak dostepu) tez nie wywraca sprzatania", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const locked = makeFile(dir, "a-zablokowany.mp3", oldAge);
    const other = makeFile(dir, "b-stary.mp3", oldAge);

    patchFs(t, "statSync", (original) => (filePath, ...rest) => {
        if (filePath === locked) {
            const error = new Error("EPERM: operation not permitted");

            error.code = "EPERM";
            throw error;
        }

        return original(filePath, ...rest);
    });

    assert.doesNotThrow(() => cleanupOldDownloads(dir));

    assert.equal(fs.existsSync(locked), true);
    assert.equal(fs.existsSync(other), false, "drugi stary plik mial byc usuniety");
    assert.equal(logs.length, 2);
    assert.match(logs[0], /^Nie udalo sie usunac starego pliku: a-zablokowany\.mp3 EPERM/);
    assert.equal(logs[1], "Usunieto stary plik: b-stary.mp3");
});

test("B8: blad unlinkSync inny niz znikniecie (plik zajety) - plik zostaje, wpis w konsoli, bez wyjatku", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const busy = makeFile(dir, "zajety.mp3", oldAge);

    patchFs(t, "unlinkSync", () => () => {
        const error = new Error("EBUSY: resource busy or locked");

        error.code = "EBUSY";
        throw error;
    });

    assert.doesNotThrow(() => cleanupOldDownloads(dir));

    assert.equal(fs.existsSync(busy), true);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /^Nie udalo sie usunac starego pliku: zajety\.mp3 EBUSY/);
});

// ---------- readdirSync ----------

test("B8: folder nie istnieje (readdirSync rzuca) - bez wyjatku, wpis w konsoli", (t) => {
    const dir = path.join(makeTempDir(t), "nie-ma-takiego-folderu");
    const logs = captureLogs(t);

    assert.doesNotThrow(() => cleanupOldDownloads(dir));

    assert.equal(logs.length, 1);
    assert.match(logs[0], /^Nie udalo sie odczytac folderu pobierania: /);
});

// ---------- kod: zadne wywolanie fs w funkcji nie stoi poza try ----------

test("B8: w cleanupOldDownloads kazde wywolanie fs jest wewnatrz bloku try", () => {
    const source = fs.readFileSync(appPath, "utf8");
    const start = source.indexOf("function cleanupOldDownloads(");

    assert.notEqual(start, -1, "w app.js nie ma funkcji cleanupOldDownloads");

    // cialo funkcji: od pierwszej klamry do klamry zamykajacej na poczatku linii
    const bodyStart = source.indexOf("{", start);
    const bodyEnd = source.indexOf("\n}", bodyStart);
    const body = source.slice(bodyStart, bodyEnd + 2);

    // zakresy blokow "try { ... }" (bez czesci catch), liczone po klamrach
    const tryRanges = [];
    const tryPattern = /\btry\s*\{/g;
    let match = tryPattern.exec(body);

    while (match) {
        let depth = 0;
        let index = match.index + match[0].length - 1;

        do {
            if (body[index] === "{") depth += 1;
            if (body[index] === "}") depth -= 1;
            index += 1;
        } while (depth > 0);

        tryRanges.push([match.index, index]);
        match = tryPattern.exec(body);
    }

    const calls = [...body.matchAll(/\bfs\.\w+\(/g)];

    assert.deepEqual(
        calls.map(call => call[0]).sort(),
        ["fs.readdirSync(", "fs.statSync(", "fs.unlinkSync("],
        "w funkcji maja byc dokladnie te trzy wywolania fs"
    );

    for (const call of calls) {
        const inside = tryRanges.some(([from, to]) => call.index > from && call.index < to);

        assert.equal(inside, true, `${call[0]}...) stoi poza blokiem try`);
    }
});
