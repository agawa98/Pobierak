// Sprawdzenie zadania UL-2d w przegladarce (Edge przez playwright-core): przycisk "Pokaż w folderze" po udanym pobraniu.
// Po sukcesie "Pobierz" zamienia sie w "Pokaż w folderze"; klik wysyla sciezke do /api/folder/pokaz i od razu wraca do "Pobierz";
// wpisanie znaku w pole linku tez wraca do "Pobierz"; po bledzie i po zmianie trybu, formatu i panelu EXPERIMENTAL nic sie nie zmienia;
// w trybie "osobno" do serwera idzie sciezka pliku wideo.
// Uruchamianie: npm run test:przegladarka. Eksplorator sie nie otwiera: odpowiedzi /api/download i /api/folder/pokaz podstawia test.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

const testUrl = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const folder = "C:\\Pobrane\\Filmy";
const video = { name: "Film [abc].mp4", path: "C:\\Pobrane\\Filmy\\Film [abc].mp4" };
const audio = { name: "Film [abc].mp3", path: "C:\\Pobrane\\Filmy\\Film [abc].mp3" };

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

// otwiera strone z zapamietanym folderem. download(numer, cialo) zwraca { status, json } na kolejne POST /api/download,
// show(numer) - { status, json } na kolejne POST /api/folder/pokaz (domyslnie 200)
async function withPage({ download, show = () => ({ status: 200, json: { success: true } }) }, run) {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const downloadBodies = [];
        const showBodies = [];
        const pageErrors = [];

        page.on("pageerror", error => pageErrors.push(String(error)));

        await context.addInitScript((saved) => {
            localStorage.setItem("pobierak.folderDocelowy", saved);
        }, folder);

        await context.route("**/*", async (route) => {
            const request = route.request();
            const url = request.url();

            if (url === `${baseUrl}/api/download`) {
                const body = JSON.parse(request.postData());

                downloadBodies.push(body);

                const answer = download(downloadBodies.length, body);

                return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.json) });
            }

            if (url === `${baseUrl}/api/folder/pokaz`) {
                showBodies.push(JSON.parse(request.postData()));

                const answer = show(showBodies.length);

                return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.json) });
            }

            if (url.startsWith(baseUrl)) {
                return route.continue();
            }

            return route.abort();
        });

        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        await run({ page, downloadBodies, showBodies });

        assert.deepEqual(pageErrors, [], "bledy skryptu na stronie");
    } finally {
        await browser.close();
        await stopServer(server);
    }
}

function buttonText(page) {
    return page.$eval("#downloadButton .button-text", element => element.textContent);
}

// klik "Pobierz" i czekanie na koniec pobierania (kolko ladowania znika)
async function downloadOnce(page) {
    await page.click("#downloadButton");
    await page.waitForFunction(() => document.querySelector(".button-loader").classList.contains("hidden")
        && !document.querySelector("#downloadButton").disabled);
}

const success = (files) => () => ({ status: 200, json: { success: true, message: "Gotowe.", files, receivedData: {} } });

test("UL-2d: po sukcesie Pokaż w folderze; tryb, format i EXPERIMENTAL go nie zmieniaja; klik pokazuje plik i wraca do Pobierz", async () => {
    await withPage({ download: success([audio]) }, async ({ page, downloadBodies, showBodies }) => {
        await page.fill("#url", testUrl);
        assert.equal(await buttonText(page), "Pobierz");

        await downloadOnce(page);

        assert.equal(await buttonText(page), "Pokaż w folderze");
        assert.equal(downloadBodies.length, 1);

        // zmiana innych ustawien nie zmienia przycisku
        await page.click('.choice:has(input[value="video"])');
        await page.selectOption("#format", "mkv");
        await page.click('.choice:has(input[value="separate"])');
        await page.click("#experimentalToggle");
        await page.click("#experimentalToggle");

        assert.equal(await buttonText(page), "Pokaż w folderze");

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#downloadButton .button-text").textContent === "Pobierz");
        await page.waitForTimeout(200);

        assert.deepEqual(showBodies, [{ path: audio.path }]);
        assert.equal(downloadBodies.length, 1, "klik Pokaż w folderze nie pobiera od nowa");
        assert.equal(await buttonText(page), "Pobierz");

        // nastepny klik to znowu pobieranie
        await downloadOnce(page);
        assert.equal(downloadBodies.length, 2);
    });
});

test("UL-2d: wpisanie znaku w pole linku zamienia Pokaż w folderze z powrotem w Pobierz", async () => {
    await withPage({ download: success([video]) }, async ({ page, downloadBodies, showBodies }) => {
        await page.fill("#url", testUrl);
        await downloadOnce(page);
        assert.equal(await buttonText(page), "Pokaż w folderze");

        await page.type("#url", "x");
        assert.equal(await buttonText(page), "Pobierz");

        // usuniecie znaku przywraca dobry link, ale przycisk zostaje "Pobierz", a klik pobiera
        await page.press("#url", "Backspace");
        assert.equal(await buttonText(page), "Pobierz");

        await downloadOnce(page);
        assert.equal(downloadBodies.length, 2);
        assert.deepEqual(showBodies, []);
    });
});

test("UL-2d: po nieudanym pobraniu przycisk zostaje Pobierz", async () => {
    await withPage({ download: () => ({ status: 500, json: { success: false, message: "yt-dlp: blad" } }) }, async ({ page, downloadBodies, showBodies }) => {
        await page.fill("#url", testUrl);
        await downloadOnce(page);

        assert.equal(await buttonText(page), "Pobierz");

        await page.click('.choice:has(input[value="video"])');
        await page.selectOption("#format", "mp4");

        assert.equal(await buttonText(page), "Pobierz");

        await downloadOnce(page);
        assert.equal(downloadBodies.length, 2, "po bledzie klik pobiera od nowa");
        assert.deepEqual(showBodies, []);
    });
});

test("UL-2d: tryb osobno - Pokaż w folderze wysyla sciezke pliku wideo", async () => {
    await withPage({ download: success([video, audio]) }, async ({ page, downloadBodies, showBodies }) => {
        await page.fill("#url", testUrl);
        await page.click('.choice:has(input[value="separate"])');
        await downloadOnce(page);

        assert.equal(downloadBodies[0].type, "separate");
        assert.equal(await buttonText(page), "Pokaż w folderze");

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#downloadButton .button-text").textContent === "Pobierz");
        await page.waitForTimeout(200);

        assert.deepEqual(showBodies, [{ path: video.path }]);
    });
});

test("UL-2d: serwer odmawia pokazania - komunikat w polu statusu, przycisk Pobierz", async () => {
    const show = () => ({ status: 404, json: { success: false, message: `Plik już nie istnieje: ${video.path}` } });

    await withPage({ download: success([video]), show }, async ({ page, showBodies }) => {
        await page.fill("#url", testUrl);
        await downloadOnce(page);
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-error"));

        assert.equal(showBodies.length, 1);
        assert.equal(await buttonText(page), "Pobierz");
        assert.equal(await page.$eval("#statusBox", element => element.textContent.trim()), `Plik już nie istnieje: ${video.path}`);
    });
});
