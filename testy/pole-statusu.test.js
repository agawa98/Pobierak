// Testy zadania U1 + U3 + U4: pole statusu pod przyciskiem "Pobierz" (#statusBox).
// handleDownloadSubmit, clearStatus, showStatusError, showStatusSuccess, validateTrim i parseTimeToSeconds
// sa wycinane z public/script.js i uruchamiane bez przegladarki, na atrapie dokumentu.
// Atrapa elementu pilnuje, ze nic nie jest wstawiane przez innerHTML (kazda proba konczy test bledem).
// Nic nie pobieraja z internetu: fetch jest atrapa.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "..", "public");
const scriptSource = fs.readFileSync(path.join(publicDir, "script.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const cssSource = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");

// wycina z public/script.js cala funkcje o podanym naglowku (do pierwszej klamry } na poczatku linii)
function cutFunction(header) {
    const start = scriptSource.indexOf(header);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${header}`);

    const rest = scriptSource.slice(start);
    const end = rest.search(/\r?\n\}/);

    assert.notEqual(end, -1, `nie znaleziono konca funkcji: ${header}`);

    return rest.slice(0, end) + "\n}";
}

// atrapa elementu strony: dzieci, tekst, klasy, atrybuty. innerHTML i podobne sa zakazane
function createElement(tagName) {
    const classes = new Set();
    const attributes = new Map();

    const element = {
        tagName: String(tagName).toUpperCase(),
        children: [],
        ownText: "",
        clicks: 0,

        classList: {
            add(...names) { names.forEach(name => classes.add(name)); },
            remove(...names) { names.forEach(name => classes.delete(name)); },
            contains(name) { return classes.has(name); },
            toggle(name, force) {
                const on = force === undefined ? !classes.has(name) : Boolean(force);

                if (on) { classes.add(name); } else { classes.delete(name); }

                return on;
            }
        },

        get className() { return Array.from(classes).join(" "); },
        set className(value) {
            classes.clear();
            String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name));
        },

        get textContent() {
            return this.ownText + this.children.map(child => child.textContent).join("");
        },
        set textContent(value) {
            this.children = [];
            this.ownText = String(value);
        },

        get innerHTML() { throw new Error("odczyt innerHTML w polu statusu"); },
        set innerHTML(value) { throw new Error(`innerHTML ustawione na: ${value}`); },
        set outerHTML(value) { throw new Error(`outerHTML ustawione na: ${value}`); },
        insertAdjacentHTML() { throw new Error("insertAdjacentHTML w polu statusu"); },

        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) {
            nodes.forEach(node => this.children.push(typeof node === "string" ? createTextNode(node) : node));
        },
        replaceChildren(...nodes) { this.children = []; this.ownText = ""; this.append(...nodes); },
        removeChild(child) { this.children = this.children.filter(item => item !== child); return child; },

        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
        hasAttribute(name) { return attributes.has(name); },
        removeAttribute(name) { attributes.delete(name); },

        click() { this.clicks += 1; }
    };

    // wlasciwosci, ktore w przegladarce sa odbiciem atrybutow
    for (const name of ["href", "download", "target", "rel", "hidden"]) {
        Object.defineProperty(element, name, {
            get() { return attributes.has(name) ? attributes.get(name) : ""; },
            set(value) { attributes.set(name, String(value)); }
        });
    }

    return element;
}

function createTextNode(text) {
    return { tagName: "#text", children: [], textContent: String(text) };
}

// wszystkie elementy o danym znaczniku w srodku elementu, w kolejnosci na stronie
function findAll(element, tagName) {
    const found = [];

    for (const child of element.children) {
        if (child.tagName === tagName) {
            found.push(child);
        }

        found.push(...findAll(child, tagName));
    }

    return found;
}

// buduje strone-atrape i zwraca handleDownloadSubmit razem z tym, co test chce obejrzec
function buildPage({ trimStart = "", trimEnd = "", type = "audio", fetchImpl } = {}) {
    const logs = [];
    const fetchCalls = [];
    const created = [];       // kazdy element utworzony przez document.createElement
    const timers = [];        // opoznienia przekazane do setTimeout

    // stan poczatkowy jak w index.html: pole puste i ukryte
    const statusBox = createElement("div");
    statusBox.className = "status-box hidden";

    const body = createElement("body");

    const trimValidation = createElement("p");
    const buttonLoader = createElement("span");
    buttonLoader.className = "button-loader hidden";

    const buttonText = createElement("span");
    buttonText.textContent = "Pobierz";

    const context = {
        statusBox,
        downloadButton: { disabled: false },
        buttonLoader,
        buttonText,
        trimValidation,
        trimStartInput: { value: trimStart },
        trimEndInput: { value: trimEnd },
        resolutionSelect: { value: "best" },
        formatSelect: { value: "mp3" },
        document: {
            querySelector: () => ({ value: "https://example.invalid/film" }),
            createElement: (tagName) => {
                const element = createElement(tagName);

                created.push(element);

                return element;
            },
            createTextNode,
            body
        },
        console: { error() {} },
        // automatyczne pobieranie drugiego pliku jest opoznione; atrapa wykonuje je od razu i zapisuje opoznienie
        setTimeout: (callback, delay) => { timers.push(delay); callback(); },
        addLog: (type, message) => logs.push([type, message]),
        getSelectedType: () => type,
        getSelectedBitrate: () => "best",
        getExperimentalOptions: () => ({ trimStart, trimEnd }),
        fetch: (...args) => {
            fetchCalls.push(args);

            return fetchImpl(...args);
        }
    };

    vm.createContext(context);
    vm.runInContext([
        cutFunction("function parseTimeToSeconds(value) {"),
        cutFunction("function validateTrim() {"),
        cutFunction("function clearStatus() {"),
        cutFunction("function showStatusError(message) {"),
        cutFunction("function showStatusSuccess(files) {"),
        cutFunction("async function handleDownloadSubmit(event) {")
    ].join("\n\n"), context);

    return { context, logs, fetchCalls, created, timers, statusBox, body, buttonText, buttonLoader };
}

function submit(page) {
    return page.context.handleDownloadSubmit({ preventDefault() {} });
}

// to, co uzytkownik widzi w polu statusu
function readStatus(page) {
    const box = page.statusBox;

    return {
        visible: !box.classList.contains("hidden") && box.hidden !== "true",
        error: box.classList.contains("is-error"),
        success: box.classList.contains("is-success"),
        text: box.textContent,
        links: findAll(box, "A").map(link => ({
            text: link.textContent,
            href: link.href,
            download: link.hasAttribute("download") ? link.download : null
        }))
    };
}

// odpowiedz serwera-atrapy z JSON-em
function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// odpowiedz serwera-atrapy, ktora nie jest JSON-em (np. strona HTML)
function brokenResponse(status) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => { throw new SyntaxError("Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON"); }
    };
}

function assertButtonIdle(page) {
    assert.equal(page.context.downloadButton.disabled, false);
    assert.equal(page.buttonText.textContent, "Pobierz");
    assert.equal(page.buttonLoader.classList.contains("hidden"), true);
}

const audioName = "the #1 NO SCOPE player in rivals [0a1b2c3d].mp3";
const audioUrl = "/downloads/the%20%231%20NO%20SCOPE%20player%20in%20rivals%20%5B0a1b2c3d%5D.mp3";
const videoName = "the #1 NO SCOPE player in rivals video [0a1b2c3d].mp4";
const videoUrl = "/downloads/the%20%231%20NO%20SCOPE%20player%20in%20rivals%20video%20%5B0a1b2c3d%5D.mp4";
const separateAudioName = "the #1 NO SCOPE player in rivals audio [0a1b2c3d].mp3";
const separateAudioUrl = "/downloads/the%20%231%20NO%20SCOPE%20player%20in%20rivals%20audio%20%5B0a1b2c3d%5D.mp3";

function audioSuccess() {
    return jsonResponse(200, {
        success: true,
        message: "Pobrano audio.",
        downloadUrl: audioUrl,
        files: [{ name: audioName, url: audioUrl }],
        receivedData: {}
    });
}

function separateSuccess() {
    return jsonResponse(200, {
        success: true,
        message: "Pobrano osobno.",
        downloadUrl: separateAudioUrl,
        downloadUrls: [videoUrl, separateAudioUrl],
        files: [{ name: videoName, url: videoUrl }, { name: separateAudioName, url: separateAudioUrl }],
        receivedData: {}
    });
}

// ---------- index.html i style.css ----------

test("U1: index.html ma pod przyciskiem Pobierz ukryte pole #statusBox z aria-live=polite", () => {
    const boxes = htmlSource.match(/<[a-z]+[^>]*\bid="statusBox"[^>]*>/g) || [];

    assert.equal(boxes.length, 1, "na stronie ma byc dokladnie jedno pole #statusBox");

    const tag = boxes[0];

    assert.match(tag, /^<div\b/);
    assert.match(tag, /\baria-live="polite"/);

    const classes = (tag.match(/\bclass="([^"]*)"/) || ["", ""])[1].split(/\s+/);

    assert.equal(classes.includes("status-box"), true, tag);
    assert.equal(classes.includes("hidden") || /\shidden(\s|>|=)/.test(tag), true, "pole ma byc domyslnie ukryte");

    // pole jest puste, stoi w formularzu, zaraz po przycisku
    assert.match(htmlSource, /<\/button>\s*<div\b[^>]*\bid="statusBox"[^>]*><\/div>\s*<\/form>/);

    const buttonAt = htmlSource.indexOf('id="downloadButton"');
    const boxAt = htmlSource.indexOf('id="statusBox"');

    assert.equal(buttonAt !== -1 && buttonAt < boxAt, true);
});

test("U1: style.css ma styl pola: lamanie dlugich nazw, osobny akcent dla bledu i dla sukcesu, klasa hidden dalej chowa", () => {
    const rule = (selector) => {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = cssSource.match(new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`));

        assert.notEqual(match, null, `w style.css nie ma reguly ${selector}`);

        return match[1];
    };

    const base = rule(".status-box");

    assert.match(base, /overflow-wrap:\s*anywhere|word-break:\s*break-(word|all)/);
    assert.match(base, /border-radius:/);
    assert.match(base, /background:/);
    // regula .hidden stoi nizej w pliku; pole nie moze jej przebic wlasnym display
    assert.doesNotMatch(base, /display:/);

    const error = rule(".status-box.is-error");
    const success = rule(".status-box.is-success");

    assert.match(error, /border(-left)?-color:/);
    assert.match(success, /border(-left)?-color:/);
    assert.notEqual(error.match(/border(?:-left)?-color:\s*([^;]+);/)[1], success.match(/border(?:-left)?-color:\s*([^;]+);/)[1]);

    assert.match(rule(".hidden"), /display:\s*none/);
});

