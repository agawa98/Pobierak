// Sprawdzenie zadania B13a w przegladarce (Edge przez playwright-core): linie postepu wyslane przez backend
// pojawiaja sie w tle strony (#terminalLogs) jako osobne wiersze.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 (np. font z Google) sa odcinane, a logi wysyla sam test.

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

// teksty wszystkich wierszy tla
function readLogLines(page) {
    return page.$$eval("#terminalLogs p", rows => rows.map(row => row.textContent));
}

test("B13a: linie postepu [download] NN% z jednej porcji wyjscia yt-dlp to osobne wiersze w tle strony", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await browser.newPage();
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        await page.route("**/*", (route) => {
            if (route.request().url().startsWith(baseUrl)) {
                return route.continue();
            }

            return route.abort();
        });

        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

        // strona jest podlaczona do logow, gdy pokaze powitanie z backendu
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent.includes("Połączono z logami backendu.")));

        // jedna porcja z trzema liniami (\n), potem porcja z \r\n i samym \r
        appModule.sendLogToClients("YT-DLP",
            "[download]  10.0% of    5.00MiB at  1.00MiB/s ETA 00:04\n"
            + "[download]  55.5% of    5.00MiB at  2.00MiB/s ETA 00:01\n"
            + "[download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s\n");
        appModule.sendLogToClients("FFMPEG", "frame=   10 fps=0.0\rframe=   20 fps=0.0\r\nkoniec ffmpeg");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent.includes("koniec ffmpeg")));

        const lines = await readLogLines(page);
        const start = lines.findIndex(line => line.includes("10.0%"));

        assert.notEqual(start, -1, `brak linii postepu w tle: ${JSON.stringify(lines)}`);

        assert.deepEqual(lines.slice(start), [
            "[YT-DLP] [download]  10.0% of    5.00MiB at  1.00MiB/s ETA 00:04",
            "[YT-DLP] [download]  55.5% of    5.00MiB at  2.00MiB/s ETA 00:01",
            "[YT-DLP] [download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s",
            "[FFMPEG] frame=   10 fps=0.0",
            "[FFMPEG] frame=   20 fps=0.0",
            "[FFMPEG] koniec ffmpeg"
        ]);

        // w zadnym wierszu nie ma juz tekstu \n ani znaku konca linii
        for (const line of lines) {
            assert.equal(line.includes("\\n"), false, `wiersz zawiera tekst \\n: ${line}`);
            assert.equal(/[\r\n]/.test(line), false, `wiersz zawiera znak konca linii: ${JSON.stringify(line)}`);
        }
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
