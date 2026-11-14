// Testy zadania B13d: komunikat "Utracono połączenie z logami backendu." jest dodawany tylko raz,
// a ponowne polaczenie (onopen) pozwala pokazac go przy nastepnej utracie.
// Fragment public/script.js z obsluga logow backendu (od utworzenia EventSource do funkcji trimLogs)
// jest uruchamiany bez przegladarki, z atrapa EventSource i atrapa addLog.
// Nic nie pobieraja z internetu.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

const LOST = "Utracono połączenie z logami backendu.";

// wycina z public/script.js czesc z obsluga logow backendu
function cutLogsPart() {
    const startMark = "const backendLogs = new EventSource(";
    const endMark = "function trimLogs() {";
    const start = scriptSource.indexOf(startMark);
    const end = scriptSource.indexOf(endMark);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${startMark}`);
    assert.notEqual(end, -1, `w public/script.js nie ma: ${endMark}`);
    assert.ok(start < end, "obsluga logow backendu ma stac przed funkcja trimLogs");

    return scriptSource.slice(start, end);
}

// uruchamia fragment strony; zwraca atrape EventSource (z funkcjami onopen/onerror/onmessage) i liste wpisow addLog
function buildPage() {
    const logs = [];        // kazde wywolanie addLog: [typ, tresc]
    const sources = [];     // utworzone obiekty EventSource

    function EventSource(url) {
        this.url = url;
        this.onopen = null;
        this.onerror = null;
        this.onmessage = null;
        sources.push(this);
    }

    const context = {
        EventSource,
        addLog(type, message) { logs.push([type, message]); }
    };

    vm.createContext(context);
    vm.runInContext(cutLogsPart(), context);

    assert.equal(sources.length, 1, "strona ma otwierac dokladnie jedno polaczenie z logami");

    const source = sources[0];

    return {
        source,
        logs,
        lostCount: () => logs.filter(([, message]) => message === LOST).length,
        open: () => source.onopen({ type: "open" }),
        error: () => source.onerror({ type: "error" }),
        message: (type, text) => source.onmessage({ data: JSON.stringify({ type, message: text }) })
    };
}

test("B13d: strona laczy sie z /api/logs i ma obsluge onopen, onerror i onmessage", () => {
    const page = buildPage();

    assert.equal(page.source.url, "/api/logs");
    assert.equal(typeof page.source.onopen, "function");
    assert.equal(typeof page.source.onerror, "function");
    assert.equal(typeof page.source.onmessage, "function");
});

test("B13d: pierwszy blad polaczenia dodaje jeden komunikat typu error", () => {
    const page = buildPage();

    page.error();

    assert.deepEqual(page.logs, [["error", LOST]]);
});

test("B13d: kolejne bledy (ponawiane proby polaczenia) nie dodaja nastepnych komunikatow", () => {
    const page = buildPage();

    for (let i = 0; i < 25; i += 1) {
        page.error();
    }

    assert.deepEqual(page.logs, [["error", LOST]]);
});

test("B13d: blad po udanym polaczeniu tez daje jeden komunikat", () => {
    const page = buildPage();

    page.open();
    page.error();
    page.error();
    page.error();

    assert.deepEqual(page.logs, [["error", LOST]]);
});

test("B13d: onopen zeruje flage - po ponownym polaczeniu nastepna utrata znowu daje jeden komunikat", () => {
    const page = buildPage();

    page.open();
    page.error();
    page.error();
    assert.equal(page.lostCount(), 1);

    page.open();
    assert.equal(page.lostCount(), 1, "samo ponowne polaczenie nie dodaje komunikatu o utracie");

    page.error();
    page.error();
    page.error();
    assert.equal(page.lostCount(), 2);

    page.open();
    page.error();
    assert.equal(page.lostCount(), 3);
});

test("B13d: onopen sam z siebie niczego nie wpisuje do logow", () => {
    const page = buildPage();

    page.open();
    page.open();

    assert.deepEqual(page.logs, []);
});

test("B13d: wiadomosc z backendu nie zeruje flagi (zeruje ja tylko onopen)", () => {
    const page = buildPage();

    page.error();
    page.message("YT-DLP", "linia");
    page.error();

    assert.deepEqual(page.logs, [["error", LOST], ["YT-DLP", "linia"]]);
});

test("B13d: po ponownym polaczeniu logi wracaja - wiadomosci sa dalej wypisywane, przed utrata i po niej", () => {
    const page = buildPage();

    page.open();
    page.message("system", "Połączono z logami backendu.");
    page.error();
    page.error();
    page.open();
    page.message("system", "Połączono z logami backendu.");
    page.message("YT-DLP", "[download]  10.0% of 5.00MiB\n[download]  20.0% of 5.00MiB");

    assert.deepEqual(page.logs, [
        ["system", "Połączono z logami backendu."],
        ["error", LOST],
        ["system", "Połączono z logami backendu."],
        ["YT-DLP", "[download]  10.0% of 5.00MiB"],
        ["YT-DLP", "[download]  20.0% of 5.00MiB"]
    ]);
});

test("B13d: tresc komunikatu wystepuje w public/script.js dokladnie raz", () => {
    assert.equal(scriptSource.split(LOST).length - 1, 1);
});