test("U1: tlo z logami (#terminalLogs) ma w style.css te same reguly co przed zadaniem", () => {
    const expected = [
        ".background-terminal-body {\n  width: 100%;\n  height: 100%;\n  padding: 22px 28px;\n  font-family: Consolas, monospace;\n  font-size: 14px;\n  line-height: 1.55;\n  color: rgba(219, 234, 254, 0.46);\n  overflow: hidden;\n  word-break: break-word;\n}",
        ".background-terminal-body p {\n  margin: 0 0 7px;\n}",
        ".background-terminal-body span {\n  color: rgba(167, 139, 250, 0.7);\n}",
        "#terminalLogs {\n  overflow-y: auto;\n  overflow-x: hidden;\n  max-height: 100vh;\n  scrollbar-width: none;\n}"
    ];

    const css = cssSource.replace(/\r\n/g, "\n");

    for (const block of expected) {
        assert.equal(css.includes(block), true, `zmieniona regula tla: ${block.split(" {")[0]}`);
    }

    // zadna regula pola statusu nie siega do tla
    assert.doesNotMatch(css, /status-box[^{]*(terminal|background-terminal)/);
    assert.doesNotMatch(css, /(terminal|background-terminal)[^{]*status-box/);
});

// ---------- blad ----------

test("U1: blad serwera - komunikat z result.message jest widoczny pod przyciskiem, z akcentem bledu", async () => {
    const message = "yt-dlp: ERROR: [youtube] abc: Video unavailable";
    const page = buildPage({ fetchImpl: async () => jsonResponse(500, { success: false, message }) });

    await submit(page);

    assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
    assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", message]]);
    assertButtonIdle(page);

    // przy bledzie nic sie nie pobiera
    assert.equal(page.created.filter(element => element.clicks > 0).length, 0);
});

test("U1: blad serwera 400 (zly link) tez trafia do pola", async () => {
    const message = "Niepoprawny link.";
    const page = buildPage({ fetchImpl: async () => jsonResponse(400, { success: false, message }) });

    await submit(page);

    assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
});

test("U1: blad serwera bez pola message - w polu jest komunikat zastepczy", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(500, {}) });

    await submit(page);

    assert.deepEqual(readStatus(page), {
        visible: true, error: true, success: false, text: "Backend zwrócił błąd.", links: []
    });
    assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", "Backend zwrócił błąd."]]);
});

