// Testy zadania BUG-2: zerwanie polaczenia (zamkniecie albo odswiezenie karty) anuluje pobieranie:
// zabija proces zadania razem z jego procesami potomnymi, nie uruchamia nastepnego programu,
// usuwa pliki zadania i zdejmuje zadanie ze zbioru zadan w toku.
//
// Czesc 1 - testy calego przebiegu: osobny proces z kopia app.js w os.tmpdir() (testy/anulowanie-serwer-pomoc.js),
// w ktorym zamiast yt-dlp i ffmpeg dziala atrapa (testy/anulowanie-atrapa-pomoc.js) - prawdziwy, dlugo dzialajacy
// proces Node, ktory sam uruchamia proces potomny. Serwer slucha na losowym wolnym porcie.
// Czesc 2 - testy pojedynczych funkcji z atrapami spawn i process.kill.
// Nic nie jest pobierane z internetu, pliki powstaja tylko w os.tmpdir(), prawdziwy folder downloads nie jest ruszany.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const childProcess = require("node:child_process");
const { EventEmitter } = require("node:events");

const projectDir = path.join(__dirname, "..");
const appPath = path.join(projectDir, "app.js");
const serverHelperPath = path.join(__dirname, "anulowanie-serwer-pomoc.js");
const fakeProgramPath = path.join(__dirname, "anulowanie-atrapa-pomoc.js");

// ---------- pomocnicze ----------

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// czeka, az check() zwroci prawde; po czasie timeoutMs test pada z opisem
async function waitFor(check, description, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
        if (await check()) {
            return;
        }

        await sleep(50);
    }

    assert.fail(`nie doczekano sie: ${description}`);
}

function isAlive(pid) {
    try {
        process.kill(pid, 0);       // sygnal 0 niczego nie wysyla, tylko sprawdza, czy proces istnieje
        return true;
    } catch (error) {
        return error.code === "EPERM";
    }
}

function forceKill(pid) {
    try {
        process.kill(pid, "SIGKILL");
    } catch {
        // procesu juz nie ma
    }
}

// linie "start <numer> <pid> <pid potomka> <program>" zapisane przez atrape
function readStarts(logPath) {
    if (!fs.existsSync(logPath)) {
        return [];
    }

    return fs.readFileSync(logPath, "utf8")
        .split("\n")
        .filter(line => line.startsWith("start "))
        .map((line) => {
            const [, number, pid, grandchildPid, program] = line.split(" ");

            return { number: Number(number), pid: Number(pid), grandchildPid: Number(grandchildPid), program };
        });
}

// uruchamia serwer z kopia app.js w os.tmpdir(). hangOn - numer uruchomienia atrapy, ktore ma wisiec (0 = zadne)
async function startCancelServer(t, hangOn) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-bug2-"));
    const appCopyPath = path.join(workDir, "app.js");
    const logPath = path.join(workDir, "atrapa.log");
    const downloads = path.join(workDir, "downloads");

    const target = path.join(workDir, "cel");       // UL-2b: folder docelowy wysylany w kazdym zadaniu pobrania

    fs.copyFileSync(appPath, appCopyPath);
    fs.mkdirSync(path.join(workDir, "public"));
    fs.mkdirSync(target);

    const env = {
        ...process.env,
        NODE_PATH: path.join(projectDir, "node_modules"),
        ATRAPA_LOG: logPath,
        ATRAPA_WISI: String(hangOn)
    };

    for (const name of ["YTDLP_PATH", "FFMPEG_PATH", "HOST", "PORT"]) {
        delete env[name];
    }

    const child = childProcess.spawn(process.execPath, [serverHelperPath, appCopyPath, fakeProgramPath], {
        env,
        stdio: ["ignore", "pipe", "pipe"]
    });

    const state = { workDir, logPath, downloads, target, child, output: "", port: 0 };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { state.output += chunk; });
    child.stderr.on("data", (chunk) => { state.output += chunk; });

    t.after(async () => {
        // gdyby test padl w polowie: nie zostawiamy procesow atrapy ani serwera
        for (const start of readStarts(logPath)) {
            forceKill(start.pid);

            if (start.grandchildPid) {
                forceKill(start.grandchildPid);
            }
        }

        child.kill();
        await sleep(100);
        fs.rmSync(workDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    });

    await waitFor(() => /PORT (\d+)/.test(state.output), `start serwera testowego. Wyjscie:\n${state.output}`);

    state.port = Number(/PORT (\d+)/.exec(state.output)[1]);

    return state;
}

