// Sprawdzenie zadania B13b w przegladarce (Edge przez playwright-core): po usunieciu martwej walidacji
// dlugosci filmu strona wczytuje sie bez bledow skryptu, a walidacja pol "Przytnij" dziala jak wczesniej.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane, a odpowiedz /api/download podstawia test.

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

// otwiera strone i zbiera bledy skryptu (np. ReferenceError po zostawionym odwolaniu do usunietej zmiennej)
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

// wpisuje czasy w oba pola (walidacja rusza na zdarzeniu "input") i zwraca komunikat spod pol
async function typeTrim(page, start, end) {
    await page.fill("#trimStart", start);
    await page.fill("#trimEnd", end);

    return page.$eval("#trimValidation", box => ({ text: box.textContent, isError: box.classList.contains("is-error") }));
}

test("B13b: strona nie ma zmiennej videoDurationSeconds i wczytuje sie bez bledow skryptu", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors } = await openPage(browser, server);

        assert.equal(await page.evaluate(() => typeof videoDurationSeconds), "undefined");
        assert.equal(await page.evaluate(() => typeof validateTrim), "function");
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B13b: walidacja pol Przytnij dziala jak wczesniej, takze dla bardzo dalekiego konca", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors } = await openPage(browser, server);
        const ok = { text: "", isError: false };

        for (const [start, end] of [["", ""], ["5", "12"], ["", "99:59:59"], ["10:00:00", "9999:59:59"], ["", "999999999"]]) {
            assert.deepEqual(await typeTrim(page, start, end), ok, `start "${start}", koniec "${end}"`);
        }

        assert.deepEqual(await typeTrim(page, "2:00", "1:00"), { text: "Początek musi być mniejszy niż koniec.", isError: true });
        assert.deepEqual(await typeTrim(page, "1:00", "1:00"), { text: "Początek musi być mniejszy niż koniec.", isError: true });
        assert.deepEqual(await typeTrim(page, "abc", ""), { text: "Użyj formatu GG:MM:SS", isError: true });
        assert.deepEqual(await typeTrim(page, "", "1:75"), { text: "Użyj formatu GG:MM:SS", isError: true });

        // po poprawce komunikat znika
        assert.deepEqual(await typeTrim(page, "1:00", "99:59:59"), ok);
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B13b: klik Pobierz z dalekim koncem przyciecia wysyla zadanie, z blednym - nie", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors, downloadRequests } = await openPage(browser, server);

        await page.fill("#url", "https://www.youtube.com/shorts/jBoKCUKJkiY");
        await page.fill("#trimStart", "2:00");
        await page.fill("#trimEnd", "1:00");
        await page.click("#downloadButton");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[error] Początek musi być mniejszy niż koniec."));

        assert.equal(downloadRequests.length, 0);

        await page.fill("#trimEnd", "99:59:59");
        await page.click("#downloadButton");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].experimental.trimStart, "2:00");
        assert.equal(downloadRequests[0].experimental.trimEnd, "99:59:59");
        assert.equal(await page.textContent("#trimValidation"), "");
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
