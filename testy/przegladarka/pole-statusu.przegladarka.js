// Sprawdzenie zadania U1 + U3 + U4 w przegladarce (Edge przez playwright-core): pole statusu pod przyciskiem "Pobierz".
// Zly link -> czytelny blad pod przyciskiem; udane pobranie -> "Gotowe" z dzialajacym linkiem; tryb "osobno" -> dwa linki;
// odpowiedz, ktora nie jest JSON-em -> komunikat z kodem HTTP; tlo z logami bez zmian.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane, a odpowiedzi /api/download i pliki z /downloads podstawia test.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";

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

// plik podstawiany pod /downloads/<nazwa>
function fileEntry(name) {
    return { name, url: `/downloads/${encodeURIComponent(name)}`, body: `tresc pliku: ${name}` };
}

// otwiera strone. respond(numerZadania) zwraca odpowiedz na kolejne POST /api/download:
// { status, json } albo { status, contentType, body } albo { abort: true }. files to pliki podstawiane pod /downloads
async function withPage(respond, files, run) {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const downloads = [];          // pobrania rozpoczete przez strone
        const pageErrors = [];
        const requested = [];          // adresy wszystkich zadan strony
        let requestNumber = 0;

        page.on("download", download => downloads.push(download.suggestedFilename()));
        page.on("pageerror", error => pageErrors.push(String(error)));

        await page.route("**/*", async (route) => {
            const url = route.request().url();

            requested.push(url);

            if (url === `${baseUrl}/api/download`) {
                requestNumber += 1;

                const answer = respond(requestNumber);

                if (answer.abort) {
                    return route.abort("connectionrefused");
                }

                return route.fulfill({
                    status: answer.status,
                    contentType: answer.contentType || "application/json",
                    body: answer.body !== undefined ? answer.body : JSON.stringify(answer.json)
                });
            }

            const file = files.find(entry => url === `${baseUrl}${entry.url}`);

            if (file) {
                return route.fulfill({ status: 200, contentType: "application/octet-stream", body: file.body });
            }

            if (url.startsWith(baseUrl)) {
                return route.continue();
            }

            return route.abort();
        });

        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

        await run({ page, baseUrl, downloads, pageErrors, requested });

        assert.deepEqual(pageErrors, [], "bledy skryptu na stronie");
    } finally {
        await browser.close();
        await stopServer(server);
    }
}

// to, co uzytkownik widzi w polu statusu
function readStatus(page) {
    return page.evaluate(() => {
        const box = document.querySelector("#statusBox");
        const style = getComputedStyle(box);
        const rect = box.getBoundingClientRect();

        return {
            visible: style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0,
            error: box.classList.contains("is-error"),
            success: box.classList.contains("is-success"),
            text: box.innerText.trim(),
            elements: Array.from(box.querySelectorAll("*")).map(element => element.tagName),
            links: Array.from(box.querySelectorAll("a")).map(link => ({
                text: link.textContent,
                href: link.getAttribute("href"),
                download: link.getAttribute("download")
            })),
            borderColor: style.borderLeftColor
        };
    });
}

async function clickAndWait(page) {
    await page.click("#downloadButton");
    await page.waitForFunction(() => {
        const box = document.querySelector("#statusBox");

        return !document.querySelector("#downloadButton").disabled && getComputedStyle(box).display !== "none";
    });
}

// polozenie i styl tla z logami oraz karty - do porownania przed i po
function readLayout(page) {
    return page.evaluate(() => {
        const rectOf = (selector) => {
            const rect = document.querySelector(selector).getBoundingClientRect();

            return [rect.left, rect.top, rect.width, rect.height].map(value => Math.round(value * 100) / 100);
        };

        const logs = document.querySelector("#terminalLogs");
        const style = getComputedStyle(logs);
        const backgroundStyle = getComputedStyle(document.querySelector(".terminal-background"));

        return {
            terminal: {
                rect: rectOf("#terminalLogs"),
                backgroundRect: rectOf(".terminal-background"),
                color: style.color,
                fontFamily: style.fontFamily,
                fontSize: style.fontSize,
                lineHeight: style.lineHeight,
                padding: style.padding,
                overflowX: style.overflowX,
                overflowY: style.overflowY,
                position: backgroundStyle.position,
                zIndex: backgroundStyle.zIndex,
                pointerEvents: backgroundStyle.pointerEvents,
                background: backgroundStyle.backgroundImage
            },
            cardWidth: rectOf(".card")[2],
            pageScrollWidth: document.documentElement.scrollWidth,
            viewportWidth: window.innerWidth
        };
    });
}

