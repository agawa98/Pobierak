// Sprawdzenie zadania UL-2c w przegladarce (Edge przez playwright-core): wybor folderu docelowego pod przyciskiem "Pobierz".
// Bez folderu "Pobierz" jest wylaczony z podpowiedzia; "Wybierz folder…" -> sciezka widoczna i zapamietana w localStorage,
// takze po ponownym otwarciu strony; zadanie pobrania niesie pole folder; brak okna -> pole reczne; blad 400 folderu -> komunikat
// i wybor od nowa; po sukcesie "Gotowe — zapisano:" z pelnymi sciezkami, bez linkow i bez pobierania przez przegladarke.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Prawdziwe okno wyboru folderu sie nie otwiera: odpowiedzi /api/folder/wybierz i /api/download podstawia test.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

const testUrl = "https://www.youtube.com/shorts/jBoKCUKJkiY";
const storageKey = "pobierak.folderDocelowy";
const hint = "Najpierw wybierz folder docelowy";
const chosen = "C:\\Pobrane\\Filmy z YouTube";

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

// otwiera strone. pick(numer) zwraca JSON odpowiedzi na kolejne POST /api/folder/wybierz,
// download(numer, cialoZadania) zwraca { status, json } na kolejne POST /api/download
async function withPage({ pick = () => ({ result: "cancelled" }), download = () => ({ status: 500, json: { message: "brak" } }) }, run) {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const page = await context.newPage();
        const baseUrl = `http://127.0.0.1:${server.address().port}`;
        const pickCalls = [];
        const downloadBodies = [];
        const downloads = [];
        const pageErrors = [];

        page.on("download", item => downloads.push(item.suggestedFilename()));
        page.on("pageerror", error => pageErrors.push(String(error)));

        await context.route("**/*", async (route) => {
            const request = route.request();
            const url = request.url();

            if (url === `${baseUrl}/api/folder/wybierz`) {
                pickCalls.push(request.method());

                return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(pick(pickCalls.length)) });
            }

            if (url === `${baseUrl}/api/download`) {
                const body = JSON.parse(request.postData());

                downloadBodies.push(body);

                const answer = download(downloadBodies.length, body);

                return route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.json) });
            }

            if (url.startsWith(baseUrl)) {
                return route.continue();
            }

            return route.abort();
        });

        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

        await run({ page, context, baseUrl, pickCalls, downloadBodies, downloads });

        assert.deepEqual(pageErrors, [], "bledy skryptu na stronie");
    } finally {
        await browser.close();
        await stopServer(server);
    }
}