const invalidTrims = [
    ["2:00", "1:00", "Początek musi być mniejszy niż koniec."],
    ["abc", "", "Użyj formatu GG:MM:SS"],
    ["", "1:75", "Użyj formatu GG:MM:SS"]
];

for (const [start, end, message] of invalidTrims) {
    test(`U1: blad walidacji przycinania (start "${start}", koniec "${end}") jest widoczny w polu statusu`, async () => {
        const page = buildPage({ trimStart: start, trimEnd: end, fetchImpl: async () => audioSuccess() });

        await submit(page);

        assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
        assert.equal(page.fetchCalls.length, 0, "zadanie nie moze wyjsc do serwera");
        assert.deepEqual(page.logs, [["error", message]]);
        assertButtonIdle(page);
    });
}

test("U1: komunikat ze znacznikami HTML jest pokazany doslownie (zaden element z niego nie powstaje)", async () => {
    const message = "ffmpeg: <img src=x onerror=alert(1)> & <b>blad</b>";
    const page = buildPage({ fetchImpl: async () => jsonResponse(500, { message }) });

    await submit(page);

    assert.equal(readStatus(page).text, message);
    assert.deepEqual(page.created.map(element => element.tagName).filter(tag => tag === "IMG" || tag === "B"), []);
});

// pole pokazuje juz wynik poprzedniego pobrania, a nastepne wyslanie konczy sie na walidacji (przed clearStatus)
for (const [label, firstAnswer] of [
    ["po udanym pobraniu", () => separateSuccess()],
    ["po bledzie serwera", () => jsonResponse(500, { message: "yt-dlp: ERROR: stary blad" })]
]) {
    test(`U1: blad walidacji przycinania ${label} zastepuje poprzednia tresc pola (sam blad, bez linkow)`, async () => {
        const page = buildPage({ fetchImpl: async () => firstAnswer() });

        await submit(page);
        assert.equal(readStatus(page).visible, true);

        // uzytkownik wpisuje bledne przyciecie i klika jeszcze raz
        page.context.trimStartInput.value = "2:00";
        page.context.trimEndInput.value = "1:00";

        await submit(page);

        assert.deepEqual(readStatus(page), {
            visible: true, error: true, success: false, text: "Początek musi być mniejszy niż koniec.", links: []
        });
        assert.equal(page.fetchCalls.length, 1, "drugie wyslanie nie moze wyjsc do serwera");
        assertButtonIdle(page);
    });
}

