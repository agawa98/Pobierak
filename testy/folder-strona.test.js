// Testy zadania UL-2c: wybor folderu docelowego na stronie (wiersz pod przyciskiem "Pobierz").
// Czesc public/script.js od "// ---------- folder docelowy" do toggleExperimentalPanel jest wycinana i uruchamiana
// bez przegladarki, na atrapach elementow strony, localStorage i fetch. Prawdziwe okno wyboru folderu sie nie otwiera:
// odpowiedz POST /api/folder/wybierz podstawia test.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const publicDir = path.join(__dirname, "..", "public");
const scriptSource = fs.readFileSync(path.join(publicDir, "script.js"), "utf8");
const htmlSource = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

const storageKey = "pobierak.folderDocelowy";
const hint = "Najpierw wybierz folder docelowy";

function cutFolderPart() {
    const startMark = "// ---------- folder docelowy (zadanie UL-2c) ----------";
    const endMark = "function toggleExperimentalPanel() {";
    const start = scriptSource.indexOf(startMark);
    const end = scriptSource.indexOf(endMark);

    assert.notEqual(start, -1, `w public/script.js nie ma: ${startMark}`);
    assert.ok(end > start, "obsluga folderu ma stac przed toggleExperimentalPanel");

    return scriptSource.slice(start, end);
}

// atrapa elementu: tekst, klasy, atrybuty, disabled, value, focus
function createElement() {
    const classes = new Set();
    const attributes = new Map();

    return {
        textContent: "",
        value: "",
        disabled: false,
        focused: 0,
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
        setAttribute(name, value) { attributes.set(name, String(value)); },
        getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
        removeAttribute(name) { attributes.delete(name); },
        focus() { this.focused += 1; }
    };
}

// atrapa localStorage; broken = kazda operacja rzuca (np. zablokowany w przegladarce)
function createStorage(initial = {}, broken = false) {
    const data = new Map(Object.entries(initial));

    return {
        data,
        getItem(key) {
            if (broken) { throw new Error("SecurityError"); }
            return data.has(key) ? data.get(key) : null;
        },
        setItem(key, value) {
            if (broken) { throw new Error("SecurityError"); }
            data.set(key, String(value));
        }
    };
}

function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// buduje strone-atrape: stan poczatkowy jak w index.html i start strony jak na koncu script.js
function buildPage({ saved = {}, brokenStorage = false, fetchImpl = async () => jsonResponse(200, {}), downloading = false } = {}) {
    const logs = [];
    const fetchCalls = [];

    const downloadButton = createElement();
    downloadButton.disabled = true;
    downloadButton.setAttribute("title", hint);

    const folderPath = createElement();
    folderPath.textContent = "nie wybrano";
    folderPath.classList.add("folder-path", "is-empty");

    const folderManual = createElement();
    folderManual.classList.add("folder-manual", "hidden");

    const folderMessage = createElement();
    folderMessage.textContent = hint;

    const context = {
        downloadButton,
        folderBlock: createElement(),
        folderPath,
        chooseFolderButton: createElement(),
        folderManual,
        folderManualInput: createElement(),
        folderMessage,
        isDownloading: downloading,
        localStorage: createStorage(saved, brokenStorage),
        console: { error() {} },
        addLog: (type, message) => logs.push([type, message]),
        fetch: (...args) => {
            fetchCalls.push(args);
            return fetchImpl(...args);
        }
    };

    vm.createContext(context);
    vm.runInContext(cutFolderPart(), context);
    // start strony (ostatnie linie public/script.js)
    vm.runInContext("targetFolder = readSavedFolder();\nupdateFolderView();", context);

    return { context, logs, fetchCalls, storage: context.localStorage };
}

// to, co uzytkownik widzi w wierszu folderu i na przycisku "Pobierz"
function readView(page) {
    const c = page.context;

    return {
        path: c.folderPath.textContent,
        empty: c.folderPath.classList.contains("is-empty"),
        downloadDisabled: c.downloadButton.disabled,
        title: c.downloadButton.getAttribute("title"),
        message: c.folderMessage.textContent,
        messageError: c.folderMessage.classList.contains("is-error"),
        manualVisible: !c.folderManual.classList.contains("hidden"),
        rowError: c.folderBlock.classList.contains("is-error")
    };
}

const chosen = "C:\\Pobrane\\Filmy z YouTube";

