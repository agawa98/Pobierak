// Sprawdzenie zadania D3 w przegladarce (Edge przez playwright-core): sama klawiatura (Tab, strzalki, spacja,
// Enter) wystarcza, zeby zmienic tryb, przelaczyc mono/stereo, ruszyc oba pokretla i wyslac formularz;
// fokus jest zawsze widoczny; wyglad bez fokusu jest taki sam jak przy dawnym display: none.
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
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const downloadRequests = [];

    await page.route("**/*", async (route) => {
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

    return { page, downloadRequests };
}

// opis elementu z fokusem: ktory to element i czy widac na nim (albo na jego wizualnym zastepcy) znak fokusu.
// Znak fokusu = obwodka (outline) o niezerowej grubosci na elemencie o niezerowym rozmiarze i widocznym,
// albo (pole adresu i listy wyboru) cien 4px ustawiany przez regule :focus.
function readFocus(page) {
    return page.evaluate(() => {
        const element = document.activeElement;

        if (!element || element === document.body) {
            return { name: "body", indicator: null };
        }

        const name = element.id ? `#${element.id}` : `${element.tagName.toLowerCase()}[value=${element.value}]`;

        // element, na ktorym uzytkownik ma zobaczyc fokus
        let target = element;

        if (element.closest(".choice")) {
            target = element.closest(".choice").querySelector("span");
        } else if (element.closest(".channel-switch")) {
            target = element.closest(".channel-switch").querySelector(".switch-track");
        } else if (element.closest(".knob-dial")) {
            target = element.closest(".knob-dial");
        }

        const style = getComputedStyle(target);
        const rect = target.getBoundingClientRect();
        const visible = rect.width > 10 && rect.height > 10 &&
            style.visibility === "visible" && style.display !== "none" && Number(style.opacity) > 0;

        let indicator = null;

        if (visible && style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 1) {
            indicator = `outline ${style.outlineWidth} ${style.outlineStyle} ${style.outlineColor}`;
        } else if (visible && /4px$/.test(style.boxShadow) && style.boxShadow.includes("167, 139, 250")) {
            indicator = `shadow ${style.boxShadow}`;
        }

        return { name, indicator, focusVisible: element.matches(":focus-visible") };
    });
}

// pole adresu i listy wyboru pokazuja fokus cieniem, ktory narasta plynnie (transition),
// wiec na znak fokusu czeka sie do 1,5 s
async function readSettledFocus(page) {
    let focus = await readFocus(page);

    for (let attempt = 0; attempt < 15 && focus.indicator === null; attempt += 1) {
        await page.waitForTimeout(100);
        focus = await readFocus(page);
    }

    return focus;
}

// wciska Tab az fokus trafi na podany element; zwraca liste elementow po drodze. Kazdy musi miec widoczny fokus
async function tabTo(page, name, visited) {
    for (let step = 0; step < 20; step += 1) {
        await page.keyboard.press("Tab");

        const focus = await readSettledFocus(page);

        visited.push(focus);
        assert.notEqual(focus.indicator, null, `fokus niewidoczny na ${focus.name}`);

        if (focus.name === name) {
            return focus;
        }
    }

    assert.fail(`Tab nie doszedl do ${name}; po drodze: ${visited.map(item => item.name).join(", ")}`);
}

function readState(page) {
    return page.evaluate(() => ({
        type: document.querySelector('input[name="type"]:checked').value,
        stereo: document.querySelector("#channelsSwitch").checked,
        bitcrush: document.querySelector("#bitcrushKnob").value,
        bitcrushLabel: document.querySelector("#bitcrushValue").textContent,
        bitcrushAngle: document.querySelector("#bitcrushDial").style.getPropertyValue("--knob-angle"),
        sampleRate: document.querySelector("#sampleRateKnob").value,
        sampleRateLabel: document.querySelector("#sampleRateValue").textContent,
        formatLabel: document.querySelector("#formatLabel").textContent,
        panelOpen: document.querySelector("#workspace").classList.contains("is-experimental-open")
    }));
}

test("D3: sama klawiatura - zmiana trybu, mono/stereo, oba pokretla, wyslanie formularza; fokus zawsze widoczny", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, downloadRequests } = await openPage(browser, server);
        const visited = [];

        const before = await readState(page);

        assert.deepEqual(
            { type: before.type, stereo: before.stereo, bitcrush: before.bitcrush, sampleRate: before.sampleRate },
            { type: "audio", stereo: true, bitcrush: "0", sampleRate: "9" }
        );

        // pole adresu
        await tabTo(page, "#url", visited);
        await page.keyboard.type("https://www.youtube.com/shorts/jBoKCUKJkiY");

        // grupa trybu: Tab wchodzi na zaznaczone pole, strzalki zmieniaja tryb
        const radio = await tabTo(page, "input[value=audio]", visited);

        assert.equal(visited.length, 2, "po polu adresu Tab ma trafic od razu do wyboru trybu");
        assert.match(radio.indicator, /^outline 3px solid/);

        await page.keyboard.press("ArrowRight");

        let focus = await readFocus(page);

        assert.equal(focus.name, "input[value=video]");
        assert.match(focus.indicator, /^outline 3px solid/, "fokus niewidoczny na zaznaczonym trybie");
        assert.equal((await readState(page)).type, "video");
        assert.equal((await readState(page)).formatLabel, "Format wideo", "zmiana trybu strzalka ma przestawic opcje");

        await page.keyboard.press("ArrowRight");
        assert.equal((await readFocus(page)).name, "input[value=separate]");
        assert.equal((await readState(page)).type, "separate");

        await page.keyboard.press("ArrowLeft");
        assert.equal((await readState(page)).type, "video");

        // przycisk EXPERIMENTAL: Enter otwiera panel
        await tabTo(page, "#experimentalToggle", visited);
        await page.keyboard.press("Enter");
        assert.equal((await readState(page)).panelOpen, true);
        await page.waitForTimeout(600);

        // pokretlo bitcrush
        focus = await tabTo(page, "#bitcrushKnob", visited);
        assert.match(focus.indicator, /^outline 3px solid/);

        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowRight");
        await page.keyboard.press("ArrowUp");

        let state = await readState(page);

        assert.equal(state.bitcrush, "3");
        assert.equal(state.bitcrushLabel, "3", "napis na pokretle ma isc za klawiatura");
        assert.equal(state.bitcrushAngle, "-81deg", "wskaznik pokretla ma isc za klawiatura");

        // pokretlo sample rate
        focus = await tabTo(page, "#sampleRateKnob", visited);
        assert.match(focus.indicator, /^outline 3px solid/);
        assert.equal(visited[visited.length - 2].name, "#bitcrushKnob");

        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowDown");

        state = await readState(page);

        assert.equal(state.sampleRate, "7");
        assert.notEqual(state.sampleRateLabel, before.sampleRateLabel);

        // przelacznik mono/stereo: spacja
        focus = await tabTo(page, "#channelsSwitch", visited);
        assert.match(focus.indicator, /^outline 3px solid/);
        assert.equal(visited[visited.length - 2].name, "#sampleRateKnob");

        await page.keyboard.press("Space");
        assert.equal((await readState(page)).stereo, false);

        const thumbMono = await page.evaluate(() => getComputedStyle(document.querySelector(".switch-thumb")).transform);

        await page.keyboard.press("Space");
        assert.equal((await readState(page)).stereo, true);
        await page.keyboard.press("Space");
        assert.equal((await readState(page)).stereo, false);
        assert.notEqual(thumbMono, "", "brak stylu galki przelacznika");

        // reszta panelu tez ma widoczny fokus
        await tabTo(page, "#normalize", visited);
        await tabTo(page, "#trimStart", visited);
        await tabTo(page, "#trimEnd", visited);

        // powrot do formularza (Shift+Tab) i wyslanie Enterem z pola adresu
        for (let step = 0; step < 20 && (await readFocus(page)).name !== "#downloadButton"; step += 1) {
            await page.keyboard.press("Shift+Tab");

            const back = await readSettledFocus(page);

            assert.notEqual(back.indicator, null, `fokus niewidoczny na ${back.name} (Shift+Tab)`);
        }

        focus = await readFocus(page);
        assert.equal(focus.name, "#downloadButton");
        assert.equal(downloadRequests.length, 0);

        await page.keyboard.press("Enter");
        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].url, "https://www.youtube.com/shorts/jBoKCUKJkiY");
        assert.equal(downloadRequests[0].type, "video");
        assert.equal(downloadRequests[0].experimental.channels, "mono");
        assert.equal(downloadRequests[0].experimental.bitcrush, 3);
        assert.notEqual(downloadRequests[0].experimental.sampleRate, "default");

        // kolejnosc Tab: wszystkie elementy, do ktorych trzeba dojsc
        const names = visited.map(item => item.name);

        for (const name of ["#url", "input[value=audio]", "#experimentalToggle", "#bitcrushKnob",
            "#sampleRateKnob", "#channelsSwitch", "#normalize", "#trimStart", "#trimEnd"]) {
            assert.equal(names.includes(name), true, `Tab nie odwiedzil ${name}: ${names.join(", ")}`);
        }
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("D3: formularz da sie wyslac Enterem z pola adresu po zmianie trybu strzalkami", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, downloadRequests } = await openPage(browser, server);

        await page.keyboard.press("Tab");
        await page.keyboard.type("https://www.youtube.com/shorts/jBoKCUKJkiY");
        await page.keyboard.press("Tab");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("ArrowDown");
        await page.keyboard.press("Shift+Tab");
        assert.equal((await readFocus(page)).name, "#url");
        await page.keyboard.press("Enter");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent === "[success] Pobrano (odpowiedz testowa)."));

        assert.equal(downloadRequests.length, 1);
        assert.equal(downloadRequests[0].type, "separate");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

