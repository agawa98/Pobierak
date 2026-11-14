// Sprawdzenie zadania B13c w przegladarce (Edge przez playwright-core): pola "Przytnij" na stronie
// przyjmuja i odrzucaja te same zapisy czasu co backend.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 (np. font z Google) sa odcinane, formularz nie jest wysylany.

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

    await page.route("**/*", (route) => {
        if (route.request().url().startsWith(baseUrl)) {
            return route.continue();
        }

        return route.abort();
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    return page;
}

// wpisuje czasy w oba pola (walidacja rusza na zdarzeniu "input") i zwraca komunikat spod pol
async function typeTrim(page, start, end) {
    await page.fill("#trimStart", start);
    await page.fill("#trimEnd", end);

    return page.$eval("#trimValidation", box => ({ text: box.textContent, isError: box.classList.contains("is-error") }));
}

test("B13c: strona i backend daja ten sam wynik parseTimeToSeconds dla zapisow z zadania", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await openPage(browser, server);
        const inputs = ["90", "1:30", "1:02:03", "", "  ", "1:75", "1::2", "0x10", "1e3", "-5", "1.5", "1:60:00", "1:00:60", "60:00", "1:2:3:4"];

        // NaN i null nie przechodza przez JSON tak samo, wiec wynik jest zamieniany na napis
        const fromPage = await page.evaluate(list => list.map(input => String(parseTimeToSeconds(input))), inputs);
        const fromBackend = inputs.map(input => String(appModule.parseTimeToSeconds(input)));

        assert.deepEqual(fromPage, fromBackend);
        assert.deepEqual(fromPage, ["90", "90", "3723", "null", "null", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "NaN", "3600", "NaN"]);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B13c: pola Przytnij pokazuja blad formatu dla blednych zapisow i nic dla poprawnych", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await openPage(browser, server);

        for (const input of ["1:75", "1::2", "0x10", "1e3", "-5", "1.5"]) {
            assert.deepEqual(await typeTrim(page, input, ""), { text: "Użyj formatu GG:MM:SS", isError: true }, `start "${input}"`);
            assert.deepEqual(await typeTrim(page, "", input), { text: "Użyj formatu GG:MM:SS", isError: true }, `koniec "${input}"`);
        }

        for (const [start, end] of [["", ""], ["90", ""], ["", "1:30"], ["5", "1:30"], ["1:30", "1:02:03"]]) {
            assert.deepEqual(await typeTrim(page, start, end), { text: "", isError: false }, `start "${start}", koniec "${end}"`);
        }

        // 1:30 i 90 to ten sam czas
        assert.deepEqual(await typeTrim(page, "1:30", "90"), { text: "Początek musi być mniejszy niż koniec.", isError: true });
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