function readLogLines(page) {
    return page.$$eval("#terminalLogs p", rows => rows.map(row => row.textContent));
}

const audioFile = fileEntry("the #1 NO SCOPE player in rivals 100% [0a1b2c3d].mp3");
const videoFile = fileEntry("the #1 NO SCOPE player in rivals video [0a1b2c3d].mp4");
const separateAudioFile = fileEntry("the #1 NO SCOPE player in rivals audio [0a1b2c3d].mp3");

test("U1: pole statusu jest na starcie ukryte, puste, pod przyciskiem Pobierz, z aria-live=polite", async () => {
    await withPage(() => ({ status: 200, json: {} }), [], async ({ page }) => {
        const state = await page.evaluate(() => {
            const box = document.querySelector("#statusBox");
            const button = document.querySelector("#downloadButton");

            return {
                count: document.querySelectorAll("#statusBox").length,
                display: getComputedStyle(box).display,
                text: box.textContent,
                ariaLive: box.getAttribute("aria-live"),
                tag: box.tagName,
                hasClass: box.classList.contains("status-box"),
                previousIsButton: box.previousElementSibling === button,
                inForm: box.closest("#downloadForm") !== null
            };
        });

        assert.deepEqual(state, {
            count: 1, display: "none", text: "", ariaLive: "polite", tag: "DIV",
            hasClass: true, previousIsButton: true, inForm: true
        });
    });
});

test("U1: zly link - czytelny blad pod przyciskiem, z czerwonym akcentem; start nastepnego pobierania czysci pole", async () => {
    const message = "yt-dlp: ERROR: [youtube] zly-link: Video unavailable";
    let release;
    const held = new Promise((resolve) => { release = resolve; });

    await withPage(() => ({ status: 500, json: { success: false, message } }), [], async ({ page, baseUrl, downloads }) => {
        await page.fill("#url", "https://www.youtube.com/watch?v=zly-link");
        await clickAndWait(page);

        const status = await readStatus(page);

        assert.equal(status.visible, true);
        assert.equal(status.error, true);
        assert.equal(status.success, false);
        assert.equal(status.text, message);
        assert.deepEqual(status.links, []);

        // czerwony akcent: w kolorze obwodki przewaza czerwien
        const [red, green, blue] = status.borderColor.match(/[\d.]+/g).map(Number);

        assert.equal(red > 200 && red > green + 60 && red > blue + 60, true, `obwodka bledu: ${status.borderColor}`);

        // pole stoi pod przyciskiem, w karcie, i jest czytelne (nieprzezroczysty, jasny tekst)
        const look = await page.evaluate(() => {
            const box = document.querySelector("#statusBox");
            const button = document.querySelector("#downloadButton").getBoundingClientRect();
            const card = document.querySelector(".card").getBoundingClientRect();
            const rect = box.getBoundingClientRect();
            const style = getComputedStyle(box);

            return {
                under: rect.top >= button.bottom,
                inside: rect.left >= card.left && rect.right <= card.right && rect.bottom <= card.bottom,
                opacity: style.opacity,
                color: style.color,
                fontSize: parseFloat(style.fontSize),
                radius: parseFloat(style.borderTopLeftRadius)
            };
        });

        assert.equal(look.under, true);
        assert.equal(look.inside, true);
        assert.equal(look.opacity, "1");
        assert.equal(look.fontSize >= 14, true);
        assert.equal(look.radius > 0, true);

        const [textRed, textGreen, textBlue] = look.color.match(/[\d.]+/g).map(Number);

        assert.equal(textRed + textGreen + textBlue > 500, true, `tekst bledu ma byc jasny: ${look.color}`);

        assert.equal(downloads.length, 0);

        // blad jest tez w tle strony, jak dotad
        assert.equal((await readLogLines(page)).includes(`[error] ${message}`), true);

        // nastepne pobieranie: w trakcie zadania pole jest puste i ukryte
        await page.unroute("**/*");
        await page.route(`${baseUrl}/api/download`, async (route) => {
            await held;

            return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "drugi blad" }) });
        });

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#downloadButton").disabled);

        const during = await readStatus(page);

        assert.equal(during.visible, false);
        assert.equal(during.text, "");
        assert.equal(during.error, false);

        release();
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        assert.equal((await readStatus(page)).text, "drugi blad");
    });
});

