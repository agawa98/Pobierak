// Testy zadania B1: przycisk "Pobierz" nie blokuje sie po bledzie walidacji przycinania.
// handleDownloadSubmit, validateTrim i parseTimeToSeconds sa wycinane z public/script.js i uruchamiane
// bez przegladarki, na atrapach elementow strony. Atrapa przycisku zapisuje KAZDA zmiane stanu
// (disabled, napis, kolko ladowania), wiec widac tez zmiane cofnieta przed koncem funkcji.
// Nic nie pobieraja z internetu: fetch jest atrapa.

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

// buduje strone-atrape i zwraca handleDownloadSubmit razem z tym, co test chce obejrzec
function buildPage({ trimStart = "", trimEnd = "", fetchImpl } = {}) {
    const changes = [];   // kazda zmiana stanu przycisku, po kolei
    const logs = [];      // wpisy addLog
    const fetchCalls = [];

    const downloadButton = {
        _disabled: false,
        get disabled() { return this._disabled; },
        set disabled(value) { this._disabled = value; changes.push(`disabled=${value}`); }
    };

    const loaderClasses = new Set(["button-loader", "hidden"]);
    const buttonLoader = {
        classList: {
            add(name) { loaderClasses.add(name); changes.push(`loader+${name}`); },
            remove(name) { loaderClasses.delete(name); changes.push(`loader-${name}`); },
            contains(name) { return loaderClasses.has(name); }
        }
    };

    const buttonText = {
        _text: "Pobierz",
        get textContent() { return this._text; },
        set textContent(value) { this._text = value; changes.push(`napis=${value}`); }
    };

    const validationClasses = new Set();
    const trimValidation = {
        textContent: "",
        classList: {
            add(name) { validationClasses.add(name); },
            remove(name) { validationClasses.delete(name); },
            contains(name) { return validationClasses.has(name); }
        }
    };

    const context = {
        downloadButton,
        buttonLoader,
        buttonText,
        trimValidation,
        trimStartInput: { value: trimStart },
        trimEndInput: { value: trimEnd },
        resolutionSelect: { value: "best" },
        formatSelect: { value: "mp3" },
        document: {
            querySelector: () => ({ value: "https://example.invalid/film" }),
            createElement: () => ({ click() {} }),
            body: { appendChild() {}, removeChild() {} }
        },
        console: { error() {} },
        setTimeout,
        addLog: (type, message) => logs.push([type, message]),
        // pole statusu (zadanie U1 + U3 + U4) ma wlasne testy w pole-statusu.test.js; tu wystarcza puste funkcje
        clearStatus() {},
        showStatusError() {},
        showStatusSuccess() {},
        getSelectedType: () => "audio",
        getSelectedBitrate: () => "best",
        // sprawdzanie linku (zadanie BUG-1a) ma wlasne testy w link.test.js; tu link jest zawsze przyjety
        validateUrl: () => true,
        // folder docelowy (zadanie UL-2c) ma wlasne testy w folder-strona.test.js; tu folder jest zawsze wybrany
        getTargetFolder: () => "C:\\Pobrane",
        isFolderError: () => false,
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
        cutFunction("async function handleDownloadSubmit(event) {")
    ].join("\n\n"), context);

    return { context, changes, logs, fetchCalls, downloadButton, buttonLoader, buttonText, trimValidation };
}

function submit(page) {
    let prevented = 0;

    return page.context.handleDownloadSubmit({ preventDefault() { prevented += 1; } }).then(() => prevented);
}

// odpowiedz serwera-atrapy
function jsonResponse(status, body) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// bledne ustawienia przycinania: [start, koniec, oczekiwany komunikat]
const invalidTrims = [
    ["2:00", "1:00", "Początek musi być mniejszy niż koniec."],   // przyklad z zadania
    ["1:00", "1:00", "Początek musi być mniejszy niż koniec."],
    ["1:30", "90", "Początek musi być mniejszy niż koniec."],
    ["abc", "", "Użyj formatu GG:MM:SS"],
    ["", "1:75", "Użyj formatu GG:MM:SS"],
    ["-5", "10", "Użyj formatu GG:MM:SS"]
];

