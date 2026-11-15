// Sprawdzenie zadania B1 w przegladarce (Edge przez playwright-core): po bledzie walidacji przycinania
// przycisk "Pobierz" zostaje aktywny, z napisem "Pobierz"; przy poprawnym czasie blokuje sie tylko na czas zadania.
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

// otwiera strone. zadania do /api/download nie trafiaja do programu: sa liczone i czekaja na release()
async function openPage(browser, server) {
    const page = await browser.newPage();
    // UL-2c: bez wybranego folderu przycisk "Pobierz" jest wylaczony; folder jest zapamietany jak po wyborze
    await page.addInitScript(() => localStorage.setItem("pobierak.folderDocelowy", "C:\\Pobrane"));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const downloadRequests = [];
    let release;
    const released = new Promise((resolve) => { release = resolve; });

    await page.route("**/*", async (route) => {
        const url = route.request().url();

        if (url === `${baseUrl}/api/download`) {
            downloadRequests.push(route.request().postDataJSON());
            await released;

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

    return { page, downloadRequests, release };
}

// stan przycisku widziany przez uzytkownika
function readButton(page) {
    return page.evaluate(() => ({
        disabled: document.querySelector("#downloadButton").disabled,
        text: document.querySelector(".button-text").textContent,
        loaderHidden: document.querySelector(".button-loader").classList.contains("hidden")
    }));
}

function readLogLines(page) {
    return page.$$eval("#terminalLogs p", rows => rows.map(row => row.textContent));
}

const idle = { disabled: false, text: "Pobierz", loaderHidden: true };

test("B1: start 2:00, koniec 1:00, klik Pobierz - przycisk zostaje aktywny z napisem Pobierz", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, downloadRequests } = await openPage(browser, server);

        await page.fill("#url", "https://www.youtube.com/shorts/jBoKCUKJkiY");
        await page.fill("#trimStart", "2:00");
        await page.fill("#trimEnd", "1:00");

        // zapisuje kazda zmiane stanu przycisku, takze taka, ktora zostalaby od razu cofnieta
        await page.evaluate(() => {
            window.buttonChanges = 0;

            new MutationObserver((records) => { window.buttonChanges += records.length; })
                .observe(document.querySelector("#downloadButton"), {
                    attributes: true, childList: true, characterData: true, subtree: true
                });
        });

        await page.click("#downloadButton");

        // blad walidacji trafia do tla strony - to znak, ze obsluga klikniecia sie wykonala
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[error] Początek musi być mniejszy niż koniec."));

        // chwila na ewentualne spoznione zmiany
        await page.waitForTimeout(300);

        assert.deepEqual(await readButton(page), idle);
        assert.equal(await page.evaluate(() => window.buttonChanges), 0, "przycisk zmienil stan mimo bledu walidacji");
        assert.equal(await page.isEnabled("#downloadButton"), true);
        assert.equal(await page.textContent("#trimValidation"), "Początek musi być mniejszy niż koniec.");
        assert.equal(downloadRequests.length, 0, "zadanie nie moze wyjsc do serwera przy blednym czasie");

        // po poprawieniu czasu ten sam przycisk dziala: drugi klik wysyla zadanie
        await page.fill("#trimEnd", "3:00");
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#downloadButton").disabled);

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].experimental.trimStart, "2:00");
        assert.equal(downloadRequests[0].experimental.trimEnd, "3:00");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B1: poprawny czas - przycisk blokuje sie na czas zadania (Pobieram...) i wraca do Pobierz", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, downloadRequests, release } = await openPage(browser, server);

        await page.fill("#url", "https://www.youtube.com/shorts/jBoKCUKJkiY");
        await page.fill("#trimStart", "1:00");
        await page.fill("#trimEnd", "2:00");

        assert.deepEqual(await readButton(page), idle);

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#downloadButton").disabled);

        // zadanie wisi: przycisk jest zablokowany
        assert.deepEqual(await readButton(page), { disabled: true, text: "Pobieram...", loaderHidden: false });
        assert.equal(downloadRequests.length, 1);

        release();

        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        assert.deepEqual(await readButton(page), idle);

        const lines = await readLogLines(page);

        assert.equal(lines.includes("[success] Pobrano (odpowiedz testowa)."), true, JSON.stringify(lines));
        assert.equal(lines.some(line => line.startsWith("[error]")), false, JSON.stringify(lines));
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
