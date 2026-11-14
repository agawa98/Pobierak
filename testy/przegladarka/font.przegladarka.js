// Sprawdzenie zadania D2 w przegladarce (Edge przez playwright-core): strona nie wysyla zadnych zadan
// do fonts.googleapis.com ani fonts.gstatic.com (ani nigdzie poza wlasny serwer), pliki fontu przychodza
// z wlasnego serwera, a naglowek i polskie znaki sa naprawde rysowane fontem Space Grotesk z tych plikow.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa zapisywane i odcinane.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));
const screenshotsDir = path.join(__dirname, "..", "..", "..", "logi-petli", "zrzuty");

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

// otwiera strone i zapisuje kazde zadanie sieciowe: wlasne (z kodem odpowiedzi) i zewnetrzne (odciete)
async function openPage(browser, server) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const externalRequests = [];
    const ownResponses = [];

    await page.route("**/*", (route) => {
        const url = route.request().url();

        if (url.startsWith(baseUrl)) {
            return route.continue();
        }

        externalRequests.push(url);

        return route.abort();
    });

    page.on("response", response => ownResponses.push({
        url: response.url().slice(baseUrl.length),
        status: response.status()
    }));

    await page.goto(baseUrl, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);

    return { page, baseUrl, externalRequests, ownResponses };
}

// wstawia na strone probke tekstu w podanej wadze; zwraca jej id
async function addSample(page, id, text, weight, family) {
    await page.evaluate(({ id, text, weight, family }) => {
        const sample = document.createElement("span");

        sample.id = id;
        sample.textContent = text;
        sample.style.cssText = `position: absolute; left: 0; top: 0; white-space: nowrap; font-size: 40px; font-weight: ${weight};`;

        if (family) {
            sample.style.fontFamily = family;
        }

        document.body.appendChild(sample);
    }, { id, text, weight, family });

    await page.evaluate(() => document.fonts.ready);
}

// fonty, ktorymi przegladarka naprawde narysowala tekst elementu (protokol DevTools):
// [{ familyName, isCustomFont, glyphCount }]. isCustomFont = font wczytany przez @font-face, nie systemowy.
async function platformFonts(page, cdp, selector) {
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });

    assert.notEqual(nodeId, 0, `nie ma elementu ${selector}`);

    const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });

    return fonts;
}

function assertDrawnWithSpaceGrotesk(fonts, what) {
    assert.notEqual(fonts.length, 0, `${what}: przegladarka nie podala zadnego fontu`);

    for (const font of fonts) {
        // plik fontu zmiennego przedstawia sie przegladarce nazwa "Space Grotesk Light" (jego odmiana wyjsciowa to 300)
        assert.match(font.familyName, /^Space Grotesk( Light)?$/, `${what}: czesc znakow narysowana fontem ${font.familyName}`);
        assert.equal(font.isCustomFont, true, `${what}: Space Grotesk systemowy, nie z pliku strony`);
    }
}

