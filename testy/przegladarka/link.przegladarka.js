// Sprawdzenie zadania BUG-1a w przegladarce (Edge przez playwright-core): link do playlisty, kanalu albo innej
// strony YouTube daje blad pod polem linku od razu po wpisaniu, a klik Pobierz nie wysyla zadania /api/download.
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

async function openPage(browser, server) {
    const page = await browser.newPage();
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

const PLAYLIST = "To link do playlisty. Wklej link do jednego filmu.";
const CHANNEL = "To link do kanału. Wklej link do jednego filmu.";
const NOT_VIDEO = "To nie jest link do filmu.";

test("BUG-1a: komunikat pod polem linku pojawia sie od razu po wpisaniu, bez klikania Pobierz", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors, downloadRequests } = await openPage(browser, server);
        const ok = { text: "", isError: false };

        // pole jest pod polem linku (kolejny element po #url)
        assert.equal(await page.$eval("#url", input => input.nextElementSibling.id), "urlValidation");

        assert.deepEqual(await typeUrl(page, "https://www.youtube.com/playlist?list=PLtestowaPlaylista123"), { text: PLAYLIST, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.youtube.com/watch?list=PLtestowaPlaylista123"), { text: PLAYLIST, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.youtube.com/@nazwa/videos"), { text: CHANNEL, isError: true });
        assert.deepEqual(await typeUrl(page, "https://www.youtube.com/feed/trending"), { text: NOT_VIDEO, isError: true });

        // poprawny link zdejmuje komunikat
        assert.deepEqual(await typeUrl(page, "https://www.youtube.com/watch?v=jBoKCUKJkiY&list=PLtestowaPlaylista123"), ok);
        assert.deepEqual(await typeUrl(page, "https://youtu.be/jBoKCUKJkiY"), ok);
        assert.deepEqual(await typeUrl(page, "https://vimeo.com/123456"), ok);

        assert.equal(downloadRequests.length, 0);
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("BUG-1a: klik Pobierz z linkiem do playlisty nie wysyla zadania, po poprawce linku - wysyla", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, pageErrors, downloadRequests } = await openPage(browser, server);

        await page.fill("#url", "https://www.youtube.com/playlist?list=PLtestowaPlaylista123");
        assert.equal(await page.textContent("#urlValidation"), PLAYLIST);

        await page.click("#downloadButton");

        await page.waitForFunction((message) => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === `[error] ${message}`), PLAYLIST);

        assert.equal(downloadRequests.length, 0);
        assert.equal(await page.textContent("#statusBox"), PLAYLIST);
        assert.equal(await page.isDisabled("#downloadButton"), false);

        await page.fill("#url", "https://www.youtube.com/@nazwa");
        await page.click("#downloadButton");

        await page.waitForFunction((message) => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === `[error] ${message}`), CHANNEL);

        assert.equal(downloadRequests.length, 0);

        await page.fill("#url", "https://www.youtube.com/watch?v=jBoKCUKJkiY");
        assert.equal(await page.textContent("#urlValidation"), "");

        await page.click("#downloadButton");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].url, "https://www.youtube.com/watch?v=jBoKCUKJkiY");
        assert.deepEqual(pageErrors, []);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
