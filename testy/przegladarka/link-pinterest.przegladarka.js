// Sprawdzenie zadania UL-8b w przegladarce (Edge przez playwright-core): link do tablicy, profilu, wyszukiwania albo
// strony glownej Pinteresta daje blad pod polem linku od razu po wpisaniu, a klik Pobierz nie wysyla zadania /api/download.
// Link do pina (takze z hostem krajowym i pin.it) jest przyjety. Podpowiedz w polu linku bez zmian.
// Uruchamianie: npm run test:przegladarka. Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane,
// a odpowiedz /api/download podstawia test.

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

async function openPage(browser, server) {
    const page = await browser.newPage();
    // UL-2c: bez wybranego folderu przycisk "Pobierz" jest wylaczony; folder jest zapamietany jak po wyborze
    await page.addInitScript(() => localStorage.setItem("pobierak.folderDocelowy", "C:\\Pobrane"));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const pageErrors = [];
    const downloadRequests = [];

    page.on("pageerror", error => pageErrors.push(String(error)));

    await page.route("**/*", (route) => {
        const url = route.request().url();

        if (url === `${baseUrl}/api/download`) {
            downloadRequests.push(route.request().postDataJSON());

            return route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true, message: "Pobrano (odpowiedz testowa)." })
            });
        }

        if (url.startsWith(baseUrl)) {
            return route.continue();
        }

        return route.abort();
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    return { page, pageErrors, downloadRequests };
}

// wpisuje link znak po znaku (prawdziwe zdarzenia input, jak przy pisaniu) i zwraca komunikat spod pola linku
async function typeUrl(page, url) {
    await page.fill("#url", "");
    await page.type("#url", url);

    return page.$eval("#urlValidation", box => ({ text: box.textContent, isError: box.classList.contains("is-error") }));
}

// podpowiedz z public/index.html sprzed UL-8b
const PLACEHOLDER = "https://...";

const NOT_PIN = "To nie jest link do pina. Wklej link do jednego pina z filmem.";

test("UL-8b: komunikat Pinteresta pod polem linku, klik Pobierz z tablica nie wysyla zadania, z pinem - wysyla", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors, downloadRequests } = await openPage(browser, server);
        const ok = { text: "", isError: false };

        // podpowiedz w polu linku bez zmian
        assert.equal(await page.getAttribute("#url", "placeholder"), PLACEHOLDER);

        assert.deepEqual(await typeUrl(page, "https://pl.pinterest.com/uzytkownik/tablica/"), { text: NOT_PIN, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.pinterest.com/uzytkownik/"), { text: NOT_PIN, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.pinterest.com/search/pins/?q=kot"), { text: NOT_PIN, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.pinterest.co.uk/"), { text: NOT_PIN, isError: true });

        assert.deepEqual(await typeUrl(page, "https://pl.pinterest.com/pin/1028720739878379354/"), ok);
        assert.deepEqual(await typeUrl(page, "https://pinterest.co.uk/pin/1028720739878379354/"), ok);
        assert.deepEqual(await typeUrl(page, "https://pin.it/5RNR5E4PX"), ok);
        assert.deepEqual(await typeUrl(page, "https://pinterest.com.example.org/uzytkownik/tablica/"), ok);

        // klik Pobierz z linkiem do tablicy: blad w logu, bez zadania do serwera
        await page.fill("#url", "https://pl.pinterest.com/uzytkownik/tablica/");
        await page.click("#downloadButton");

        await page.waitForFunction((message) => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === `[error] ${message}`), NOT_PIN);

        assert.equal(downloadRequests.length, 0);
        assert.equal(await page.textContent("#statusBox"), NOT_PIN);

        await page.fill("#url", "https://pl.pinterest.com/pin/1028720739878379354/");
        assert.equal(await page.textContent("#urlValidation"), "");

        await page.click("#downloadButton");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].url, "https://pl.pinterest.com/pin/1028720739878379354/");
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