// wysyla POST /api/download i zwraca zadanie HTTP, ktore mozna zerwac przez destroy()
function openDownloadRequest(state, body) {
    const request = http.request({
        host: "127.0.0.1",
        port: state.port,
        path: "/api/download",
        method: "POST",
        headers: { "Content-Type": "application/json" }
    });

    request.responses = [];
    request.on("response", (response) => {
        request.responses.push(response.statusCode);
        response.resume();
    });
    request.on("error", () => {});      // zerwanie polaczenia przez test
    request.end(JSON.stringify({ folder: state.target, ...body }));

    return request;
}

async function postDownload(state, body) {
    const response = await fetch(`http://127.0.0.1:${state.port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder: state.target, ...body }),
        signal: AbortSignal.timeout(15000)
    });

    return { status: response.status, json: await response.json() };
}

async function activeJobIds(state) {
    const response = await fetch(`http://127.0.0.1:${state.port}/test/zadania`, { signal: AbortSignal.timeout(5000) });

    return response.json();
}

function downloadsFiles(state) {
    return fs.readdirSync(state.downloads).sort();
}

function cancelLines(state) {
    return state.output.split(/\r?\n/).filter(line => line.includes("anulowane"));
}

const videoUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const noEffects = { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" };
const trimmed = { ...noEffects, trimStart: "1", trimEnd: "5" };     // przyciecie = po yt-dlp musialby wystartowac ffmpeg

// czeka, az wisi uruchomienie numer hangOn, i zwraca stan sprzed zerwania polaczenia
async function waitForHangingStep(state, hangOn) {
    await waitFor(() => readStarts(state.logPath).length >= hangOn, `uruchomienie numer ${hangOn}. Wyjscie:\n${state.output}`);

    const starts = readStarts(state.logPath);
    const hanging = starts[hangOn - 1];
    const jobIds = await activeJobIds(state);

    assert.equal(starts.length, hangOn);
    assert.equal(jobIds.length, 1, "w trakcie zadania w zbiorze ma byc jedno zadanie");
    assert.ok(hanging.grandchildPid > 0, "atrapa miala uruchomic proces potomny");
    assert.equal(isAlive(hanging.pid), true, "proces zadania mial dzialac przed zerwaniem polaczenia");
    assert.equal(isAlive(hanging.grandchildPid), true, "proces potomny mial dzialac przed zerwaniem polaczenia");

    return { hanging, jobId: jobIds[0] };
}

// sprawdza skutki anulowania wspolne dla wszystkich przebiegow
async function assertCancelled(state, hanging, jobId, expectedStarts) {
    await waitFor(() => !isAlive(hanging.pid), "koniec procesu zadania po zerwaniu polaczenia");
    await waitFor(() => !isAlive(hanging.grandchildPid), "koniec procesu potomnego po zerwaniu polaczenia");
    await waitFor(async () => (await activeJobIds(state)).length === 0, "znikniecie zadania ze zbioru zadan w toku");

    // zadanie zniknelo ze zbioru dopiero po przejsciu calego endpointu - zaden nastepny krok juz nie wystartuje
    assert.deepEqual(
        downloadsFiles(state).filter(name => name.includes(`[${jobId}]`)),
        [],
        "pliki anulowanego zadania mialy zniknac"
    );
    assert.deepEqual(fs.readdirSync(state.target), [], "UL-2b: anulowane zadanie nie zostawia niczego w folderze docelowym");
    assert.equal(readStarts(state.logPath).length, expectedStarts, "po anulowaniu wystartowal nastepny program");
    assert.deepEqual(cancelLines(state), [`Zadanie ${jobId} anulowane — strona zamknęła połączenie.`]);
}

// ======================================================================================
// Czesc 1: caly przebieg na prawdziwych procesach
// ======================================================================================

test("BUG-2: zerwanie polaczenia w trakcie yt-dlp zabija proces i jego proces potomny, usuwa pliki, nie uruchamia ffmpeg", { timeout: 60000 }, async (t) => {
    const state = await startCancelServer(t, 1);
    const otherFile = path.join(state.downloads, "Inny film [zzzz9999].mp3");

    fs.writeFileSync(otherFile, "x");

    const request = openDownloadRequest(state, { url: videoUrl, type: "audio", format: "mp3", bitrate: "best", experimental: trimmed });
    const { hanging, jobId } = await waitForHangingStep(state, 1);

    assert.deepEqual(downloadsFiles(state), [`Film [${jobId}].mp3.part`, "Inny film [zzzz9999].mp3"]);

    request.destroy();

    await assertCancelled(state, hanging, jobId, 1);

    assert.deepEqual(downloadsFiles(state), ["Inny film [zzzz9999].mp3"], "plik innego zadania mial zostac");
    assert.deepEqual(request.responses, [], "anulowane zadanie nie wysyla odpowiedzi");

    // serwer dziala dalej: nastepne zadanie przechodzi normalnie (uruchomienia 2 i 3 atrapy koncza sie od razu)
    const { status, json } = await postDownload(state, { url: videoUrl, type: "audio", format: "mp3", bitrate: "best", experimental: trimmed });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(readStarts(state.logPath).length, 3, "po yt-dlp mial wystartowac ffmpeg (przyciecie)");
    assert.equal(cancelLines(state).length, 1, "zwykle zakonczone zadanie nie moze byc anulowane");
});

test("BUG-2: zerwanie polaczenia w trakcie ffmpeg (tryb osobno) usuwa pobrane pliki i plik tmp-, czwarty program nie startuje", { timeout: 60000 }, async (t) => {
    const state = await startCancelServer(t, 3);
    const request = openDownloadRequest(state, { url: videoUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: trimmed });
    const { hanging, jobId } = await waitForHangingStep(state, 3);

    assert.match(hanging.program, /^ffmpeg/, "trzecie uruchomienie w trybie osobno to ffmpeg");
    assert.deepEqual(downloadsFiles(state), [
        `Film audio [${jobId}].mp3`,
        `Film video [${jobId}].mp4`,
        `tmp-Film video [${jobId}].mp4`
    ]);

    request.destroy();

    await assertCancelled(state, hanging, jobId, 3);

    assert.deepEqual(downloadsFiles(state), []);
    assert.deepEqual(request.responses, []);
});

test("BUG-2: zerwanie polaczenia w trakcie drugiego yt-dlp (tryb osobno) usuwa tez plik z pierwszego kroku, ffmpeg nie startuje", { timeout: 60000 }, async (t) => {
    const state = await startCancelServer(t, 2);
    const request = openDownloadRequest(state, { url: videoUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects });
    const { hanging, jobId } = await waitForHangingStep(state, 2);

    assert.deepEqual(downloadsFiles(state), [`Film audio [${jobId}].mp3.part`, `Film video [${jobId}].mp4`]);

    request.destroy();

    await assertCancelled(state, hanging, jobId, 2);

    assert.deepEqual(downloadsFiles(state), []);
});

// UL-2b: gotowe pliki nie zostaja juz w downloads - sa przenoszone do folderu docelowego z zadania
test("BUG-2: zadanie zakonczone normalnie nie jest anulowane - odpowiedz przychodzi, pliki zostaja (w folderze docelowym)",{ timeout: 60000 }, async (t) => {
    const state = await startCancelServer(t, 0);
    const { status, json } = await postDownload(state, { url: videoUrl, type: "separate", format: "mp4", resolution: "720", bitrate: "best", experimental: noEffects });

    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.success, true);
    assert.equal(readStarts(state.logPath).length, 3, "dwa razy yt-dlp i raz ffmpeg");

    // polaczenie zamyka sie juz po wyslaniu odpowiedzi - to nie jest anulowanie
    await sleep(300);

    assert.deepEqual(await activeJobIds(state), []);
    assert.equal(fs.readdirSync(state.target).length, 2, "gotowe pliki mialy zostac");
    assert.deepEqual(fs.readdirSync(state.target).sort(), json.files.map(file => file.name).sort());
    assert.deepEqual(json.files.map(file => file.path), json.files.map(file => path.join(state.target, file.name)));
    assert.deepEqual(downloadsFiles(state), [], "po przeniesieniu w folderze roboczym nic nie zostaje");
    assert.deepEqual(cancelLines(state), []);
});

// ======================================================================================
// Czesc 2: pojedyncze funkcje
// ======================================================================================

// osobna kopia app.js z podmienionym spawn
function loadAppWithSpawn(spawnImpl) {
    const originalSpawn = childProcess.spawn;

    childProcess.spawn = spawnImpl;
    delete require.cache[require.resolve(appPath)];

    try {
        return require(appPath);
    } finally {
        childProcess.spawn = originalSpawn;
        delete require.cache[require.resolve(appPath)];
    }
}

function fakeChild(pid) {
    const child = new EventEmitter();

    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.pid = pid;
    child.killCalls = [];
    child.kill = (signal) => { child.killCalls.push(signal); };

    return child;
}

function muteConsole(t) {
    const lines = [];

    t.mock.method(console, "log", (...args) => { lines.push(args.join(" ")); });
    t.mock.method(console, "error", () => {});

    return lines;
}

const baseApp = require(appPath);

// ---------- buildSpawnOptions ----------

test("BUG-2: buildSpawnOptions - na Windowsie bez opcji, na macOS i Linuksie proces jest liderem wlasnej grupy", () => {
    assert.deepEqual(baseApp.buildSpawnOptions("win32"), {});
    assert.deepEqual(baseApp.buildSpawnOptions("darwin"), { detached: true });
    assert.deepEqual(baseApp.buildSpawnOptions("linux"), { detached: true });
    assert.deepEqual(baseApp.buildSpawnOptions(), baseApp.buildSpawnOptions(process.platform));
});

for (const [platform, expected] of [["win32", {}], ["linux", { detached: true }], ["darwin", { detached: true }]]) {
    test(`BUG-2: runProcess uruchamia program z opcjami dla systemu ${platform}`, { timeout: 10000 }, async (t) => {
        muteConsole(t);

        const calls = [];
        const appModule = loadAppWithSpawn((command, args, options) => {
            const child = fakeChild(undefined);

            calls.push({ command, args, options });
            setImmediate(() => child.emit("close", 0));

            return child;
        });
        const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");

        Object.defineProperty(process, "platform", { value: platform });
        t.after(() => Object.defineProperty(process, "platform", originalPlatform));

        await appModule.runProcess("program", ["a", "b"], "TEST");

        assert.equal(calls.length, 1);
        assert.equal(calls[0].command, "program");
        assert.deepEqual(calls[0].args, ["a", "b"]);
        assert.deepEqual(calls[0].options, expected);
    });
}

// ---------- killProcessTree ----------

test("BUG-2: killProcessTree na Windowsie uruchamia taskkill /pid <pid> /T /F i nie wysyla sygnalow", () => {
    const spawnCalls = [];
    const killCalls = [];
    const child = fakeChild(4321);

    baseApp.killProcessTree(child, {
        platform: "win32",
        spawnImpl: (command, args) => {
            spawnCalls.push([command, args]);

            return new EventEmitter();
        },
        killImpl: (...args) => { killCalls.push(args); }
    });

    assert.deepEqual(spawnCalls, [["taskkill", ["/pid", "4321", "/T", "/F"]]]);
    assert.deepEqual(killCalls, []);
    assert.deepEqual(child.killCalls, [], "gdy taskkill dziala, child.kill() nie jest potrzebne");
});

test("BUG-2: killProcessTree na Windowsie - gdy taskkill nie da sie uruchomic, zabijany jest chociaz sam proces", () => {
    const failingLater = fakeChild(11);
    const killer = new EventEmitter();

    baseApp.killProcessTree(failingLater, { platform: "win32", spawnImpl: () => killer });
    killer.emit("error", new Error("spawn taskkill ENOENT"));

    assert.deepEqual(failingLater.killCalls, [undefined]);

    const failingAtOnce = fakeChild(12);

    baseApp.killProcessTree(failingAtOnce, {
        platform: "win32",
        spawnImpl: () => { throw new Error("spawn EINVAL"); }
    });

    assert.deepEqual(failingAtOnce.killCalls, [undefined]);
});

for (const platform of ["linux", "darwin"]) {
    test(`BUG-2: killProcessTree na ${platform} wysyla SIGTERM do grupy, a po chwili SIGKILL, jesli cos jeszcze zyje`, async () => {
        const killCalls = [];
        const spawnCalls = [];

        baseApp.killProcessTree(fakeChild(4321), {
            platform,
            graceMs: 30,
            spawnImpl: (...args) => { spawnCalls.push(args); },
            killImpl: (pid, signal) => { killCalls.push([pid, signal]); }
        });

        assert.deepEqual(killCalls, [[-4321, "SIGTERM"]], "SIGKILL nie moze pojsc od razu");

        await sleep(150);

        assert.deepEqual(killCalls, [[-4321, "SIGTERM"], [-4321, 0], [-4321, "SIGKILL"]]);
        assert.deepEqual(spawnCalls, [], "taskkill jest tylko na Windowsie");
    });
}

test("BUG-2: killProcessTree poza Windowsem nie wysyla SIGKILL, gdy grupa procesow juz nie istnieje", async () => {
    const killCalls = [];

    baseApp.killProcessTree(fakeChild(77), {
        platform: "linux",
        graceMs: 20,
        killImpl: (pid, signal) => {
            killCalls.push([pid, signal]);

            if (signal === 0) {
                throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
            }
        }
    });

    await sleep(120);

    assert.deepEqual(killCalls, [[-77, "SIGTERM"], [-77, 0]]);

    // grupy nie ma juz przy SIGTERM: nic wiecej sie nie dzieje i nie ma wyjatku
    const callsWhenGone = [];

    assert.doesNotThrow(() => baseApp.killProcessTree(fakeChild(78), {
        platform: "linux",
        graceMs: 20,
        killImpl: (pid, signal) => {
            callsWhenGone.push([pid, signal]);

            throw Object.assign(new Error("kill ESRCH"), { code: "ESRCH" });
        }
    }));

    await sleep(120);

    assert.deepEqual(callsWhenGone, [[-78, "SIGTERM"]]);
});

test("BUG-2: killProcessTree nic nie robi, gdy proces nie ma pid (nie wystartowal)", () => {
    const calls = [];
    const options = {
        spawnImpl: (...args) => { calls.push(args); return new EventEmitter(); },
        killImpl: (...args) => { calls.push(args); }
    };

    for (const platform of ["win32", "linux"]) {
        baseApp.killProcessTree(fakeChild(undefined), { ...options, platform });
        baseApp.killProcessTree(null, { ...options, platform });
    }

    assert.deepEqual(calls, []);
});

// ---------- cancelJob ----------

test("BUG-2: cancelJob ustawia znacznik i wypisuje jedna linie, drugie wywolanie nic nie robi", (t) => {
    const lines = muteConsole(t);
    const job = { jobId: "ab12cd34", process: null, cancelled: false };

    baseApp.cancelJob(job);
    baseApp.cancelJob(job);

    assert.equal(job.cancelled, true);
    assert.deepEqual(lines, ["Zadanie ab12cd34 anulowane — strona zamknęła połączenie."]);
});

// ---------- runProcess z obiektem zadania ----------

test("BUG-2: runProcess dla anulowanego zadania nie uruchamia programu", { timeout: 10000 }, async (t) => {
    muteConsole(t);

    let spawnCount = 0;
    const appModule = loadAppWithSpawn(() => {
        spawnCount += 1;

        return fakeChild(1);
    });
    const job = { jobId: "aaaa0001", process: null, cancelled: true };

    await assert.rejects(appModule.runProcess("program", [], "TEST", job), (error) => {
        assert.equal(error.cancelled, true);

        return true;
    });
    assert.equal(spawnCount, 0);
});

test("BUG-2: zadanie pamieta dzialajacy proces, a po jego koncu juz nie", { timeout: 10000 }, async (t) => {
    muteConsole(t);

    const children = [];
    const appModule = loadAppWithSpawn(() => {
        const child = fakeChild(undefined);

        children.push(child);

        return child;
    });
    const job = { jobId: "aaaa0002", process: null, cancelled: false };
    const running = appModule.runProcess("program", [], "TEST", job);

    assert.equal(job.process, children[0], "w trakcie pracy zadanie ma wskazywac swoj proces");

    children[0].emit("close", 0);

    assert.deepEqual(await running, { errorOutput: "" });
    assert.equal(job.process, null);
});

test("BUG-2: proces zakonczony po anulowaniu daje blad anulowania, takze gdy skonczyl sie kodem 0 albo bledem", { timeout: 10000 }, async (t) => {
    muteConsole(t);

    const children = [];
    const appModule = loadAppWithSpawn(() => {
        const child = fakeChild(undefined);

        children.push(child);

        return child;
    });

    for (const finish of [
        child => child.emit("close", 0),
        child => child.emit("close", 1),
        child => child.emit("close", null),
        child => child.emit("error", Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))
    ]) {
        const job = { jobId: "aaaa0003", process: null, cancelled: false };
        const running = appModule.runProcess("program", [], "TEST", job);
        const child = children[children.length - 1];

        job.cancelled = true;
        finish(child);

        await assert.rejects(running, (error) => {
            assert.equal(error.cancelled, true);

            return true;
        });
        assert.equal(job.process, null);
    }
});

