// Testy zadania B9: addLog wstawia typ i tresc logu jako zwykly tekst (span + wezel tekstowy), a nie przez innerHTML.
// addLog i trimLogs sa wycinane z public/script.js i uruchamiane bez przegladarki, na atrapie dokumentu.
// Atrapa zapisuje kazde ustawienie innerHTML, wiec widac tez powrot do starego sposobu.
// Nic nie pobieraja z internetu.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

// wycina z public/script.js cala funkcje o podanym naglowku (do pierwszej klamry } na poczatku linii)
function cutFunction(header) {
    const start = scriptSource.indexOf(header);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${header}`);

    const rest = scriptSource.slice(start);
    const end = rest.search(/\r?\n\}/);

    assert.notEqual(end, -1, `nie znaleziono konca funkcji: ${header}`);

    return rest.slice(0, end) + "\n}";
}

// zamiana tekstu na HTML tak, jak robi to przegladarka przy odczycie innerHTML
function escapeText(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// atrapa dokumentu: elementy, wezly tekstowe, textContent, appendChild, removeChild
function buildPage() {
    const innerHtmlWrites = [];   // kazde ustawienie innerHTML na dowolnym elemencie

    function createTextNode(text) {
        return { nodeType: 3, textContent: String(text) };
    }

    function createElement(tagName) {
        const element = {
            nodeType: 1,
            tagName: tagName.toUpperCase(),
            childNodes: [],
            scrollTop: 0,
            scrollHeight: 0,

            appendChild(child) {
                this.childNodes.push(child);
                this.scrollHeight = this.childNodes.length * 20;
                return child;
            },

            removeChild(child) {
                const index = this.childNodes.indexOf(child);

                assert.notEqual(index, -1, "removeChild: to nie jest dziecko tego elementu");
                this.childNodes.splice(index, 1);
                return child;
            },

            get children() { return this.childNodes.filter(node => node.nodeType === 1); },
            get firstElementChild() { return this.children[0] || null; },

            get textContent() { return this.childNodes.map(node => node.textContent).join(""); },
            set textContent(value) { this.childNodes = value === "" ? [] : [createTextNode(value)]; },

            get innerHTML() {
                return this.childNodes.map(node => node.nodeType === 3
                    ? escapeText(node.textContent)
                    : `<${node.tagName.toLowerCase()}>${node.innerHTML}</${node.tagName.toLowerCase()}>`).join("");
            },
            set innerHTML(value) { innerHtmlWrites.push(value); }
        };

        return element;
    }

    const terminalLogs = createElement("div");
    const context = { terminalLogs, document: { createElement, createTextNode } };

    vm.createContext(context);
    vm.runInContext([
        cutFunction("function trimLogs() {"),
        cutFunction("function addLog(type, message) {")
    ].join("\n\n"), context);

    return { addLog: context.addLog, terminalLogs, innerHtmlWrites };
}

// opis wiersza: [nazwa znacznika albo "#text", tekst] dla kazdego dziecka
function describeLine(line) {
    return line.childNodes.map(node => [node.nodeType === 3 ? "#text" : node.tagName, node.textContent]);
}

test("B9: przyklad z zadania - znaczniki w tresci sa zwyklym tekstem", () => {
    const page = buildPage();

    page.addLog("test", "<b>x</b> & <img src=x>");

    assert.equal(page.terminalLogs.childNodes.length, 1);

    const line = page.terminalLogs.childNodes[0];

    assert.equal(line.tagName, "P");
    assert.deepEqual(describeLine(line), [["SPAN", "[test]"], ["#text", " <b>x</b> & <img src=x>"]]);
    assert.equal(line.textContent, "[test] <b>x</b> & <img src=x>");
    assert.deepEqual(page.innerHtmlWrites, [], "addLog nie moze ustawiac innerHTML");
});

test("B9: span ma tylko tekst [typ], bez elementow w srodku", () => {
    const page = buildPage();

    page.addLog("YT-DLP", "[download]  10.0% of 5.00MiB");

    const span = page.terminalLogs.childNodes[0].childNodes[0];

    assert.equal(span.tagName, "SPAN");
    assert.deepEqual(describeLine(span), [["#text", "[YT-DLP]"]]);
});

test("B9: znaczniki w typie logu tez sa zwyklym tekstem", () => {
    const page = buildPage();

    page.addLog("<i>typ</i>", "tresc");

    const line = page.terminalLogs.childNodes[0];

    assert.deepEqual(describeLine(line), [["SPAN", "[<i>typ</i>]"], ["#text", " tresc"]]);
    assert.deepEqual(describeLine(line.childNodes[0]), [["#text", "[<i>typ</i>]"]]);
    assert.deepEqual(page.innerHtmlWrites, []);
});

// zwykle linie: wiersz ma byc taki sam jak dawny `<span>[typ]</span> tresc`
const plainLines = [
    ["system", "Pobierak uruchomiony."],
    ["info", "Czekam na link do filmu..."],
    ["error", "Początek musi być mniejszy niż koniec."],
    ["YT-DLP", "[download]  55.5% of    5.00MiB at  2.00MiB/s ETA 00:01"],
    ["FFMPEG", "frame=   10 fps=0.0 q=-1.0 size=     256kB"],
    ["data", "{\"url\":\"https://example.invalid/film\",\"type\":\"audio\"}"],
    ["ui", "ąęłżźćńó ŚĆ"]
];

for (const [type, message] of plainLines) {
    test(`B9: zwykla linia [${type}] ma taka sama budowe jak przed zmiana`, () => {
        const page = buildPage();

        page.addLog(type, message);

        const line = page.terminalLogs.childNodes[0];

        assert.deepEqual(describeLine(line), [["SPAN", `[${type}]`], ["#text", ` ${message}`]]);
        assert.equal(line.innerHTML, `<span>[${type}]</span> ${message}`);
        assert.equal(line.textContent, `[${type}] ${message}`);
    });
}

test("B9: encje HTML w tresci nie sa rozwijane", () => {
    const page = buildPage();

    page.addLog("YT-DLP", "a &amp; b &lt;c&gt; &#60;script&#62;");

    assert.equal(page.terminalLogs.childNodes[0].textContent, "[YT-DLP] a &amp; b &lt;c&gt; &#60;script&#62;");
});

test("B9: miedzy typem a trescia jest dokladnie jedna spacja, tresc nie jest przycinana ani zmieniana", () => {
    const page = buildPage();

    page.addLog("a", "x");
    page.addLog("b", "  dwie spacje z przodu");
    page.addLog("c", "");

    const lines = page.terminalLogs.childNodes.map(line => line.textContent);

    assert.deepEqual(lines, ["[a] x", "[b]   dwie spacje z przodu", "[c] "]);
});

test("B9: tresc, ktora nie jest napisem, jest wypisywana jak dotad", () => {
    const page = buildPage();

    page.addLog("data", undefined);
    page.addLog("data", 42);
    page.addLog("data", null);

    assert.deepEqual(page.terminalLogs.childNodes.map(line => line.textContent), ["[data] undefined", "[data] 42", "[data] null"]);
});

test("B9: wiersze dochodza na koniec, tlo trzyma najwyzej 42 wiersze i przewija sie na dol", () => {
    const page = buildPage();

    for (let i = 1; i <= 50; i += 1) {
        page.addLog("n", `linia ${i}`);
    }

    const lines = page.terminalLogs.childNodes.map(line => line.textContent);

    assert.equal(lines.length, 42);
    assert.equal(lines[0], "[n] linia 9");
    assert.equal(lines[41], "[n] linia 50");
    assert.equal(page.terminalLogs.scrollTop, page.terminalLogs.scrollHeight);
    assert.deepEqual(page.innerHtmlWrites, []);
});

test("B9: w funkcji addLog nie ma innerHTML ani insertAdjacentHTML", () => {
    const source = cutFunction("function addLog(type, message) {");

    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(source), false);
});