// polozenie i rozmiar wszystkich widocznych elementow strony oraz style, ktore moglaby ruszyc zmiana
function readLayout(page) {
    // zrzut elementu przewija strone, wiec przed odczytem wraca na gore
    return page.evaluate(() => { window.scrollTo(0, 0); }).then(() => page.evaluate(() => Array.from(document.querySelectorAll("main *"))
        .filter(element => !element.matches(".choice input, .channel-switch input, option"))
        .map((element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);

            return [
                element.tagName, element.id, element.className,
                Math.round(rect.x * 100) / 100, Math.round(rect.y * 100) / 100,
                Math.round(rect.width * 100) / 100, Math.round(rect.height * 100) / 100,
                style.outlineStyle, style.boxShadow, style.borderColor, style.backgroundImage, style.transform
            ].join("|");
        })));
}

for (const width of [1400, 500]) {
    test(`D3: wyglad bez fokusu taki sam jak przy display: none (okno ${width}px)`, async () => {
        const server = await startServer();
        const browser = await chromium.launch({ channel: "msedge", headless: true });

        try {
            const { page } = await openPage(browser, server);

            await page.setViewportSize({ width, height: 900 });

            // porownywany jest stan spoczynkowy: bez przejsc i animacji wynik nie zalezy od szybkosci komputera
            await page.addStyleTag({
                content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
            });
            await page.click("#experimentalToggle");
            await page.waitForTimeout(700);
            await page.evaluate(() => document.activeElement.blur());
            await page.mouse.move(2, 2);
            await page.waitForTimeout(300);

            const oldRule = ".choice input, .channel-switch input { display: none !important; }";
            const readScroll = () => page.evaluate(() =>
                [document.documentElement.scrollWidth, document.documentElement.scrollHeight]);
            const shoot = async () => ({
                card: await page.locator(".card").screenshot(),
                panel: await page.locator(".experimental-content").screenshot()
            });

            const current = await readLayout(page);
            const currentScroll = await readScroll();

            // dawny stan: pola calkiem wylaczone z ukladu strony
            let styleTag = await page.addStyleTag({ content: oldRule });

            await page.waitForTimeout(300);

            const old = await readLayout(page);
            const oldScroll = await readScroll();

            await styleTag.evaluate(node => node.remove());

            assert.equal(current.length > 40, true);
            assert.deepEqual(current, old);
            assert.deepEqual(currentScroll, oldScroll, "ukryte pole nie moze powiekszac strony");

            // zrzuty piksel po pikselu. Dwa zrzuty tego samego stanu potrafia sie roznic pojedynczymi pikselami
            // (szum rysowania rozmytego tla, opisany przy B13j), dlatego para jest powtarzana do 4 razy;
            // prawdziwa roznica wygladu wychodzi w kazdej probie
            let same = { card: false, panel: false };

            for (let attempt = 0; attempt < 4 && !(same.card && same.panel); attempt += 1) {
                await page.waitForTimeout(300);

                const currentShots = await shoot();

                styleTag = await page.addStyleTag({ content: oldRule });
                await page.waitForTimeout(300);

                const oldShots = await shoot();

                await styleTag.evaluate(node => node.remove());

                same = {
                    card: same.card || currentShots.card.equals(oldShots.card),
                    panel: same.panel || currentShots.panel.equals(oldShots.panel)
                };
            }

            assert.equal(same.card, true, "karta wyglada inaczej niz przy display: none");
            assert.equal(same.panel, true, "panel wyglada inaczej niz przy display: none");

            // kontrola samego testu: oba porownania wykrywaja zmiane
            const before = await shoot();

            await page.addStyleTag({
                content: ".choice span, .switch-track { outline: 3px solid #c4b5fd; outline-offset: 3px; }" +
                    ".choice input { position: static !important; width: 20px !important; height: 20px !important; }"
            });
            await page.waitForTimeout(300);

            const after = await shoot();

            assert.notDeepEqual(await readLayout(page), old);
            assert.equal(before.card.equals(after.card), false);
            assert.equal(before.panel.equals(after.panel), false);
        } finally {
            await browser.close();
            await stopServer(server);
        }
    });
}