test("U1: udane pobranie - Gotowe z dzialajacym linkiem (nazwa z # i %), automatyczne pobieranie zostaje", async () => {
    const answer = {
        success: true,
        message: "Pobrano audio.",
        downloadUrl: audioFile.url,
        files: [{ name: audioFile.name, url: audioFile.url }],
        receivedData: {}
    };

    await withPage(() => ({ status: 200, json: answer }), [audioFile], async ({ page, downloads }) => {
        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const status = await readStatus(page);

        assert.equal(status.visible, true);
        assert.equal(status.success, true);
        assert.equal(status.error, false);
        assert.deepEqual(status.links, [{ text: audioFile.name, href: audioFile.url, download: audioFile.name }]);
        assert.equal(status.text.startsWith("Gotowe"), true, status.text);
        assert.equal(status.text.replace(/\s+/g, " "), `Gotowe ${audioFile.name}`);

        // fioletowo-niebieski akcent: inny niz przy bledzie, bez przewagi czerwieni
        const [red, green, blue] = status.borderColor.match(/[\d.]+/g).map(Number);

        assert.equal(blue > 200 && blue > red && blue > green, true, `obwodka sukcesu: ${status.borderColor}`);

        // automatyczne pobieranie: jeden plik, bez klikania
        await assert.doesNotReject(waitFor(() => downloads.length === 1));
        assert.deepEqual(downloads, [audioFile.name]);

        // adres z linku zwraca plik
        const fetched = await page.evaluate(async () => {
            const link = document.querySelector("#statusBox a");
            const response = await fetch(link.href);

            return { status: response.status, body: await response.text() };
        });

        assert.deepEqual(fetched, { status: 200, body: audioFile.body });

        // klikniecie linku pobiera plik pod jego nazwa
        const [download] = await Promise.all([
            page.waitForEvent("download"),
            page.click("#statusBox a")
        ]);

        assert.equal(download.suggestedFilename(), audioFile.name);
        assert.equal(download.url().endsWith(audioFile.url), true);

        // link zostaje w polu po kliknieciu (to jest link zapasowy)
        assert.equal((await readStatus(page)).links.length, 1);
    });
});

// czeka, az warunek bedzie spelniony (najwyzej 5 s)
async function waitFor(condition) {
    const deadline = Date.now() + 5000;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error("warunek nie zostal spelniony w 5 s");
        }

        await new Promise(resolve => setTimeout(resolve, 50));
    }
}

test("U3: tryb osobno - dwa linki z nazwami plikow, oba dzialaja", async () => {
    const answer = {
        success: true,
        message: "Pobrano osobno.",
        downloadUrl: separateAudioFile.url,
        downloadUrls: [videoFile.url, separateAudioFile.url],
        files: [
            { name: videoFile.name, url: videoFile.url },
            { name: separateAudioFile.name, url: separateAudioFile.url }
        ],
        receivedData: {}
    };

    await withPage(() => ({ status: 200, json: answer }), [videoFile, separateAudioFile], async ({ page, downloads }) => {
        await page.fill("#url", testUrl);
        await page.click('.choice:has(input[value="separate"])');
        await clickAndWait(page);

        const status = await readStatus(page);

        assert.equal(status.success, true);
        assert.deepEqual(status.links, [
            { text: videoFile.name, href: videoFile.url, download: videoFile.name },
            { text: separateAudioFile.name, href: separateAudioFile.url, download: separateAudioFile.name }
        ]);

        // linki stoja jeden pod drugim, a nie w jednym wierszu
        const tops = await page.$$eval("#statusBox a", links => links.map(link => link.getBoundingClientRect().top));

        assert.equal(tops[1] > tops[0], true);

        const fetched = await page.evaluate(() => Promise.all(Array.from(document.querySelectorAll("#statusBox a"))
            .map(async (link) => {
                const response = await fetch(link.href);

                return [response.status, await response.text()];
            })));

        assert.deepEqual(fetched, [[200, videoFile.body], [200, separateAudioFile.body]]);

        // automatyczne pobieranie zostaje: pierwszy plik rusza zawsze. drugi przegladarka moze wstrzymac
        // (pytanie o zgode na kilka plikow) - po to sa linki w polu
        await waitFor(() => downloads.length >= 1);
        assert.equal(downloads[0], videoFile.name);

        // drugi link z pola pobiera drugi plik
        const [download] = await Promise.all([
            page.waitForEvent("download", { predicate: item => item.url().endsWith(separateAudioFile.url) }),
            page.click("#statusBox a >> nth=1")
        ]);

        assert.equal(download.suggestedFilename(), separateAudioFile.name);
    });
});