// ---------- index.html ----------

test("UL-2c: index.html - pod przyciskiem Pobierz wiersz Folder docelowy: nie wybrano i przycisk Wybierz folder…", () => {
    const buttonAt = htmlSource.indexOf('id="downloadButton"');
    const blockAt = htmlSource.indexOf('id="folderBlock"');
    const statusAt = htmlSource.indexOf('id="statusBox"');

    assert.equal(buttonAt !== -1 && buttonAt < blockAt && blockAt < statusAt, true, "kolejnosc: Pobierz, folder, pole statusu");

    const block = htmlSource.slice(blockAt, statusAt);

    assert.match(block, /Folder docelowy:/);
    assert.match(block, /id="folderPath"[^>]*>nie wybrano</);
    assert.match(block, /<button\b[^>]*type="button"[^>]*id="chooseFolderButton"[^>]*>Wybierz folder…<\/button>/);
    // pole reczne jest na starcie schowane
    assert.match(block, /class="folder-manual hidden" id="folderManual"/);
    assert.match(block, /<input\b[^>]*id="folderManualInput"/);
    // przyciski folderu nie wysylaja formularza
    assert.doesNotMatch(block, /type="submit"/);

    // przycisk Pobierz jest wylaczony od poczatku (zanim skrypt odczyta zapamietany folder)
    const buttonTag = htmlSource.match(/<button\b[^>]*id="downloadButton"[^>]*>/)[0];

    assert.match(buttonTag, /\sdisabled(\s|>)/);
    assert.match(buttonTag, new RegExp(`title="${hint}"`));
});

// ---------- bez folderu ----------

test("UL-2c: bez folderu - Folder docelowy: nie wybrano, Pobierz wylaczony z podpowiedzia", () => {
    const page = buildPage();

    assert.deepEqual(readView(page), {
        path: "nie wybrano", empty: true, downloadDisabled: true, title: hint,
        message: hint, messageError: false, manualVisible: false, rowError: false
    });
    assert.equal(page.context.getTargetFolder(), "");
});

test("UL-2c: pusta albo biala wartosc w localStorage to brak folderu", () => {
    for (const value of ["", "   "]) {
        const page = buildPage({ saved: { [storageKey]: value } });

        assert.equal(readView(page).downloadDisabled, true, JSON.stringify(value));
        assert.equal(readView(page).path, "nie wybrano");
    }
});

// ---------- wybor przez okno ----------

test("UL-2c: Wybierz folder… wola POST /api/folder/wybierz; wybrana sciezka jest widoczna, trafia do localStorage, Pobierz sie wlacza", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { success: true, result: "selected", folder: chosen }) });

    await page.context.handleChooseFolder();

    assert.equal(page.fetchCalls.length, 1);
    assert.equal(page.fetchCalls[0][0], "/api/folder/wybierz");
    assert.equal(page.fetchCalls[0][1].method, "POST");

    assert.deepEqual(readView(page), {
        path: chosen, empty: false, downloadDisabled: false, title: null,
        message: "", messageError: false, manualVisible: false, rowError: false
    });
    assert.equal(page.storage.data.get(storageKey), chosen);
    assert.equal(page.context.getTargetFolder(), chosen);
    assert.equal(page.logs.some(([, text]) => text === `Folder docelowy: ${chosen}`), true);
});

test("UL-2c: po ponownym otwarciu strony zapamietany folder jest odczytany, a Pobierz wlaczony", () => {
    const page = buildPage({ saved: { [storageKey]: chosen } });

    assert.deepEqual(readView(page), {
        path: chosen, empty: false, downloadDisabled: false, title: null,
        message: "", messageError: false, manualVisible: false, rowError: false
    });
    assert.equal(page.context.getTargetFolder(), chosen);
});

test("UL-2c: script.js na starcie odczytuje zapamietany folder i odswieza wiersz", () => {
    const tail = scriptSource.slice(scriptSource.lastIndexOf("updateOptions();"));

    assert.match(tail, /targetFolder = readSavedFolder\(\);\s*updateFolderView\(\);/);
});

test("UL-2c: nowy wybor zastepuje poprzedni folder", async () => {
    const page = buildPage({
        saved: { [storageKey]: "C:\\Stary" },
        fetchImpl: async () => jsonResponse(200, { result: "selected", folder: chosen })
    });

    await page.context.handleChooseFolder();

    assert.equal(readView(page).path, chosen);
    assert.equal(page.storage.data.get(storageKey), chosen);
});

