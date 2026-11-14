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

// ======================================================================================
// Testy zadania BUG-5: sprzatanie pomija pliki zadan w toku (activeJobs).
// Endpoint /api/download dostaje atrape spawn (yt-dlp nie jest uruchamiany, nic nie jest pobierane),
// serwer slucha na losowym wolnym porcie (0). Pliki sprzatania powstaja tylko w os.tmpdir().
// ======================================================================================

const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

// osobna kopia app.js z podmienionym spawn: kazde wywolanie spawn wola onSpawn(args), potem proces "konczy sie" kodem code
function loadAppWithFakeSpawn(onSpawn) {
    const originalSpawn = childProcess.spawn;
    const calls = [];

    childProcess.spawn = (command, args) => {
        calls.push({ command, args });

        const fake = new EventEmitter();
        fake.stdout = new EventEmitter();
        fake.stderr = new EventEmitter();

        setImmediate(() => {
            const { code = 0, stderr = "" } = onSpawn(args) || {};

            if (stderr) {
                fake.stderr.emit("data", Buffer.from(stderr));
            }

            fake.emit("close", code);
        });

        return fake;
    };

    delete require.cache[require.resolve(appPath)];

    try {
        return { appModule: require(appPath), calls };
    } finally {
        childProcess.spawn = originalSpawn;
        delete require.cache[require.resolve(appPath)];
    }
}

function startTestServer(t, appModule) {
    return new Promise((resolve) => {
        const server = appModule.app.listen(0, "127.0.0.1", () => resolve(server));

        t.after(() => {
            server.close();
            server.closeAllConnections();
        });
    });
}

async function postDownload(server, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000)
    });

    return { status: response.status, json: await response.json() };
}

function muteConsole(t) {
    t.mock.method(console, "log", () => {});
    t.mock.method(console, "error", () => {});
}

// jobId z szablonu -o: ".../%(title).150B [<jobId>].%(ext)s"
function jobIdFromArgs(args) {
    const template = args[args.indexOf("-o") + 1];
    const match = /\[([^\]]+)\]\.%\(ext\)s$/.exec(template);

    assert.ok(match, `nie znaleziono jobId w szablonie -o: ${template}`);

    return match[1];
}

const bug5Url = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const audioBody = { url: bug5Url, type: "audio", format: "mp3", bitrate: "best", experimental: noEffects };

// ---------- isActiveJobFile i cleanupOldDownloads ze zbiorem zadan ----------

test("BUG-5: zbior zadan w toku to Map (przy jobId da sie trzymac obiekt zadania) i jest pusty po starcie", () => {
    const { appModule } = loadAppWithFakeSpawn(() => ({}));

    assert.ok(appModule.activeJobs instanceof Map);
    assert.equal(appModule.activeJobs.size, 0);
});

test("BUG-5: isActiveJobFile rozpoznaje tylko nazwy z [<jobId>] aktywnego zadania", () => {
    const { isActiveJobFile } = require(appPath);
    const jobs = new Map([["ab12cd34", { jobId: "ab12cd34" }]]);

    assert.equal(isActiveJobFile("Film [ab12cd34].mp4", jobs), true);
    assert.equal(isActiveJobFile("Film video [ab12cd34].f137.mp4.part", jobs), true);
    assert.equal(isActiveJobFile("tmp-Film [ab12cd34].mp3", jobs), true);
    assert.equal(isActiveJobFile("Film [ff99ee88].mp4", jobs), false, "inne zadanie");
    assert.equal(isActiveJobFile("Film ab12cd34.mp4", jobs), false, "jobId bez nawiasow to nie plik zadania");
    assert.equal(isActiveJobFile("Film [ab12cd3].mp4", jobs), false, "krotszy identyfikator");
    assert.equal(isActiveJobFile("Film [ab12cd34].mp4", new Map()), false, "brak zadan w toku");
});

test("BUG-5: stary plik aktywnego zadania zostaje, stary plik zakonczonego zadania znika", (t) => {
    const dir = makeTempDir(t);
    const logs = captureLogs(t);
    const jobs = new Map([["aaaa1111", { jobId: "aaaa1111" }]]);
    const activeFile = makeFile(dir, "Trwa [aaaa1111].mp4", oldAge);
    const activePart = makeFile(dir, "Trwa video [aaaa1111].f137.mp4.part", oldAge);
    const activeTemp = makeFile(dir, "tmp-Trwa [aaaa1111].mp3", oldAge);
    const finishedFile = makeFile(dir, "Gotowe [bbbb2222].mp4", oldAge);
    const freshFinished = makeFile(dir, "Swieze [cccc3333].mp4", 1);

    cleanupOldDownloads(dir, jobs);

    assert.equal(fs.existsSync(activeFile), true, "plik aktywnego zadania mial zostac");
    assert.equal(fs.existsSync(activePart), true, "plik .part aktywnego zadania mial zostac");
    assert.equal(fs.existsSync(activeTemp), true, "plik tymczasowy ffmpeg aktywnego zadania mial zostac");
    assert.equal(fs.existsSync(finishedFile), false, "stary plik zakonczonego zadania mial zniknac");
    assert.equal(fs.existsSync(freshFinished), true, "swiezy plik mial zostac");
    assert.deepEqual(logs, ["Usunieto stary plik: Gotowe [bbbb2222].mp4"]);

    // zadanie sie skonczylo: ten sam plik po nastepnym sprzataniu znika (liczy sie wiek pliku, nie czas od konca zadania)
    jobs.delete("aaaa1111");
    cleanupOldDownloads(dir, jobs);

    assert.equal(fs.existsSync(activeFile), false, "po zakonczeniu zadania stary plik mial zniknac");
    assert.equal(fs.existsSync(activePart), false);
    assert.equal(fs.existsSync(activeTemp), false);
});

