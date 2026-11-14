// Sprawdzenie zadania B9 w przegladarce (Edge przez playwright-core): addLog pokazuje znaczniki z logow
// jako zwykly tekst, a zwykle linie wygladaja tak samo jak przy dawnym innerHTML.
// Uruchamianie: npm run test:przegladarka. Nie jest czescia "npm test", bo wymaga Edge.
// Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.

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

// otwiera strone i zapisuje adresy wszystkich zadan
async function openPage(browser, server) {
    const page = await browser.newPage();
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const requests = [];

    await page.route("**/*", (route) => {
        const url = route.request().url();

        requests.push(url);

        if (url.startsWith(baseUrl)) {
            return route.continue();
        }

        return route.abort();
    });

    await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

    // strona jest gotowa, gdy pokaze powitanie z backendu
    await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
        .some(row => row.textContent.includes("Połączono z logami backendu.")));

    return { page, baseUrl, requests };
}

test("B9: addLog(\"test\", \"<b>x</b> & <img src=x>\") pokazuje ten tekst doslownie", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page, requests } = await openPage(browser, server);
        const requestsBefore = requests.length;

        await page.evaluate(() => addLog("test", "<b>x</b> & <img src=x>"));

        // chwila na ewentualne zadanie po obrazek
        await page.waitForTimeout(300);

        const result = await page.evaluate(() => {
            const line = document.querySelector("#terminalLogs p:last-child");

            return {
                text: line.textContent,
                visibleText: line.innerText,
                html: line.innerHTML,
                nodes: Array.from(line.childNodes).map(node => node.nodeName),
                elementsInLine: line.querySelectorAll("*").length,
                foreign: document.querySelectorAll("#terminalLogs b, #terminalLogs img").length
            };
        });

        assert.equal(result.text, "[test] <b>x</b> & <img src=x>");
        assert.equal(result.visibleText, "[test] <b>x</b> & <img src=x>");
        assert.equal(result.html, "<span>[test]</span> &lt;b&gt;x&lt;/b&gt; &amp; &lt;img src=x&gt;");
        assert.deepEqual(result.nodes, ["SPAN", "#text"]);
        assert.equal(result.elementsInLine, 1, "w wierszu ma byc tylko span z typem");
        assert.equal(result.foreign, 0, "w tle powstal element <b> albo <img>");
        assert.deepEqual(requests.slice(requestsBefore), [], "strona wyslala zadanie po wpisie logu (obrazek?)");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B9: znaczniki w logu z backendu i w typie logu nie tworza elementow", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page } = await openPage(browser, server);

        appModule.sendLogToClients("<i>YT</i>", "ERROR: <script>window.zlyKod = 1</script><img src=x onerror=\"window.zlyKod = 2\">");

        await page.waitForFunction(() => Array.from(document.querySelectorAll("#terminalLogs p"))
            .some(row => row.textContent.includes("ERROR:")));
        await page.waitForTimeout(300);

        const result = await page.evaluate(() => ({
            text: document.querySelector("#terminalLogs p:last-child").textContent,
            foreign: document.querySelectorAll("#terminalLogs i, #terminalLogs script, #terminalLogs img").length,
            badCode: window.zlyKod
        }));

        assert.equal(result.text, "[<i>YT</i>] ERROR: <script>window.zlyKod = 1</script><img src=x onerror=\"window.zlyKod = 2\">");
        assert.equal(result.foreign, 0);
        assert.equal(result.badCode, undefined, "kod z logu zostal wykonany");
    } finally {
        await browser.close();
        await stopServer(server);
    }
});

test("B9: zwykle linie wygladaja tak samo jak wiersz zbudowany dawnym innerHTML", async () => {
    const server = await startServer();
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const { page } = await openPage(browser, server);

        const samples = [
            ["system", "Pobierak uruchomiony."],
            ["YT-DLP", "[download]  55.5% of    5.00MiB at  2.00MiB/s ETA 00:01"],
            ["error", "Początek musi być mniejszy niż koniec."],
            ["data", "{\"url\":\"https://example.invalid/bardzo/dlugi/adres/" + "x".repeat(400) + "\"}"]
        ];

        const result = await page.evaluate((list) => {
            const logs = document.querySelector("#terminalLogs");

            // wyglad wiersza: budowa, wymiary, polozenie spana i style, od ktorych zalezy obraz
            function look(line) {
                const span = line.querySelector("span");
                const lineBox = line.getBoundingClientRect();
                const spanBox = span.getBoundingClientRect();
                const lineStyle = getComputedStyle(line);
                const spanStyle = getComputedStyle(span);

                return {
                    html: line.innerHTML,
                    width: lineBox.width,
                    height: lineBox.height,
                    spanLeft: spanBox.left - lineBox.left,
                    spanWidth: spanBox.width,
                    spanHeight: spanBox.height,
                    lineColor: lineStyle.color,
                    lineMargin: lineStyle.margin,
                    lineFont: lineStyle.font,
                    spanColor: spanStyle.color,
                    spanFont: spanStyle.font
                };
            }

            return list.map(([type, message]) => {
                addLog(type, message);

                const current = look(logs.lastElementChild);

                // ten sam wiersz zbudowany tak, jak robil to kod przed zmiana
                const old = document.createElement("p");
                old.innerHTML = `<span>[${type}]</span> ${message}`;
                logs.appendChild(old);

                const previous = look(old);

                logs.removeChild(old);

                return { current, previous };
            });
        }, samples);

        for (const [index, { current, previous }] of result.entries()) {
            assert.deepEqual(current, previous, `wiersz [${samples[index][0]}] rozni sie od dawnego`);
            assert.equal(current.spanColor, "rgba(167, 139, 250, 0.7)", "typ logu ma byc fioletowy");
            assert.notEqual(current.lineColor, current.spanColor);
            assert.ok(current.height > 0 && current.spanWidth > 0);
        }

        // linie dodane przy starcie strony maja te sama budowe
        const startLines = await page.$$eval("#terminalLogs p", rows => rows.slice(0, 2).map(row => row.innerHTML));

        assert.deepEqual(startLines, [
            "<span>[system]</span> Pobierak uruchomiony.",
            "<span>[info]</span> Czekam na link do filmu..."
        ]);
    } finally {
        await browser.close();
        await stopServer(server);
    }
});
