// Sprawdzenie zadania UL-1 w przegladarce (Edge przez playwright-core): lista rozdzielczosci ma 1080p zaznaczone
// domyslnie, a 1440p i 2160p sa do wybrania tylko przy formacie MKV. Zmiana MKV -> inny format przy wybranym
// 1440p albo 2160p ustawia 1080p.
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

// stan listy rozdzielczosci: wybrana wartosc i ktore pozycje sa wylaczone
function resolutionState(page) {
    return page.evaluate(() => {
        const select = document.querySelector("#resolution");

        return {
            value: select.value,
            options: [...select.options].map(option => ({ value: option.value, text: option.textContent, disabled: option.disabled }))
        };
    });
}

function disabledValues(state) {
    return state.options.filter(option => option.disabled).map(option => option.value);
}

async function withPage(run) {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const opened = await openPage(browser, server);
        await run(opened);
        assert.deepEqual(opened.pageErrors, [], "strona nie moze rzucac bledow skryptu");
    } finally {
        await browser.close();
        await stopServer(server);
    }
}

test("UL-1: lista rozdzielczosci w kolejnosci z zadania, po otwarciu zaznaczone 1080p", async () => {
    await withPage(async ({ page }) => {
        const state = await resolutionState(page);

        assert.deepEqual(state.options.map(option => [option.value, option.text]), [
            ["144", "144p"],
            ["360", "360p"],
            ["480", "480p"],
            ["720", "720p"],
            ["1080", "1080p"],
            ["1440", "1440p (tylko MKV)"],
            ["2160", "2160p / 4K (tylko MKV)"],
            ["best", "Best"]
        ]);
        assert.equal(state.value, "1080");

        // po przejsciu w tryb wideo (domyslny format MP4) dalej 1080p
        await page.click('.choice:has(input[value="video"])');
        assert.equal(await page.inputValue("#format"), "mp4");
        assert.equal((await resolutionState(page)).value, "1080");
    });
});

test("UL-1: przy MP4, MPEG i MJPEG pozycje 1440p i 2160p sa wylaczone i nie da sie ich wybrac; przy MKV wlaczone", async () => {
    await withPage(async ({ page }) => {
        for (const mode of ["video", "separate"]) {
            await page.click(`.choice:has(input[value="${mode}"])`);

            for (const format of ["mp4", "mpeg", "mjpeg"]) {
                await page.selectOption("#format", format);
                assert.deepEqual(disabledValues(await resolutionState(page)), ["1440", "2160"], `${mode} + ${format}`);

                // playwright odmawia wybrania wylaczonej pozycji - tak samo jak uzytkownik nie moze jej kliknac
                await assert.rejects(page.selectOption("#resolution", "2160", { timeout: 1000 }));
                assert.equal((await resolutionState(page)).value, "1080");
            }

            await page.selectOption("#format", "mkv");
            assert.deepEqual(disabledValues(await resolutionState(page)), [], `${mode} + mkv`);
            await page.selectOption("#resolution", "1440");
            assert.equal((await resolutionState(page)).value, "1440");
            await page.selectOption("#resolution", "1080");
        }
    });
});

test("UL-1: zmiana MKV -> MP4 przy wybranym 2160p (i MKV -> MJPEG przy 1440p) ustawia 1080p; inne rozdzielczosci zostaja", async () => {
    await withPage(async ({ page, downloadRequests }) => {
        await page.click('.choice:has(input[value="video"])');

        await page.selectOption("#format", "mkv");
        await page.selectOption("#resolution", "2160");
        await page.selectOption("#format", "mp4");
        assert.equal((await resolutionState(page)).value, "1080");

        await page.selectOption("#format", "mkv");
        await page.selectOption("#resolution", "1440");
        await page.selectOption("#format", "mjpeg");
        assert.equal((await resolutionState(page)).value, "1080");

        // zwykla rozdzielczosc nie jest ruszana przy zmianie formatu
        await page.selectOption("#format", "mkv");
        await page.selectOption("#resolution", "720");
        await page.selectOption("#format", "mp4");
        assert.equal((await resolutionState(page)).value, "720");

        // wyjscie do trybu audio i powrot do wideo (format wraca do MP4) tez zdejmuje 2160p
        await page.selectOption("#format", "mkv");
        await page.selectOption("#resolution", "2160");
        await page.click('.choice:has(input[value="audio"])');
        await page.click('.choice:has(input[value="video"])');
        assert.equal(await page.inputValue("#format"), "mp4");
        assert.equal((await resolutionState(page)).value, "1080");
        assert.deepEqual(disabledValues(await resolutionState(page)), ["1440", "2160"]);

        // wyslane zadanie niesie wybrana rozdzielczosc 2160 z mkv
        await page.selectOption("#format", "mkv");
        await page.selectOption("#resolution", "2160");
        await page.fill("#url", "https://www.youtube.com/watch?v=jNQXAC9IVRw");
        await page.click("#downloadButton");
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].format, "mkv");
        assert.equal(downloadRequests[0].resolution, "2160");
    });
});