// ---------- start pobierania ----------

test("U1: start pobierania czysci pole - w trakcie zadania nie ma w nim poprzedniego bledu ani linkow", async () => {
    const during = [];
    let call = 0;
    let page;

    page = buildPage({
        fetchImpl: async () => {
            during.push(readStatus(page));
            call += 1;

            if (call === 1) {
                return jsonResponse(500, { message: "pierwszy blad" });
            }

            if (call === 2) {
                return audioSuccess();
            }

            return jsonResponse(500, { message: "drugi blad" });
        }
    });

    const empty = { visible: false, error: false, success: false, text: "", links: [] };

    await submit(page);
    assert.equal(readStatus(page).text, "pierwszy blad");

    await submit(page);
    assert.equal(readStatus(page).success, true);

    await submit(page);

    // trzy zadania: przed pierwszym pole puste, przed drugim wyczyszczony blad, przed trzecim wyczyszczony sukces
    assert.deepEqual(during, [empty, empty, empty]);

    // po sukcesie blad nie zostawia linkow ani akcentu sukcesu
    assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: "drugi blad", links: [] });
});

test("U1: po bledzie udane pobranie zdejmuje akcent bledu", async () => {
    let call = 0;
    const page = buildPage({
        fetchImpl: async () => {
            call += 1;

            return call === 1 ? jsonResponse(500, { message: "blad" }) : audioSuccess();
        }
    });

    await submit(page);
    await submit(page);

    const status = readStatus(page);

    assert.equal(status.error, false);
    assert.equal(status.success, true);
    assert.equal(status.text.includes("blad"), false);
});

