// Sprawdzenie zadania B13d w przegladarce (Edge przez playwright-core): po zatrzymaniu serwera w tle strony
// pojawia sie jedna linia "Utracono połączenie z logami backendu.", a nie kolejna co kilka sekund;
// po ponownym starcie serwera logi wracaja, a nastepna utrata znowu daje jedna linie.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.
// Trwa okolo pol minuty, bo czeka na kilka ponowionych prob polaczenia (przegladarka ponawia co ok. 3 s).

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

const LOST = "Utracono połączenie z logami backendu.";
const CONNECTED = "Połączono z logami backendu.";

function startServer(port) {
    return new Promise((resolve, reject) => {
        const server = appModule.app.listen(port, "127.0.0.1", () => resolve(server));
        server.on("error", reject);
    });
}

function stopServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

// ile wierszy w tle strony zawiera podany tekst
function countLines(page, text) {
    return page.$$eval("#terminalLogs p", (rows, wanted) => rows.filter(row => row.textContent.includes(wanted)).length, text);
}

function waitForLines(page, text, count) {
    return page.waitForFunction(([wanted, minimum]) => Array.from(document.querySelectorAll("#terminalLogs p"))
        .filter(row => row.textContent.includes(wanted)).length >= minimum, [text, count], { timeout: 30000 });
}

test("B13d: zatrzymanie serwera daje jedna linie o utracie polaczenia, po starcie logi wracaja", { timeout: 120000 }, async () => {
    let server = await startServer(0);
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await browser.newPage();
        const logRequests = [];   // chwile kolejnych prob polaczenia z /api/logs

        await page.route("**/*", (route) => {
            const url = route.request().url();

            if (url.startsWith(`${baseUrl}/api/logs`)) {
                logRequests.push(Date.now());
            }

            return url.startsWith(baseUrl) ? route.continue() : route.abort();
        });

        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        await waitForLines(page, CONNECTED, 1);

        assert.equal(await countLines(page, LOST), 0, "przy dzialajacym serwerze nie ma komunikatu o utracie");

        // 1. zatrzymanie serwera
        await stopServer(server);
        server = null;

        await waitForLines(page, LOST, 1);

        // czekamy, az przegladarka kilka razy ponowi polaczenie (kazda nieudana proba to kolejny onerror)
        const requestsAtStop = logRequests.length;
        const deadline = Date.now() + 40000;

        while (logRequests.length < requestsAtStop + 3 && Date.now() < deadline) {
            await page.waitForTimeout(500);
        }

        // chwila, zeby ostatnia proba zdazyla sie nie udac
        await page.waitForTimeout(1500);

        assert.ok(logRequests.length >= requestsAtStop + 3,
            `przegladarka miala ponowic polaczenie co najmniej 3 razy, ponowila ${logRequests.length - requestsAtStop}`);
        assert.equal(await countLines(page, LOST), 1, "po kilku nieudanych probach ma byc jedna linia o utracie polaczenia");

        const lostLine = await page.$$eval("#terminalLogs p", (rows, wanted) => rows
            .filter(row => row.textContent.includes(wanted)).map(row => row.textContent), LOST);

        assert.deepEqual(lostLine, [`[error] ${LOST}`]);

        // 2. ponowny start na tym samym porcie: logi wracaja
        server = await startServer(port);

        await waitForLines(page, CONNECTED, 2);

        appModule.sendLogToClients("YT-DLP", "linia po ponownym starcie");
        await waitForLines(page, "linia po ponownym starcie", 1);

        assert.equal(await countLines(page, LOST), 1, "ponowne polaczenie nie dodaje komunikatu o utracie");

        // 3. druga utrata: flaga zostala wyzerowana, wiec komunikat pojawia sie znowu, i znowu tylko raz
        const requestsAtSecondStop = logRequests.length;

        await stopServer(server);
        server = null;

        await waitForLines(page, LOST, 2);

        const secondDeadline = Date.now() + 40000;

        while (logRequests.length < requestsAtSecondStop + 2 && Date.now() < secondDeadline) {
            await page.waitForTimeout(500);
        }

        await page.waitForTimeout(1500);

        assert.ok(logRequests.length >= requestsAtSecondStop + 2, "przegladarka miala ponowic polaczenie po drugiej utracie");
        assert.equal(await countLines(page, LOST), 2, "druga utrata ma dac dokladnie jedna nowa linie");
    } finally {
        await browser.close();

        if (server) {
            await stopServer(server);
        }
    }
});