test("U1: bardzo dluga nazwa pliku lamie sie w polu i nie rozpycha karty ani strony", async () => {
    const longFile = fileEntry(`${"BardzoDlugaNazwaBezSpacji".repeat(8)} [0a1b2c3d].mp3`);
    const answer = {
        success: true, message: "ok", downloadUrl: longFile.url,
        files: [{ name: longFile.name, url: longFile.url }], receivedData: {}
    };

    await withPage(() => ({ status: 200, json: answer }), [longFile], async ({ page }) => {
        const before = await readLayout(page);

        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const after = await readLayout(page);

        assert.equal(after.cardWidth, before.cardWidth, "karta zmienila szerokosc");
        assert.equal(after.pageScrollWidth <= after.viewportWidth, true, "strona dostala poziomy pasek przewijania");

        const box = await page.evaluate(() => {
            const element = document.querySelector("#statusBox");
            const link = element.querySelector("a");
            const card = document.querySelector(".card").getBoundingClientRect();
            const rect = element.getBoundingClientRect();
            const linkRect = link.getBoundingClientRect();

            return {
                overflow: element.scrollWidth > element.clientWidth,
                insideCard: rect.left >= card.left && rect.right <= card.right,
                linkInsideBox: linkRect.left >= rect.left && linkRect.right <= rect.right,
                linkLines: Math.round(linkRect.height / parseFloat(getComputedStyle(link).lineHeight))
            };
        });

        assert.equal(box.overflow, false, "nazwa wystaje poza pole");
        assert.equal(box.insideCard, true);
        assert.equal(box.linkInsideBox, true);
        assert.equal(box.linkLines >= 2, true, "dluga nazwa powinna zajac wiecej niz jeden wiersz");
    });
});

test("U1: tresc z serwera jest pokazywana doslownie - znaczniki w komunikacie i w nazwie pliku nie staja sie elementami", async () => {
    const evilName = "<img src=x onerror=window.hacked=1> <b>film</b> [0a1b2c3d].mp3";
    const evilFile = fileEntry(evilName);
    const evilMessage = "ffmpeg: <img src=x onerror=window.hacked=1> & <script>window.hacked=1</script>";

    const respond = (number) => number === 1
        ? { status: 500, json: { message: evilMessage } }
        : { status: 200, json: { message: "ok", downloadUrl: evilFile.url, files: [{ name: evilName, url: evilFile.url }] } };

    await withPage(respond, [evilFile], async ({ page, baseUrl, requested }) => {
        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const error = await readStatus(page);

        assert.equal(error.text, evilMessage);
        assert.deepEqual(error.elements.filter(tag => tag === "IMG" || tag === "SCRIPT" || tag === "B"), []);

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-success"));

        const success = await readStatus(page);

        assert.deepEqual(success.links, [{ text: evilName, href: evilFile.url, download: evilName }]);
        assert.deepEqual(success.elements.filter(tag => tag === "IMG" || tag === "SCRIPT" || tag === "B"), []);

        await page.waitForTimeout(300);

        assert.equal(await page.evaluate(() => window.hacked), undefined, "kod z odpowiedzi serwera zostal wykonany");
        // obrazek ze znacznika <img src=x> nie byl pobierany
        assert.deepEqual(requested.filter(url => url === `${baseUrl}/x`), []);
    });
});

test("U1: blad walidacji przycinania jest widoczny w polu statusu; po poprawce i udanym pobraniu znika", async () => {
    const answer = {
        success: true, message: "ok", downloadUrl: audioFile.url,
        files: [{ name: audioFile.name, url: audioFile.url }], receivedData: {}
    };

    await withPage(() => ({ status: 200, json: answer }), [audioFile], async ({ page }) => {
        await page.fill("#url", testUrl);
        await page.click("#experimentalToggle");
        await page.fill("#trimStart", "2:00");
        await page.fill("#trimEnd", "1:00");
        await page.click("#downloadButton");
        await page.waitForFunction(() => getComputedStyle(document.querySelector("#statusBox")).display !== "none");

        const error = await readStatus(page);

        assert.equal(error.visible, true);
        assert.equal(error.error, true);
        assert.equal(error.text, "Początek musi być mniejszy niż koniec.");
        assert.equal(await page.isEnabled("#downloadButton"), true);

        await page.fill("#trimEnd", "3:00");
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-success"));

        const success = await readStatus(page);

        assert.equal(success.error, false);
        assert.equal(success.text.includes("Początek"), false);
        assert.equal(success.links.length, 1);

        // pole pokazuje Gotowe z linkiem; kolejne bledne przyciecie zastepuje to samym bledem
        await page.fill("#trimEnd", "0:30");
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-error"));

        const again = await readStatus(page);

        assert.equal(again.success, false);
        assert.equal(again.text, "Początek musi być mniejszy niż koniec.");
        assert.deepEqual(again.links, []);
    });
});