// ---------- sukces ----------

test("U1: udane pobranie - Gotowe i link: tekst = nazwa pliku, href = adres z odpowiedzi, atrybut download", async () => {
    const page = buildPage({ fetchImpl: async () => audioSuccess() });

    await submit(page);

    const status = readStatus(page);

    assert.equal(status.visible, true);
    assert.equal(status.success, true);
    assert.equal(status.error, false);
    assert.deepEqual(status.links, [{ text: audioName, href: audioUrl, download: audioName }]);
    assert.equal(status.text, `Gotowe${audioName}`, "w polu ma byc napis Gotowe i nazwa pliku, nic wiecej");
    assert.deepEqual(page.logs.filter(([type]) => type === "error"), []);
    assert.deepEqual(page.logs.filter(([type]) => type === "success"), [["success", "Pobrano audio."]]);
    assertButtonIdle(page);
});

test("U3: tryb osobno - dwa linki z nazwami plikow, w kolejnosci z odpowiedzi serwera", async () => {
    const page = buildPage({ type: "separate", fetchImpl: async () => separateSuccess() });

    await submit(page);

    const status = readStatus(page);

    assert.equal(status.success, true);
    assert.deepEqual(status.links, [
        { text: videoName, href: videoUrl, download: videoName },
        { text: separateAudioName, href: separateAudioUrl, download: separateAudioName }
    ]);
    assert.equal(status.text, `Gotowe${videoName}${separateAudioName}`);
});

test("U1: automatyczne pobieranie zostaje - jeden plik jest klikany raz, poza polem statusu", async () => {
    const page = buildPage({ fetchImpl: async () => audioSuccess() });

    await submit(page);

    const clicked = page.created.filter(element => element.clicks > 0);

    assert.equal(clicked.length, 1);
    assert.equal(clicked[0].tagName, "A");
    assert.equal(clicked[0].clicks, 1);
    assert.equal(clicked[0].href, audioUrl);
    assert.equal(clicked[0].hasAttribute("download"), true);

    // klikany link jest tymczasowy: nie zostaje ani w polu statusu, ani na stronie
    assert.equal(findAll(page.statusBox, "A").includes(clicked[0]), false);
    assert.equal(page.body.children.length, 0);
    assert.equal(page.logs.some(([type, text]) => type === "file" && text === "Rozpoczynam automatyczne pobieranie pliku..."), true);
});

test("U3: automatyczne pobieranie zostaje - w trybie osobno klikane sa oba pliki, drugi z opoznieniem 700 ms", async () => {
    const page = buildPage({ type: "separate", fetchImpl: async () => separateSuccess() });

    await submit(page);

    const clicked = page.created.filter(element => element.clicks > 0);

    assert.deepEqual(clicked.map(element => [element.href, element.clicks]), [[videoUrl, 1], [separateAudioUrl, 1]]);
    assert.deepEqual(page.timers, [0, 700]);
    assert.equal(page.body.children.length, 0);

    // linki w polu statusu sa osobnymi elementami i same nie sa klikane
    assert.deepEqual(findAll(page.statusBox, "A").map(link => link.clicks), [0, 0]);
});