for (const [start, end, message] of invalidTrims) {
    test(`B1: bledne przyciecie (start "${start}", koniec "${end}") nie zmienia stanu przycisku ani na chwile`, async () => {
        const page = buildPage({
            trimStart: start,
            trimEnd: end,
            fetchImpl: async () => jsonResponse(200, { message: "ok" })
        });

        const prevented = await submit(page);

        assert.equal(prevented, 1, "formularz nie moze przeladowac strony");
        assert.deepEqual(page.changes, [], "przycisk nie moze byc ruszany przy bledzie walidacji");
        assert.equal(page.downloadButton.disabled, false);
        assert.equal(page.buttonText.textContent, "Pobierz");
        assert.equal(page.buttonLoader.classList.contains("hidden"), true);

        // blad trafia do logow i pod pola, a zadanie do serwera nie wychodzi
        assert.deepEqual(page.logs, [["error", message]]);
        assert.equal(page.trimValidation.textContent, message);
        assert.equal(page.trimValidation.classList.contains("is-error"), true);
        assert.equal(page.fetchCalls.length, 0);
    });
}

test("B1: poprawne przyciecie - przycisk jest wylaczony na czas zadania i wraca do stanu poczatkowego", async () => {
    let duringFetch = null;

    const page = buildPage({
        trimStart: "1:00",
        trimEnd: "2:00",
        fetchImpl: async () => {
            duringFetch = {
                disabled: page.downloadButton.disabled,
                text: page.buttonText.textContent,
                loaderHidden: page.buttonLoader.classList.contains("hidden")
            };

            return jsonResponse(200, { message: "Pobrano." });
        }
    });

    await submit(page);

    assert.deepEqual(duringFetch, { disabled: true, text: "Pobieram...", loaderHidden: false });
    assert.deepEqual(page.changes, [
        "disabled=true", "loader-hidden", "napis=Pobieram...",
        "disabled=false", "loader+hidden", "napis=Pobierz"
    ]);

    assert.equal(page.fetchCalls.length, 1);
    assert.equal(page.fetchCalls[0][0], "/api/download");
    assert.equal(page.fetchCalls[0][1].method, "POST");
    assert.deepEqual(JSON.parse(page.fetchCalls[0][1].body).experimental, { trimStart: "1:00", trimEnd: "2:00" });
    // UL-2c: zadanie niesie wybrany folder docelowy
    assert.equal(JSON.parse(page.fetchCalls[0][1].body).folder, "C:\\Pobrane");
    assert.equal(page.logs.some(([type]) => type === "error"), false);
});

test("B1: bez przyciecia przycisk dziala jak dotad", async () => {
    const page = buildPage({ fetchImpl: async () => jsonResponse(200, { message: "Pobrano." }) });

    await submit(page);

    assert.deepEqual(page.changes, [
        "disabled=true", "loader-hidden", "napis=Pobieram...",
        "disabled=false", "loader+hidden", "napis=Pobierz"
    ]);
    assert.equal(page.fetchCalls.length, 1);
});

test("B1: przycisk wraca do stanu poczatkowego takze po bledzie serwera i po bledzie polaczenia", async () => {
    const serverError = buildPage({ fetchImpl: async () => jsonResponse(500, { message: "yt-dlp: ERROR: brak filmu" }) });

    await submit(serverError);

    assert.equal(serverError.downloadButton.disabled, false);
    assert.equal(serverError.buttonText.textContent, "Pobierz");
    assert.equal(serverError.buttonLoader.classList.contains("hidden"), true);
    assert.deepEqual(serverError.logs.filter(([type]) => type === "error"), [["error", "yt-dlp: ERROR: brak filmu"]]);

    const noConnection = buildPage({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } });

    await submit(noConnection);

    assert.equal(noConnection.downloadButton.disabled, false);
    assert.equal(noConnection.buttonText.textContent, "Pobierz");
    assert.equal(noConnection.buttonLoader.classList.contains("hidden"), true);
    assert.deepEqual(noConnection.logs.filter(([type]) => type === "error"), [["error", "Nie udało się połączyć z backendem."]]);
});

test("B1: po bledzie walidacji wystarczy poprawic czas i wyslac jeszcze raz", async () => {
    const page = buildPage({
        trimStart: "2:00",
        trimEnd: "1:00",
        fetchImpl: async () => jsonResponse(200, { message: "Pobrano." })
    });

    await submit(page);

    assert.deepEqual(page.changes, []);
    assert.equal(page.fetchCalls.length, 0);

    // uzytkownik poprawia koniec
    page.context.trimEndInput.value = "3:00";

    await submit(page);

    assert.equal(page.fetchCalls.length, 1);
    assert.equal(page.downloadButton.disabled, false);
    assert.equal(page.buttonText.textContent, "Pobierz");
    assert.equal(page.trimValidation.textContent, "");
    assert.equal(page.trimValidation.classList.contains("is-error"), false);
});
