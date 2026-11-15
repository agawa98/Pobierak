// Sprawdzenie zadania UL-4 w przegladarce (Edge przez playwright-core): ostrzezenie o starym yt-dlp, ktore serwer
// wysyla przy polaczeniu z logami, jest w tle strony zaraz po powitaniu, ma klase log-warning i pelny czerwony kolor.
// Uruchamianie: npm run test:przegladarka. Nic nie pobiera z internetu: zadania poza 127.0.0.1 sa odcinane.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright-core");

const appModule = require(path.join(__dirname, "..", "..", "app.js"));

test("UL-4: ostrzezenie o starym yt-dlp jest czerwone, zaraz po powitaniu, a zwykle logi zostaja przygaszone", async (t) => {
    const warning = appModule.setYtDlpVersion("2026.08.16", new Date(2026, 10, 15), "win32");

    t.after(() => appModule.setYtDlpVersion(null));      // inne sprawdzenia w tym procesie nie dostaja ostrzezenia

    const server = await new Promise((resolve, reject) => {
        const started = appModule.app.listen(0, "127.0.0.1", () => resolve(started));
        started.on("error", reject);
    });
    const browser = await chromium.launch({ channel: "msedge", headless: true });

    try {
        const page = await browser.newPage();
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        await page.route("**/*", route => route.request().url().startsWith(baseUrl) ? route.continue() : route.abort());
        await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

        await page.waitForFunction(() => document.querySelectorAll("#terminalLogs p.log-warning").length > 0);

        const rows = await page.$$eval("#terminalLogs p", elements => elements.map(element => ({
            text: element.textContent,
            className: element.className,
            color: getComputedStyle(element).color,
            labelColor: getComputedStyle(element.querySelector("span")).color
        })));

        const greeting = rows.findIndex(row => row.text.includes("Połączono z logami backendu."));

        assert.notEqual(greeting, -1, JSON.stringify(rows));

        const warningRow = rows[greeting + 1];

        assert.equal(warningRow.text, `[warning] ${warning}`);
        assert.equal(warningRow.className, "log-warning");
        assert.equal(warningRow.color, "rgb(239, 68, 68)");
        assert.equal(warningRow.labelColor, "rgb(239, 68, 68)");

        // powitanie jest zwyklym, przygaszonym logiem (kolor z przezroczystoscia)
        assert.equal(rows[greeting].className, "");
        assert.match(rows[greeting].color, /^rgba\(/);
    } finally {
        await browser.close();
        await new Promise(resolve => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
    }
});