test("UL-2c: okno zamkniete bez wyboru - nic sie nie zmienia (ani pusty stan, ani poprzedni folder)", async () => {
    const empty = buildPage({ fetchImpl: async () => jsonResponse(200, { success: false, result: "cancelled" }) });

    await empty.context.handleChooseFolder();

    assert.equal(readView(empty).path, "nie wybrano");
    assert.equal(readView(empty).downloadDisabled, true);
    assert.equal(readView(empty).manualVisible, false);
    assert.equal(empty.storage.data.has(storageKey), false);

    const withFolder = buildPage({
        saved: { [storageKey]: chosen },
        fetchImpl: async () => jsonResponse(200, { success: false, result: "cancelled" })
    });

    await withFolder.context.handleChooseFolder();

    assert.equal(readView(withFolder).path, chosen);
    assert.equal(readView(withFolder).downloadDisabled, false);
    assert.equal(withFolder.storage.data.get(storageKey), chosen);
});

test("UL-2c: przycisk Wybierz folder… jest wylaczony, dopoki okno jest otwarte, i wraca po odpowiedzi", async () => {
    let answer;
    const page = buildPage({ fetchImpl: () => new Promise((resolve) => { answer = resolve; }) });

    const running = page.context.handleChooseFolder();

    assert.equal(page.context.chooseFolderButton.disabled, true);

    answer(jsonResponse(200, { result: "cancelled" }));
    await running;

    assert.equal(page.context.chooseFolderButton.disabled, false);
});

test("UL-2c: wybor folderu w trakcie pobierania nie wlacza przycisku Pobierz", async () => {
    const page = buildPage({ downloading: true, fetchImpl: async () => jsonResponse(200, { result: "selected", folder: chosen }) });

    // w trakcie pobierania handleDownloadSubmit trzyma przycisk wylaczony
    page.context.downloadButton.disabled = true;

    await page.context.handleChooseFolder();

    assert.equal(readView(page).path, chosen);
    assert.equal(page.context.downloadButton.disabled, true);
});

// ---------- okna nie da sie otworzyc: pole reczne ----------

test("UL-2c: odpowiedz okna nie da sie otworzyc - pokazuje pole do recznego wklejenia sciezki z komunikatem serwera", async () => {
    const reason = "Nie można otworzyć okna wyboru folderu: brak zenity i kdialog.";
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { success: false, result: "unavailable", message: reason }) });

    await page.context.handleChooseFolder();

    const view = readView(page);

    assert.equal(view.manualVisible, true);
    assert.equal(view.message, `${reason} Wklej ścieżkę folderu ręcznie.`);
    assert.equal(view.messageError, true);
    assert.equal(view.downloadDisabled, true, "samo pokazanie pola nie ustawia folderu");
    assert.equal(page.context.folderManualInput.focused, 1);
    assert.deepEqual(page.logs.filter(([type]) => type === "error"), [["error", reason]]);
});

test("UL-2c: pole reczne - zapisana sciezka jest ustawiana jak z okna (widoczna, w localStorage, pole sie chowa)", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { result: "unavailable", message: "Brak okna." }) });

    await page.context.handleChooseFolder();

    page.context.folderManualInput.value = `  ${chosen}  `;
    page.context.handleManualFolderSave();

    assert.deepEqual(readView(page), {
        path: chosen, empty: false, downloadDisabled: false, title: null,
        message: "", messageError: false, manualVisible: false, rowError: false
    });
    assert.equal(page.storage.data.get(storageKey), chosen);
});

test("UL-2c: pole reczne - pusta sciezka nie jest zapisywana, pojawia sie komunikat", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { result: "unavailable", message: "Brak okna." }) });

    await page.context.handleChooseFolder();

    page.context.folderManualInput.value = "   ";
    page.context.handleManualFolderSave();

    const view = readView(page);

    assert.equal(view.path, "nie wybrano");
    assert.equal(view.downloadDisabled, true);
    assert.equal(view.manualVisible, true);
    assert.equal(view.message, "Wklej pełną ścieżkę folderu.");
    assert.equal(view.messageError, true);
    assert.equal(page.storage.data.has(storageKey), false);
});

