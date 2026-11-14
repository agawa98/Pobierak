// Robi zrzut ekranu dzialajacej strony do README (zadanie G2): docs/zrzut-ekranu.png.
// Uruchamianie: node testy/przegladarka/zrzut-readme.js. Wymaga przegladarki Edge (playwright-core).
// To nie jest test - plik celowo nie ma koncowki .przegladarka.js, wiec "npm run test:przegladarka" go nie uruchamia.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane, a linie w tle wysyla sam skrypt.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));
const outputPath = path.join(__dirname, "..", "..", "docs", "zrzut-ekranu.png");

// linie w tle wygladaja jak przy prawdziwym pobieraniu (takie same wypisuje yt-dlp)
const sampleLogs = [
    ["YT-DLP AUDIO", "[youtube] Extracting URL: https://www.youtube.com/shorts/jBoKCUKJkiY"],
    ["YT-DLP AUDIO", "[youtube] jBoKCUKJkiY: Downloading webpage"],
    ["YT-DLP AUDIO", "[info] jBoKCUKJkiY: Downloading 1 format(s): 251"],
    ["YT-DLP AUDIO", "[download]   0.2% of  512.31KiB at  251.42KiB/s ETA 00:02"],
    ["YT-DLP AUDIO", "[download]  45.1% of  512.31KiB at    1.92MiB/s ETA 00:00"],
    ["YT-DLP AUDIO", "[download] 100% of  512.31KiB in 00:00:00 at 2.31MiB/s"],
    ["YT-DLP AUDIO", "[ExtractAudio] Destination: the #1 NO SCOPE player in rivals [1a2b3c4d].mp3"]
];

async function main() {
    const server = await new Promise((resolve, reject) => {
        const started = appModule.app.listen(0, "127.0.0.1", () => resolve(started));
        started.on("error", reject);
    });

    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

        await page.route("**/*", route => (route.request().url().startsWith(baseUrl) ? route.continue() : route.abort()));

        await page.goto(baseUrl, { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);

        await page.fill("#url", "https://www.youtube.com/shorts/jBoKCUKJkiY");
        await page.click("#experimentalToggle");
        await page.fill("#trimStart", "0:05");
        await page.fill("#trimEnd", "0:12");

        // czekamy na polaczenie strony z logami, dopiero potem wysylamy linie
        await page.waitForFunction(() => document.querySelector("#terminalLogs").textContent.includes("Połączono"));
        sampleLogs.forEach(([type, message]) => appModule.sendLogToClients(type, message));
        await page.waitForFunction(() => document.querySelector("#terminalLogs").textContent.includes("ExtractAudio"));

        await page.waitForTimeout(1000);     // panel EXPERIMENTAL wysuwa sie z animacja

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        await page.screenshot({ path: outputPath });

        console.log("Zapisano:", outputPath);
    } finally {
        await browser.close();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