test("BUG-2: bez obiektu zadania runProcess dziala jak dotad (wynik i blad bez zmian)", { timeout: 10000 }, async (t) => {
    muteConsole(t);

    const children = [];
    const appModule = loadAppWithSpawn(() => {
        const child = fakeChild(undefined);

        children.push(child);

        return child;
    });

    const ok = appModule.runProcess("program", [], "TEST");

    children[0].emit("close", 0);
    assert.deepEqual(await ok, { errorOutput: "" });

    const failed = appModule.runProcess("program", [], "TEST");

    children[1].stderr.emit("data", Buffer.from("ERROR: cos poszlo zle\n"));
    children[1].emit("close", 1);

    await assert.rejects(failed, (error) => {
        assert.equal(error.message, "TEST: cos poszlo zle");
        assert.equal(error.cancelled, undefined);

        return true;
    });
});

// ---------- removeJobFiles ----------

function makeTempDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-bug2-pliki-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

function busyError(filePath) {
    return Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${filePath}'`), { code: "EBUSY" });
}

test("BUG-2: removeJobFiles usuwa wszystkie pliki zadania (.part, oryginal, tmp-, wynik) i tylko je", async (t) => {
    muteConsole(t);

    const dir = makeTempDir(t);
    const jobFiles = [
        "Film video [ab12cd34].f137.mp4.part",
        "Film audio [ab12cd34].mp3",
        "tmp-Film video [ab12cd34].mp4",
        "Film [ab12cd34].mkv"
    ];
    const otherFiles = ["Film [ff99ee88].mp4", "Film ab12cd34.mp4", "Film [ab12cd3].mp4"];

    for (const name of [...jobFiles, ...otherFiles]) {
        fs.writeFileSync(path.join(dir, name), "x");
    }

    fs.mkdirSync(path.join(dir, "podfolder"));

    const left = await baseApp.removeJobFiles("ab12cd34", dir, { delayMs: 1 });

    assert.deepEqual(left, []);
    assert.deepEqual(fs.readdirSync(dir).sort(), [...otherFiles, "podfolder"].sort());
});