test("UL-2c: pole reczne dostaje na start obecny folder", async () => {
    const page = buildPage({
        saved: { [storageKey]: chosen },
        fetchImpl: async () => jsonResponse(200, { result: "unavailable", message: "Brak okna." })
    });

    await page.context.handleChooseFolder();

    assert.equal(page.context.folderManualInput.value, chosen);
});

test("UL-2c: odpowiedz bez znanego result traktowana jak brak okna (pole reczne)", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { result: "selected", folder: "" }) });

    await page.context.handleChooseFolder();

    assert.equal(readView(page).manualVisible, true);
    assert.equal(readView(page).path, "nie wybrano");
});

// ---------- bledy polaczenia ----------

test("UL-2c: brak polaczenia z serwerem - komunikat pod wierszem folderu, bez pola recznego, folder bez zmian", async () => {
    const page = buildPage({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });

    await page.context.handleChooseFolder();

    const view = readView(page);

    assert.equal(view.message, "Nie udało się połączyć z backendem.");
    assert.equal(view.messageError, true);
    assert.equal(view.manualVisible, false);
    assert.equal(view.path, "nie wybrano");
    assert.equal(page.context.chooseFolderButton.disabled, false);
});

test("UL-2c: odpowiedz, ktora nie jest JSON-em, albo blad HTTP (np. 403) - komunikat, bez pola recznego", async () => {
    const notJson = buildPage({
        fetchImpl: async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError("Unexpected token"); } })
    });

    await notJson.context.handleChooseFolder();

    assert.equal(readView(notJson).message, "Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 502).");
    assert.equal(readView(notJson).manualVisible, false);

    const forbidden = buildPage({ fetchImpl: async () => jsonResponse(403, { success: false, message: "Dostęp tylko z tego komputera." }) });

    await forbidden.context.handleChooseFolder();

    assert.equal(readView(forbidden).message, "Dostęp tylko z tego komputera.");
    assert.equal(readView(forbidden).manualVisible, false);
    assert.equal(readView(forbidden).path, "nie wybrano");
});

// ---------- localStorage niedostepny ----------

test("UL-2c: zablokowany localStorage - strona dziala, folder wybrany w tej sesji jest uzywany", async () => {
    const page = buildPage({ brokenStorage: true, fetchImpl: async () => jsonResponse(200, { result: "selected", folder: chosen }) });

    assert.equal(readView(page).path, "nie wybrano");

    await page.context.handleChooseFolder();

    assert.equal(readView(page).path, chosen);
    assert.equal(readView(page).downloadDisabled, false);
    assert.equal(page.context.getTargetFolder(), chosen);
});

// ---------- blad folderu z serwera ----------

test("UL-2c: isFolderError - tylko odpowiedz 400 o folderze", () => {
    const page = buildPage();
    const check = page.context.isFolderError;

    assert.equal(check(400, "Nie wybrano folderu docelowego."), true);
    assert.equal(check(400, "Folder docelowy musi być pełną ścieżką: Pobrane"), true);
    assert.equal(check(400, "Folder docelowy nie istnieje: C:\\Brak"), true);
    assert.equal(check(400, "Nie można zapisywać w folderze docelowym: C:\\Windows"), true);

    assert.equal(check(400, "Niepoprawny link."), false);
    assert.equal(check(400, "To link do kanału. Wklej link do jednego filmu."), false);
    assert.equal(check(500, "Folder docelowy nie istnieje: C:\\Brak"), false);
});

test("UL-2c: markFolderError - wiersz folderu na czerwono z prosba o wybor od nowa; nowy wybor to zdejmuje", async () => {
    const page = buildPage({
        saved: { [storageKey]: "C:\\Usuniety" },
        fetchImpl: async () => jsonResponse(200, { result: "selected", folder: chosen })
    });

    page.context.markFolderError();

    let view = readView(page);

    assert.equal(view.rowError, true);
    assert.equal(view.message, "Wybierz folder docelowy od nowa.");
    assert.equal(view.messageError, true);
    // przycisk "Wybierz folder…" dalej dziala
    assert.equal(page.context.chooseFolderButton.disabled, false);

    await page.context.handleChooseFolder();

    view = readView(page);

    assert.equal(view.rowError, false);
    assert.equal(view.message, "");
    assert.equal(view.path, chosen);
});