// to, co uzytkownik widzi w wierszu folderu i na przycisku "Pobierz"
function readFolderView(page) {
    return page.evaluate(() => {
        const visible = (element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();

            return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const button = document.querySelector("#downloadButton");
        const block = document.querySelector("#folderBlock");

        return {
            line: document.querySelector(".folder-line").textContent.replace(/\s+/g, " ").trim(),
            chooseText: document.querySelector("#chooseFolderButton").textContent.trim(),
            chooseVisible: visible(document.querySelector("#chooseFolderButton")),
            downloadDisabled: button.disabled,
            title: button.getAttribute("title"),
            message: document.querySelector("#folderMessage").textContent,
            manualVisible: visible(document.querySelector("#folderManual")),
            rowError: block.classList.contains("is-error"),
            under: block.getBoundingClientRect().top >= button.getBoundingClientRect().bottom,
            saved: localStorage.getItem("pobierak.folderDocelowy")
        };
    });
}

function readStatus(page) {
    return page.evaluate(() => {
        const box = document.querySelector("#statusBox");

        return {
            visible: getComputedStyle(box).display !== "none",
            error: box.classList.contains("is-error"),
            success: box.classList.contains("is-success"),
            lines: Array.from(box.querySelectorAll("p")).map(line => line.textContent),
            links: box.querySelectorAll("a").length
        };
    });
}

test("UL-2c: bez folderu - pod Pobierz jest Folder docelowy: nie wybrano, Pobierz wylaczony z podpowiedzia; klik nic nie wysyla", async () => {
    await withPage({}, async ({ page, downloadBodies }) => {
        const view = await readFolderView(page);

        assert.deepEqual(view, {
            line: "Folder docelowy: nie wybrano",
            chooseText: "Wybierz folder…",
            chooseVisible: true,
            downloadDisabled: true,
            title: hint,
            message: hint,
            manualVisible: false,
            rowError: false,
            under: true,
            saved: null
        });

        // klik w wylaczony przycisk i Enter w polu linku nie wysylaja zadania pobrania
        await page.fill("#url", testUrl);
        await page.click("#downloadButton", { force: true });
        await page.press("#url", "Enter");
        await page.waitForTimeout(300);

        assert.deepEqual(downloadBodies, []);
    });
});

test("UL-2c: Wybierz folder… - sciezka widoczna, w localStorage, Pobierz wlaczony; po ponownym otwarciu strony folder zostaje", async () => {
    await withPage({ pick: () => ({ success: true, result: "selected", folder: chosen }) }, async ({ page, pickCalls }) => {
        await page.click("#chooseFolderButton");
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        assert.deepEqual(pickCalls, ["POST"]);

        const view = await readFolderView(page);

        assert.equal(view.line, `Folder docelowy: ${chosen}`);
        assert.equal(view.downloadDisabled, false);
        assert.equal(view.title, null);
        assert.equal(view.message, "");
        assert.equal(view.saved, chosen);

        await page.reload({ waitUntil: "domcontentloaded" });

        const again = await readFolderView(page);

        assert.equal(again.line, `Folder docelowy: ${chosen}`);
        assert.equal(again.downloadDisabled, false);
        assert.equal(again.message, "");
        assert.equal(pickCalls.length, 1, "po ponownym otwarciu strona nie pyta o folder od nowa");
    });
});

test("UL-2c: okno zamkniete bez wyboru - folder dalej nie wybrany", async () => {
    await withPage({ pick: () => ({ success: false, result: "cancelled" }) }, async ({ page, pickCalls }) => {
        await page.click("#chooseFolderButton");
        await page.waitForFunction(() => !document.querySelector("#chooseFolderButton").disabled);

        assert.equal(pickCalls.length, 1);

        const view = await readFolderView(page);

        assert.equal(view.line, "Folder docelowy: nie wybrano");
        assert.equal(view.downloadDisabled, true);
        assert.equal(view.manualVisible, false);
        assert.equal(view.saved, null);
    });
});

test("UL-2c: zadanie pobrania niesie pole folder; po sukcesie Gotowe — zapisano: i pelne sciezki, bez linkow i bez pobierania", async () => {
    const videoPath = `${chosen}\\film [0a1b2c3d].mp4`;
    const audioPath = `${chosen}\\film [0a1b2c3d].mp3`;

    await withPage({
        pick: () => ({ result: "selected", folder: chosen }),
        download: () => ({
            status: 200,
            json: {
                success: true,
                message: "Pobrano osobno.",
                files: [{ name: "film [0a1b2c3d].mp4", path: videoPath }, { name: "film [0a1b2c3d].mp3", path: audioPath }]
            }
        })
    }, async ({ page, downloadBodies, downloads }) => {
        await page.click("#chooseFolderButton");
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        await page.fill("#url", testUrl);
        await page.click('.choice:has(input[value="separate"])');
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-success"));

        assert.equal(downloadBodies.length, 1);
        assert.equal(downloadBodies[0].folder, chosen);
        assert.equal(downloadBodies[0].type, "separate");

        const status = await readStatus(page);

        assert.deepEqual(status.lines, ["Gotowe — zapisano:", videoPath, audioPath]);
        assert.equal(status.links, 0);

        await page.waitForTimeout(1000);

        assert.deepEqual(downloads, [], "przegladarka nie moze niczego pobierac");
        assert.equal(await page.$$eval("a", links => links.length), 0, "na stronie nie ma linkow do plikow");
        // po pobraniu przycisk jest wlaczony (folder dalej wybrany). od UL-2d po sukcesie ma napis "Pokaż w folderze"
        assert.equal(await page.isEnabled("#downloadButton"), true);
        assert.equal(await page.textContent(".button-text"), "Pokaż w folderze");
    });
});

test("UL-2c: okna nie da sie otworzyc - pole do recznego wklejenia sciezki; Enter zapisuje sciezke i nie wysyla pobierania", async () => {
    const reason = "Nie można otworzyć okna wyboru folderu.";

    await withPage({ pick: () => ({ success: false, result: "unavailable", message: reason }) }, async ({ page, downloadBodies }) => {
        await page.fill("#url", testUrl);
        await page.click("#chooseFolderButton");
        await page.waitForSelector("#folderManual:not(.hidden)");

        const view = await readFolderView(page);

        assert.equal(view.manualVisible, true);
        assert.equal(view.message, `${reason} Wklej ścieżkę folderu ręcznie.`);
        assert.equal(view.downloadDisabled, true);
        assert.equal(await page.evaluate(() => document.activeElement.id), "folderManualInput", "pole reczne dostaje fokus");

        await page.fill("#folderManualInput", "D:\\Muzyka");
        await page.press("#folderManualInput", "Enter");

        const after = await readFolderView(page);

        assert.equal(after.line, "Folder docelowy: D:\\Muzyka");
        assert.equal(after.manualVisible, false);
        assert.equal(after.downloadDisabled, false);
        assert.equal(after.saved, "D:\\Muzyka");

        await page.waitForTimeout(300);
        assert.deepEqual(downloadBodies, [], "Enter w polu sciezki nie moze wyslac formularza pobierania");
    });
});

test("UL-2c: pole reczne - przycisk Zapisz; pusta sciezka nie jest zapisywana", async () => {
    await withPage({ pick: () => ({ result: "unavailable", message: "Brak okna." }) }, async ({ page }) => {
        await page.click("#chooseFolderButton");
        await page.waitForSelector("#folderManual:not(.hidden)");

        await page.fill("#folderManualInput", "   ");
        await page.click("#folderManualSave");

        let view = await readFolderView(page);

        assert.equal(view.message, "Wklej pełną ścieżkę folderu.");
        assert.equal(view.downloadDisabled, true);
        assert.equal(view.saved, null);

        await page.fill("#folderManualInput", "/home/uzytkownik/Pobrane");
        await page.click("#folderManualSave");

        view = await readFolderView(page);

        assert.equal(view.line, "Folder docelowy: /home/uzytkownik/Pobrane");
        assert.equal(view.saved, "/home/uzytkownik/Pobrane");
    });
});

test("UL-2c: blad 400 folderu - komunikat w polu statusu, wiersz folderu prosi o wybor od nowa; nowy wybor dziala", async () => {
    const message = `Folder docelowy nie istnieje: ${chosen}`;
    const newFolder = "C:\\Inny folder";

    await withPage({
        pick: () => ({ result: "selected", folder: newFolder }),
        download: (number) => number === 1
            ? { status: 400, json: { success: false, message } }
            : { status: 200, json: { message: "ok", files: [{ name: "a.mp3", path: `${newFolder}\\a.mp3` }] } }
    }, async ({ page, context, downloadBodies }) => {
        // folder zapamietany wczesniej, ktorego juz nie ma
        await page.evaluate(([key, value]) => localStorage.setItem(key, value), [storageKey, chosen]);
        await page.reload({ waitUntil: "domcontentloaded" });

        await page.fill("#url", testUrl);
        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-error"));

        const status = await readStatus(page);

        assert.deepEqual(status.lines, [message]);

        const view = await readFolderView(page);

        assert.equal(view.rowError, true);
        assert.equal(view.message, "Wybierz folder docelowy od nowa.");
        assert.equal(await page.isEnabled("#chooseFolderButton"), true);

        // wybor od nowa
        await page.click("#chooseFolderButton");
        await page.waitForFunction(() => !document.querySelector("#folderBlock").classList.contains("is-error"));

        const fixed = await readFolderView(page);

        assert.equal(fixed.line, `Folder docelowy: ${newFolder}`);
        assert.equal(fixed.saved, newFolder);
        assert.equal(fixed.message, "");

        await page.click("#downloadButton");
        await page.waitForFunction(() => document.querySelector("#statusBox").classList.contains("is-success"));

        assert.deepEqual(downloadBodies.map(body => body.folder), [chosen, newFolder]);
    });
});

test("UL-2c: dluga sciezka folderu lamie sie w wierszu i nie rozpycha karty ani strony", async () => {
    const longFolder = `C:\\${"BardzoDlugiFolderBezSpacji".repeat(6)}\\${"Podfolder".repeat(5)}`;

    await withPage({ pick: () => ({ result: "selected", folder: longFolder }) }, async ({ page }) => {
        const cardBefore = await page.evaluate(() => document.querySelector(".card").getBoundingClientRect().width);

        await page.click("#chooseFolderButton");
        await page.waitForFunction(() => !document.querySelector("#downloadButton").disabled);

        const layout = await page.evaluate(() => {
            const card = document.querySelector(".card").getBoundingClientRect();
            const line = document.querySelector(".folder-line").getBoundingClientRect();
            const button = document.querySelector("#chooseFolderButton").getBoundingClientRect();

            return {
                cardWidth: card.width,
                lineInside: line.left >= card.left && line.right <= card.right,
                buttonInside: button.left >= card.left && button.right <= card.right,
                pageScroll: document.documentElement.scrollWidth <= window.innerWidth
            };
        });

        assert.equal(layout.cardWidth, cardBefore, "karta zmienila szerokosc");
        assert.equal(layout.lineInside, true);
        assert.equal(layout.buttonInside, true);
        assert.equal(layout.pageScroll, true, "strona dostala poziomy pasek przewijania");
    });
});