test("BUG-5: bez drugiego argumentu sprzatanie korzysta ze zbioru activeJobs programu", (t) => {
    const appModule = require(appPath);
    const dir = makeTempDir(t);

    captureLogs(t);

    const activeFile = makeFile(dir, "Trwa [dddd4444].mp3", oldAge);
    const otherFile = makeFile(dir, "Inne [eeee5555].mp3", oldAge);

    appModule.activeJobs.set("dddd4444", { jobId: "dddd4444" });
    t.after(() => appModule.activeJobs.delete("dddd4444"));

    appModule.cleanupOldDownloads(dir);

    assert.equal(fs.existsSync(activeFile), true, "plik zadania z activeJobs mial zostac");
    assert.equal(fs.existsSync(otherFile), false, "plik spoza activeJobs mial zniknac");
});

// ---------- endpoint POST /api/download ----------

test("BUG-5: endpoint dodaje jobId do activeJobs na czas zadania i usuwa go po bledzie yt-dlp", async (t) => {
    muteConsole(t);

    const dir = makeTempDir(t);
    const seen = [];
    let appModule;

    ({ appModule } = loadAppWithFakeSpawn((args) => {
        const jobId = jobIdFromArgs(args);
        const oldFile = makeFile(dir, `Film [${jobId}].webm.part`, oldAge);

        // sprzatanie w trakcie zadania: plik zadania zostaje
        appModule.cleanupOldDownloads(dir);

        seen.push({
            jobId,
            active: appModule.activeJobs.has(jobId),
            job: appModule.activeJobs.get(jobId),
            fileKept: fs.existsSync(oldFile)
        });

        return { code: 1, stderr: "ERROR: [youtube] jNQXAC9IVRw: Video unavailable\n" };
    }));

    const server = await startTestServer(t, appModule);
    const { status, json } = await postDownload(server, audioBody);

    assert.equal(status, 500);
    assert.equal(json.success, false);
    assert.equal(seen.length, 1, "yt-dlp mial byc uruchomiony raz");
    assert.equal(seen[0].active, true, "w trakcie zadania jobId mial byc w activeJobs");
    assert.equal(typeof seen[0].job, "object", "przy jobId ma byc obiekt zadania");
    assert.equal(seen[0].fileKept, true, "sprzatanie w trakcie zadania usunelo jego plik");
    assert.equal(appModule.activeJobs.has(seen[0].jobId), false, "po bledzie jobId zostal w activeJobs");
    assert.equal(appModule.activeJobs.size, 0);

    // po zakonczeniu zadania ten sam stary plik jest juz sprzatany
    appModule.cleanupOldDownloads(dir);
    assert.equal(fs.existsSync(path.join(dir, `Film [${seen[0].jobId}].webm.part`)), false);
});

test("BUG-5: po bledzie braku pliku (yt-dlp konczy sie kodem 0, pliku nie ma) jobId tez znika z activeJobs", async (t) => {
    muteConsole(t);

    const seen = [];
    let appModule;

    ({ appModule } = loadAppWithFakeSpawn((args) => {
        const jobId = jobIdFromArgs(args);

        seen.push({ jobId, active: appModule.activeJobs.has(jobId) });

        return { code: 0 };
    }));

    const server = await startTestServer(t, appModule);
    const separateBody = { url: bug5Url, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects };

    for (const body of [audioBody, separateBody]) {
        const { status, json } = await postDownload(server, body);

        assert.equal(status, 500, JSON.stringify(json));
        assert.equal(json.success, false);
    }

    assert.ok(seen.length >= 2);
    assert.ok(seen.every(entry => entry.active), "w trakcie zadania jobId mial byc w activeJobs");
    assert.equal(new Set(seen.map(entry => entry.jobId)).size, 2, "kazde zadanie ma wlasny jobId");
    assert.equal(appModule.activeJobs.size, 0, "po bledzie identyfikatory zostaly w activeJobs");
});

test("BUG-5: po udanym pobraniu jobId znika z activeJobs", async (t) => {
    muteConsole(t);

    const seen = [];
    let appModule;

    ({ appModule } = loadAppWithFakeSpawn((args) => {
        const jobId = jobIdFromArgs(args);

        seen.push({ jobId, active: appModule.activeJobs.has(jobId) });

        return { code: 0 };
    }));

    // folder downloads "zawiera" plik pobrany przez atrape - nic nie trafia na dysk
    const originalReaddirSync = fs.readdirSync;

    t.mock.method(fs, "readdirSync", (target, ...rest) => {
        if (path.resolve(String(target)) === path.resolve(appModule.downloadsDir) && seen.length > 0) {
            return [`Film [${seen[0].jobId}].mp3`];
        }

        return originalReaddirSync(target, ...rest);
    });

    const server = await startTestServer(t, appModule);
    const { status, json } = await postDownload(server, audioBody);

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].active, true);
    assert.equal(appModule.activeJobs.size, 0, "po sukcesie jobId zostal w activeJobs");
});

test("BUG-5: blad walidacji nie dodaje niczego do activeJobs", async (t) => {
    muteConsole(t);

    const { appModule, calls } = loadAppWithFakeSpawn(() => ({}));
    const server = await startTestServer(t, appModule);
    const { status } = await postDownload(server, { ...audioBody, format: "exe" });

    assert.equal(status, 400);
    assert.equal(calls.length, 0);
    assert.equal(appModule.activeJobs.size, 0);
});
