// Sprawdzenie zadania U2 w przegladarce (Edge przez playwright-core): postep na przycisku "Pobierz".
// Linie logow sa wysylane przez prawdziwy serwer programu (sendLogToClients -> /api/logs -> strona),
// a odpowiedz /api/download podstawia test i trzyma ja do chwili release().
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

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

// otwiera strone. zadania do /api/download nie trafiaja do programu: czekaja na release() i dostaja odpowiedz testowa
async function openPage(browser, server, { status = 200, body = { success: true, message: "Pobrano (odpowiedz testowa)." } } = {}) {
    const page = await browser.newPage();
    // UL-2c: bez wybranego folderu przycisk "Pobierz" jest wylaczony; folder jest zapamietany jak po wyborze
    await page.addInitScript(() => localStorage.setItem("pobierak.folderDocelowy", "C:\\Pobrane"));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    let release;
    let released = new Promise((resolve) => { release = resolve; });

    await page.route("**/*", async (route) => {
        const url = route.request().url();

        if (url === `${baseUrl}/api/download`) {
            await released;

            return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        }

        if (url.startsWith(baseUrl)) {
            return route.continue();
        }

        return route.abort();
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // strona jest polaczona z logami dopiero wtedy, gdy w tle jest powitanie z backendu
    await waitForLog(page, "[system] Połączono z logami backendu.");

    // zapisuje kazdy napis, jaki pojawil sie na przycisku
    await page.evaluate(() => {
        const label = document.querySelector(".button-text");

        window.buttonTexts = [];

        new MutationObserver(() => {
            const text = label.textContent;

            if (window.buttonTexts[window.buttonTexts.length - 1] !== text) {
                window.buttonTexts.push(text);
            }
        }).observe(label, { childList: true, characterData: true, subtree: true });
    });

    return {
        page,
        release: () => release(),
        // nastepne zadanie /api/download znowu czeka
        hold: () => { released = new Promise((resolve) => { release = resolve; }); }
    };
}

function waitForLog(page, line) {
    return page.waitForFunction(expected => Array.from(document.querySelectorAll("#terminalLogs p"))
        .some(row => row.textContent === expected), line);
}

function buttonText(page) {
    return page.textContent(".button-text");
}

// wysyla linie przez serwer i czeka, az strona ja odbierze (pojawi sie w tle)
async function sendLine(page, type, line) {
    appModule.sendLogToClients(type, `${line}\n`);
    await waitForLog(page, `[${type}] ${line.trim()}`);
}

async function clickDownload(page) {
    await page.fill("#url", "https://www.youtube.com/shorts/jBoKCUKJkiY");
    await page.click("#downloadButton");
    await page.waitForFunction(() => document.querySelector("#downloadButton").disabled);
}

const progressLine = (percent) => `[download] ${String(percent).padStart(5)}% of    5.00MiB at    2.00MiB/s ETA 00:01`;

test("U2: procent na przycisku rosnie, ffmpeg daje Przetwarzam..., po zakonczeniu wraca Pobierz", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, release, hold } = await openPage(browser, server);

        // przed pobieraniem linia postepu nie rusza przycisku
        await sendLine(page, "YT-DLP AUDIO", progressLine("11.0"));
        assert.equal(await buttonText(page), "Pobierz");

        await clickDownload(page);
        assert.equal(await buttonText(page), "Pobieram...");

        await sendLine(page, "YT-DLP AUDIO", "[youtube] jBoKCUKJkiY: Downloading webpage");
        assert.equal(await buttonText(page), "Pobieram...");

        await sendLine(page, "YT-DLP AUDIO", progressLine("0.4"));
        assert.equal(await buttonText(page), "Pobieram... 0%");

        await sendLine(page, "YT-DLP AUDIO", progressLine("45.9"));
        assert.equal(await buttonText(page), "Pobieram... 45%");

        await sendLine(page, "YT-DLP AUDIO", "[download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s");
        assert.equal(await buttonText(page), "Pobieram... 100%");

        // przycisk dalej jest zablokowany i ma kolko ladowania
        assert.equal(await page.isDisabled("#downloadButton"), true);
        assert.equal(await page.evaluate(() => document.querySelector(".button-loader").classList.contains("hidden")), false);

        await sendLine(page, "FFMPEG", "size=     512KiB time=00:00:21.84 bitrate= 192.0kbits/s speed=43.6x");
        assert.equal(await buttonText(page), "Przetwarzam...");

        release();
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);
        assert.equal(await buttonText(page), "Pobierz");

        // spozniona linia po zakonczeniu nie zmienia napisu
        await sendLine(page, "YT-DLP AUDIO", progressLine("99.0"));
        await sendLine(page, "FFMPEG", "size=    1024KiB time=00:00:33.00 bitrate= 192.0kbits/s speed=44.0x");
        assert.equal(await buttonText(page), "Pobierz");

        assert.deepEqual(await page.evaluate(() => window.buttonTexts), [
            "Pobieram...",
            "Pobieram... 0%",
            "Pobieram... 45%",
            "Pobieram... 100%",
            "Przetwarzam...",
            "Pobierz"
        ]);

        // drugie pobranie zaczyna od samego "Pobieram..."
        hold();
        await clickDownload(page);
        assert.equal(await buttonText(page), "Pobieram...");

        await sendLine(page, "YT-DLP AUDIO", progressLine("62.5"));
        assert.equal(await buttonText(page), "Pobieram... 62%");

        release();
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);
        assert.equal(await buttonText(page), "Pobierz");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

// program dzis nie pobiera wycinkow przez yt-dlp (po B11 tnie ffmpeg po pobraniu calosci); tu chodzi o sama regule
test("U2: gdy w logach nie ma linii z procentem, na przycisku zostaje Pobieram...", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, release } = await openPage(browser, server);

        await page.click("#experimentalToggle");
        await page.fill("#trimStart", "5");
        await page.fill("#trimEnd", "12");
        await clickDownload(page);

        await sendLine(page, "YT-DLP AUDIO", "[download] Destination: the #1 NO SCOPE player in rivals [0a1b2c3d].webm");
        await sendLine(page, "YT-DLP AUDIO", "size=     128KiB time=00:00:07.00 bitrate= 149.8kbits/s speed=12.1x");
        await sendLine(page, "YT-DLP AUDIO", "[download] 131.07KiB at  1.52MiB/s (00:00:02)");

        assert.equal(await buttonText(page), "Pobieram...");

        release();
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        assert.deepEqual(await page.evaluate(() => window.buttonTexts), ["Pobieram...", "Pobierz"]);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("U2: po bledzie serwera napis wraca do Pobierz i spoznione linie go nie zmieniaja", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, release } = await openPage(browser, server, {
            status: 500,
            body: { success: false, message: "YT-DLP AUDIO: ERROR: Video unavailable" }
        });

        await clickDownload(page);
        await sendLine(page, "YT-DLP AUDIO", progressLine("33.3"));
        assert.equal(await buttonText(page), "Pobieram... 33%");

        release();
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);
        assert.equal(await buttonText(page), "Pobierz");

        await sendLine(page, "YT-DLP AUDIO", progressLine("34.0"));
        await sendLine(page, "FFMPEG VIDEO ONLY", "frame=  990 fps=0.0 q=-1.0 Lsize=   20647KiB time=00:00:32.96 speed= 512x");
        assert.equal(await buttonText(page), "Pobierz");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