test("D2 w przegladarce", async (t) => {
    const browser = await chromium.launch({ channel: "msedge", headless: true });
    const server = await startServer();

    t.after(async () => {
        await browser.close();
        await stopServer(server);
    });

    await t.test("strona nie wysyla zadan do Google ani nigdzie poza wlasny serwer", async () => {
        const { page, externalRequests, ownResponses } = await openPage(browser, server);

        // probka z polskimi znakami wymusza wczytanie zestawu latin-ext
        await addSample(page, "probkaSieci", "Zażółć gęślą jaźń", 700);
        await page.waitForTimeout(300);

        assert.deepEqual(externalRequests, []);
        assert.equal(ownResponses.some(response => /googleapis|gstatic/.test(response.url)), false);

        await page.close();
    });

    await t.test("pliki fontu przychodza z wlasnego serwera z kodem 200", async () => {
        const { page, ownResponses } = await openPage(browser, server);

        await addSample(page, "probkaPlikow", "Zażółć gęślą jaźń", 400);
        await page.waitForTimeout(300);

        const fontResponses = ownResponses.filter(response => response.url.endsWith(".woff2"));

        assert.deepEqual(
            fontResponses.map(response => response.url).sort(),
            ["/fonts/space-grotesk-latin-ext.woff2", "/fonts/space-grotesk-latin.woff2"]
        );

        for (const response of fontResponses) {
            assert.equal(response.status, 200, response.url);
        }

        // zadna regula @font-face nie skonczyla sie bledem wczytania
        const statuses = await page.evaluate(() => [...document.fonts].map(face => face.status));

        assert.equal(statuses.includes("error"), false, statuses.join(", "));
        assert.equal(statuses.filter(status => status === "loaded").length, 2, statuses.join(", "));

        await page.close();
    });

    await t.test("naglowek i teksty strony z polskimi znakami sa rysowane fontem Space Grotesk z pliku", async () => {
        const { page } = await openPage(browser, server);
        const cdp = await page.context().newCDPSession(page);

        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");

        assert.equal(await page.locator("h1").innerText(), "Pobierak");
        assertDrawnWithSpaceGrotesk(await platformFonts(page, cdp, "h1"), "naglowek h1");

        // etykiety z polskimi znakami: "Co chcesz pobrać?", "Film z dźwiękiem", "Dźwięk i obraz osobno"
        const titleText = await page.locator(".field-title").first().innerText();

        assert.match(titleText, /ć/);
        assertDrawnWithSpaceGrotesk(await platformFonts(page, cdp, ".field-title"), "etykieta z polskim znakiem");

        const choices = await page.locator(".choice span").allInnerTexts();

        assert.equal(choices.some(text => /[źęł]/.test(text)), true);

        for (let index = 1; index <= choices.length; index += 1) {
            assertDrawnWithSpaceGrotesk(
                await platformFonts(page, cdp, `.choice:nth-of-type(${index}) span`),
                `przycisk trybu "${choices[index - 1]}"`
            );
        }

        // przycisk "Pobierz", pola i listy wyboru nie dziedzicza fontu strony (tak bylo tez przy foncie z Google),
        // wiec nie sa tu sprawdzane

        await page.close();
    });

    await t.test("wszystkie polskie znaki w wagach 400, 600 i 700 sa rysowane fontem Space Grotesk z pliku", async () => {
        const { page } = await openPage(browser, server);
        const cdp = await page.context().newCDPSession(page);

        await cdp.send("DOM.enable");
        await cdp.send("CSS.enable");

        const text = "ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ Zażółć gęślą jaźń 0123456789";

        for (const weight of [400, 600, 700]) {
            await addSample(page, `probka${weight}`, text, weight);

            const fonts = await platformFonts(page, cdp, `#probka${weight}`);

            assertDrawnWithSpaceGrotesk(fonts, `probka w wadze ${weight}`);
            // wszystkie znaki probki (bez pominietych) trafily do Space Grotesk
            assert.equal(fonts.reduce((sum, font) => sum + font.glyphCount, 0), [...text].length);
        }

        await page.close();
    });

    await t.test("wagi 400, 600 i 700 roznia sie naprawde (font zmienny, nie sztuczne pogrubienie) i nie sa Arialem", async () => {
        const { page } = await openPage(browser, server);
        const text = "Zażółć gęślą jaźń Pobierak";

        for (const weight of [400, 600, 700]) {
            await addSample(page, `waga${weight}`, text, weight);
            await addSample(page, `arial${weight}`, text, weight, "Arial, sans-serif");
        }

        const widths = await page.evaluate(() => {
            const result = {};

            for (const weight of [400, 600, 700]) {
                result[`waga${weight}`] = document.getElementById(`waga${weight}`).getBoundingClientRect().width;
                result[`arial${weight}`] = document.getElementById(`arial${weight}`).getBoundingClientRect().width;
            }

            return result;
        });

        // prawdziwe wagi fontu zmiennego: kazda kolejna jest szersza. Przy sztucznym pogrubieniu
        // z jednego pliku 400 wagi 600 i 700 mialyby te sama szerokosc.
        assert.equal(widths.waga400 < widths.waga600, true, JSON.stringify(widths));
        assert.equal(widths.waga600 < widths.waga700, true, JSON.stringify(widths));

        for (const weight of [400, 600, 700]) {
            assert.notEqual(widths[`waga${weight}`], widths[`arial${weight}`], `waga ${weight} ma szerokosc Ariala`);
        }

        await page.close();
    });

    await t.test("zrzut ekranu do obejrzenia", async () => {
        const { page } = await openPage(browser, server);

        await addSample(page, "probkaZrzut", "Zażółć gęślą jaźń ąęłż ĄĘŁŻ", 700);
        await page.evaluate(() => {
            const sample = document.getElementById("probkaZrzut");

            sample.style.left = "24px";
            sample.style.top = "16px";
            sample.style.zIndex = "10";
        });

        fs.mkdirSync(screenshotsDir, { recursive: true });
        await page.screenshot({ path: path.join(screenshotsDir, "D2-font-lokalny.png") });
        await page.close();
    });
});