test("U4: odpowiedz, ktora nie jest JSON-em - komunikat z kodem HTTP, a nie o braku polaczenia", async () => {
    const respond = (number) => number === 1
        ? { status: 502, contentType: "text/html", body: "<!DOCTYPE html><html><body><h1>Bad Gateway</h1></body></html>" }
        : { status: 200, contentType: "text/plain", body: "to nie jest JSON" };

    await withPage(respond, [], async ({ page, downloads }) => {
        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const first = await readStatus(page);

        assert.equal(first.error, true);
        assert.equal(first.text, "Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 502).");

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").textContent.includes("HTTP 200"));

        const second = await readStatus(page);

        assert.equal(second.error, true);
        assert.equal(second.text, "Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 200).");

        const lines = await readLogLines(page);

        assert.equal(lines.includes("[error] Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 502)."), true, JSON.stringify(lines));
        assert.equal(lines.some(line => line.includes("Nie udało się połączyć z backendem.")), false, JSON.stringify(lines));
        assert.equal(downloads.length, 0);
        assert.equal(await page.isEnabled("#downloadButton"), true);
        assert.equal(await page.textContent(".button-text"), "Pobierz");
    });
});

test("U4: serwer nie odpowiada - komunikat o braku polaczenia zostaje, takze w polu statusu", async () => {
    await withPage(() => ({ abort: true }), [], async ({ page }) => {
        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const status = await readStatus(page);

        assert.equal(status.error, true);
        assert.equal(status.text, "Nie udało się połączyć z backendem.");

        const lines = await readLogLines(page);

        assert.equal(lines.includes("[error] Nie udało się połączyć z backendem."), true, JSON.stringify(lines));
        assert.equal(lines.some(line => line.includes("nieoczekiwaną odpowiedź")), false, JSON.stringify(lines));
        assert.equal(await page.textContent(".button-text"), "Pobierz");
    });
});

test("U1: tlo z logami bez zmian - to samo polozenie i styl przy ukrytym polu, przy bledzie i przy sukcesie", async () => {
    const respond = (number) => number === 1
        ? { status: 500, json: { message: "yt-dlp: ERROR: blad testowy" } }
        : { status: 200, json: { message: "Pobrano.", downloadUrl: audioFile.url, files: [{ name: audioFile.name, url: audioFile.url }] } };

    await withPage(respond, [audioFile], async ({ page }) => {
        const before = await readLayout(page);

        // wartosci sprzed zadania (z public/style.css): tlo na caly ekran, pod karta, bez reakcji na mysz
        assert.deepEqual(before.terminal.backgroundRect, [0, 0, 1280, 900]);
        assert.equal(before.terminal.position, "fixed");
        assert.equal(before.terminal.zIndex, "0");
        assert.equal(before.terminal.pointerEvents, "none");
        assert.equal(before.terminal.color, "rgba(219, 234, 254, 0.46)");
        assert.equal(before.terminal.fontSize, "14px");
        assert.equal(before.terminal.padding, "22px 28px");

        await page.fill("#url", testUrl);
        await clickAndWait(page);

        const withError = await readLayout(page);

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-success"));

        const withSuccess = await readLayout(page);

        assert.deepEqual(withError.terminal, before.terminal);
        assert.deepEqual(withSuccess.terminal, before.terminal);

        // logi dalej trafiaja do tla, a nie do pola statusu
        const lines = await readLogLines(page);

        assert.equal(lines.includes("[error] yt-dlp: ERROR: blad testowy"), true, JSON.stringify(lines));
        assert.equal(lines.includes("[success] Pobrano."), true, JSON.stringify(lines));
        assert.equal(await page.evaluate(() => document.querySelector("#terminalLogs #statusBox")), null);
        assert.equal(await page.evaluate(() => document.querySelector("#statusBox").closest(".terminal-background")), null);

        // wiersz logu wyglada jak dotad
        const row = await page.evaluate(() => {
            const line = document.querySelector("#terminalLogs p");

            return {
                html: line.innerHTML,
                spanColor: getComputedStyle(line.querySelector("span")).color,
                margin: getComputedStyle(line).marginBottom
            };
        });

        assert.deepEqual(row, {
            html: "<span>[system]</span> Pobierak uruchomiony.",
            spanColor: "rgba(167, 139, 250, 0.7)",
            margin: "7px"
        });
    });
});