test("U1: nazwa pliku ze znacznikami HTML jest tekstem linku, a nie elementami strony", async () => {
    const name = "<img src=x onerror=alert(1)> & <b>film</b> [0a1b2c3d].mp3";
    const url = `/downloads/${encodeURIComponent(name)}`;
    const page = buildPage({
        fetchImpl: async () => jsonResponse(200, { message: "ok", downloadUrl: url, files: [{ name, url }] })
    });

    await submit(page);

    assert.deepEqual(readStatus(page).links, [{ text: name, href: url, download: name }]);
    assert.deepEqual(page.created.map(element => element.tagName).filter(tag => tag === "IMG" || tag === "B"), []);
});

test("U1: odpowiedz bez tablicy files (starszy serwer) - samo Gotowe, bez linkow i bez bledu", async () => {
    const page = buildPage({
        fetchImpl: async () => jsonResponse(200, { message: "ok", downloadUrl: audioUrl })
    });

    await submit(page);

    assert.deepEqual(readStatus(page), { visible: true, error: false, success: true, text: "Gotowe", links: [] });
    assert.equal(page.created.filter(element => element.clicks > 0).length, 1, "automatyczne pobieranie dalej dziala");
    assertButtonIdle(page);
});

test("U1: odpowiedz z pusta tablica files - samo Gotowe, bez linkow", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { message: "ok", files: [] }) });

    await submit(page);

    assert.deepEqual(readStatus(page), { visible: true, error: false, success: true, text: "Gotowe", links: [] });
});

test("U1: funkcje pola statusu nie uzywaja innerHTML, outerHTML ani insertAdjacentHTML", () => {
    for (const header of [
        "function clearStatus() {",
        "function showStatusError(message) {",
        "function showStatusSuccess(files) {",
        "async function handleDownloadSubmit(event) {"
    ]) {
        assert.doesNotMatch(cutFunction(header), /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, header);
    }
});

// ---------- U4 ----------

for (const status of [502, 404, 200]) {
    test(`U4: odpowiedz, ktora nie jest JSON-em (HTTP ${status}) - komunikat o nieoczekiwanej odpowiedzi z kodem`, async () => {
        const page = buildPage({ fetchImpl: async () => brokenResponse(status) });
        const message = `Serwer zwrócił nieoczekiwaną odpowiedź (HTTP ${status}).`;

        await submit(page);

        assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
        assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", message]]);
        assert.equal(page.logs.some(([, text]) => text === "Nie udało się połączyć z backendem."), false);
        assert.equal(page.created.filter(element => element.clicks > 0).length, 0);
        assertButtonIdle(page);
    });
}

for (const [label, body] of [["null", null], ["napis", "tekst"], ["liczba", 5]]) {
    test(`U4: poprawny JSON, ktory nie jest obiektem (${label}) - komunikat o nieoczekiwanej odpowiedzi`, async () => {
        const page = buildPage({ fetchImpl: async () => jsonResponse(200, body) });
        const message = "Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 200).";

        await submit(page);

        assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
        assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", message]]);
        assert.equal(page.created.filter(element => element.clicks > 0).length, 0);
        assertButtonIdle(page);
    });
}

test("U4: blad samego fetch - komunikat o braku polaczenia, w polu i w logach", async () => {
    const page = buildPage({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });
    const message = "Nie udało się połączyć z backendem.";

    await submit(page);

    assert.deepEqual(readStatus(page), { visible: true, error: true, success: false, text: message, links: [] });
    assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", message]]);
    assertButtonIdle(page);
});

test("U4: poprawna odpowiedz JSON nie dostaje zadnego z dwoch komunikatow o bledzie polaczenia", async () => {
    const page = buildPage({ fetchImpl: async () => audioSuccess() });

    await submit(page);

    const texts = page.logs.map(([, text]) => String(text)).concat(readStatus(page).text);

    assert.equal(texts.some(text => text.includes("Nie udało się połączyć") || text.includes("nieoczekiwaną odpowiedź")), false);
});