test("D3: klikniecie mysza dziala jak wczesniej i nie pokazuje obwodki fokusu na trybie ani przelaczniku", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page } = await openPage(browser, server);

        await page.click(".choice:nth-child(2) span");
        assert.equal((await readState(page)).type, "video");

        let outline = await page.evaluate(() =>
            getComputedStyle(document.querySelector(".choice:nth-child(2) span")).outlineStyle);

        assert.equal(outline, "none");

        await page.click("#experimentalToggle");
        await page.waitForTimeout(700);
        await page.click(".switch-track");
        assert.equal((await readState(page)).stereo, false);

        outline = await page.evaluate(() => getComputedStyle(document.querySelector(".switch-track")).outlineStyle);
        assert.equal(outline, "none");

        // pokretlo dalej reaguje na mysz: klik z lewej strony tarczy, na wysokosci srodka, to kat -90 stopni,
        // czyli 1/6 zakresu 0-9 = 1,5, po zaokragleniu 2
        const box = await page.locator("#sampleRateDial").boundingBox();

        await page.mouse.click(box.x + 20, box.y + box.height / 2);
        assert.equal((await readState(page)).sampleRate, "2");

        outline = await page.evaluate(() => getComputedStyle(document.querySelector("#sampleRateDial")).outlineStyle);
        assert.equal(outline, "none", "klik w pokretlo nie daje fokusu polu, wiec obwodki nie ma");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("D3: pola przycinania maja nazwy dla czytnika ekranu, a klik w Przytnij przenosi fokus na start", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page } = await openPage(browser, server);

        await page.click("#experimentalToggle");
        await page.waitForTimeout(700);

        assert.equal(await page.getByRole("textbox", { name: "Początek przycięcia" }).count(), 1);
        assert.equal(await page.getByRole("textbox", { name: "Koniec przycięcia" }).count(), 1);
        assert.equal(await page.getByRole("textbox", { name: "Początek przycięcia" }).getAttribute("id"), "trimStart");
        assert.equal(await page.getByRole("textbox", { name: "Koniec przycięcia" }).getAttribute("id"), "trimEnd");

        await page.click(".trim-block label");
        assert.equal((await readFocus(page)).name, "#trimStart");

        // pola trybu i przelacznik sa widoczne dla czytnika (dawniej display: none je usuwalo)
        assert.equal(await page.getByRole("radio").count(), 3);
        assert.equal(await page.getByRole("checkbox").count(), 2);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