test("BUG-2: removeJobFiles ponawia usuwanie zablokowanego pliku po przerwie", async (t) => {
    muteConsole(t);

    const dir = makeTempDir(t);
    const locked = path.join(dir, "Film [ab12cd34].mp4.part");
    const free = path.join(dir, "Film [ab12cd34].mp3");

    fs.writeFileSync(locked, "x");
    fs.writeFileSync(free, "x");

    const originalUnlinkSync = fs.unlinkSync;
    let lockedAttempts = 0;

    t.mock.method(fs, "unlinkSync", (filePath) => {
        if (filePath === locked) {
            lockedAttempts += 1;

            if (lockedAttempts <= 2) {
                throw busyError(filePath);
            }
        }

        return originalUnlinkSync(filePath);
    });

    const startedAt = Date.now();
    const left = await baseApp.removeJobFiles("ab12cd34", dir, { attempts: 5, delayMs: 40 });

    assert.deepEqual(left, []);
    assert.equal(lockedAttempts, 3, "plik mial byc usuniety za trzecim podejsciem");
    assert.ok(Date.now() - startedAt >= 70, "miedzy podejsciami ma byc przerwa");
    assert.equal(fs.existsSync(locked), false);
    assert.equal(fs.existsSync(free), false);
});

test("BUG-2: removeJobFiles - plik zablokowany na stale zostaje dla zwyklego sprzatania, bez wyjatku", async (t) => {
    const lines = muteConsole(t);
    const dir = makeTempDir(t);
    const locked = path.join(dir, "Film [ab12cd34].mp4.part");

    fs.writeFileSync(locked, "x");

    let attempts = 0;

    t.mock.method(fs, "unlinkSync", (filePath) => {
        attempts += 1;

        throw busyError(filePath);
    });

    const left = await baseApp.removeJobFiles("ab12cd34", dir, { attempts: 3, delayMs: 1 });

    assert.deepEqual(left, ["Film [ab12cd34].mp4.part"]);
    assert.equal(attempts, 3);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /ab12cd34/);
});

test("BUG-2: removeJobFiles - plik, ktory zniknal w miedzyczasie, i brak folderu nie sa bledem", async (t) => {
    muteConsole(t);

    const dir = makeTempDir(t);

    t.mock.method(fs, "unlinkSync", (filePath) => {
        throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${filePath}'`), { code: "ENOENT" });
    });

    fs.writeFileSync(path.join(dir, "Film [ab12cd34].mp3"), "x");

    assert.deepEqual(await baseApp.removeJobFiles("ab12cd34", dir, { attempts: 2, delayMs: 1 }), []);
    assert.deepEqual(await baseApp.removeJobFiles("ab12cd34", path.join(dir, "nie-ma-takiego"), { attempts: 2, delayMs: 1 }), []);
});

test("BUG-2: bez podanego folderu removeJobFiles sprzata folder downloads obok app.js", async (t) => {
    muteConsole(t);

    const seen = [];

    t.mock.method(fs, "readdirSync", (dirPath) => {
        seen.push(dirPath);

        return [];
    });

    await baseApp.removeJobFiles("ab12cd34");

    assert.deepEqual(seen, [path.join(projectDir, "downloads")]);
});
