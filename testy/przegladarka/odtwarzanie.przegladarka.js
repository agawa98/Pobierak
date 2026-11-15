// Sprawdzenie zadania B12 w przegladarce (Edge przez playwright-core): plik wideo trybu "osobno" w mp4,
// przepakowany przez program (-c copy -an -movflags +faststart), odtwarza sie w elemencie <video> i da sie go przewijac.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: probke robi ffmpeg (generator), plik podaje maly serwer na 127.0.0.1 (express.static,
// tak samo jak program podaje folder downloads). Pliki robocze leza w os.tmpdir().

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");
const express = require("express");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));
const { playAndSeek } = require("./odtwarzanie-pomoc.js");

const FPS = 30;
const SECONDS = 10;
const CHANGE = 3;       // w 3. sekundzie probki obraz zmienia sie z czarnego na bialy

function makeDir(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-b12-przegladarka-"));

    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

    return dir;
}

// probka 10 s w H.264 bez dzwieku: czarna do 3 s, potem biala; klatka kluczowa co sekunde; indeks (moov) na koncu pliku
function makeSample(filePath) {
    const result = childProcess.spawnSync(appModule.ffmpegPath, [
        "-y", "-nostdin", "-v", "error",
        "-f", "lavfi", "-i", `color=c=black:s=160x120:r=${FPS}:d=${CHANGE}`,
        "-f", "lavfi", "-i", `color=c=white:s=160x120:r=${FPS}:d=${SECONDS - CHANGE}`,
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]", "-map", "[v]",
        "-c:v", "libx264", "-preset", "ultrafast", "-g", String(FPS), "-pix_fmt", "yuv420p", filePath
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
}

// serwer podajacy folder z plikami (z obsluga Range, potrzebna do przewijania) i pusta strone
function startFileServer(dir) {
    const server = express();

    server.get("/", (req, res) => res.type("html").send("<!doctype html><title>odtwarzanie</title><body></body>"));
    server.use("/downloads", express.static(dir));

    return new Promise((resolve, reject) => {
        const listening = server.listen(0, "127.0.0.1", () => resolve(listening));
        listening.on("error", reject);
    });
}

function stopServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

async function openPage(browser, server) {
    const page = await browser.newPage();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    await page.route("**/*", (route) => {
        if (route.request().url().startsWith(baseUrl)) {
            return route.continue();
        }

        return route.abort();
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    return page;
}

test("B12: przepakowany plik wideo trybu osobno (mp4) odtwarza sie w <video> i da sie przewijac w przod i w tyl", async (t) => {
    const dir = makeDir(t);
    const name = "probka #1 video [abcd1234].mp4";

    makeSample(path.join(dir, name));

    // ta sama droga co w programie: processDownloadedFile uruchamia prawdziwy ffmpeg
    const finalFile = await appModule.processDownloadedFile({
        generatedFile: name,
        experimental: { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart: "", trimEnd: "" },
        trimStartSeconds: null,
        trimEndSeconds: null,
        mediaType: "videoOnly",
        format: "mp4",
        bitrate: "best",
        dir
    });

    assert.equal(finalFile, name);

    const server = await startFileServer(dir);
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await openPage(browser, server);
        const result = await playAndSeek(page, `/downloads/${encodeURIComponent(finalFile)}`, [5, 1, 9, 2.5, 3.5]);

        assert.equal(result.error, null);
        assert.equal(result.width, 160);
        assert.equal(result.height, 120);
        assert.ok(Math.abs(result.duration - SECONDS) <= 0.05, `dlugosc ${result.duration}`);
        assert.ok(result.playedFromStart >= 0.5, `odtwarzanie od poczatku przesunelo czas o ${result.playedFromStart}`);
        assert.ok(Math.abs(result.seekableEnd - SECONDS) <= 0.05, `przewijac da sie do ${result.seekableEnd}`);

        // po przewinieciu czas jest tam, gdzie mial byc, a klatka jest ta wlasciwa: czarna przed 3. sekunda, biala po niej
        assert.equal(result.seeks.length, 5);

        for (const seek of result.seeks) {
            assert.ok(Math.abs(seek.currentTime - seek.asked) <= 0.05, `przewiniecie do ${seek.asked} dalo ${seek.currentTime}`);
            assert.ok(seek.readyState >= 2, `po przewinieciu do ${seek.asked} nie ma klatki (readyState ${seek.readyState})`);

            if (seek.asked < CHANGE) {
                assert.ok(seek.brightness < 40, `klatka z ${seek.asked} s ma byc czarna, jasnosc ${seek.brightness}`);
            } else {
                assert.ok(seek.brightness > 215, `klatka z ${seek.asked} s ma byc biala, jasnosc ${seek.brightness}`);
            }
        }

        assert.ok(result.playedAfterSeek >= 0.25, `odtwarzanie po przewinieciu przesunelo czas o ${result.playedAfterSeek}`);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B12: kontrola sprawdzenia - uszkodzony plik mp4 (sam poczatek pliku, bez indeksu) jest zglaszany jako blad", async (t) => {
    const dir = makeDir(t);
    const source = path.join(dir, "zrodlo.mp4");

    makeSample(source);

    // zrodlo ma indeks na koncu, wiec pierwsza polowa pliku nie da sie odtworzyc
    const data = fs.readFileSync(source);

    fs.writeFileSync(path.join(dir, "uciety.mp4"), data.subarray(0, Math.floor(data.length / 2)));

    const server = await startFileServer(dir);
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await openPage(browser, server);

        await assert.rejects(playAndSeek(page, "/downloads/uciety.mp4", [5]), /blad wideo/);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
