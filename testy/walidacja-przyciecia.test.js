// Testy zadania B13b: usuniecie martwej walidacji dlugosci filmu.
// Zmienna videoDurationSeconds nigdy nie dostawala wartosci, wiec warunek "koniec nie moze byc wiekszy
// niz dlugosc filmu" nigdy nie dzialal. Po usunieciu validateTrim ma dzialac dokladnie jak wczesniej.
// validateTrim i parseTimeToSeconds sa wycinane z public/script.js i uruchamiane bez przegladarki,
// na atrapach pol. W atrapie strony NIE MA zmiennej videoDurationSeconds: gdyby validateTrim dalej
// z niej korzystal, kazde poprawne przyciecie konczyloby sie bledem ReferenceError.

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

// buduje atrapy pol "Przytnij" i pola komunikatu; zwraca validateTrim ze strony
function buildPage({ trimStart = "", trimEnd = "", previousMessage = "", previousError = false } = {}) {
    const classes = new Set(previousError ? ["validation-message", "is-error"] : ["validation-message"]);

    const context = {
        trimStartInput: { value: trimStart },
        trimEndInput: { value: trimEnd },
        trimValidation: {
            textContent: previousMessage,
            classList: {
                add(name) { classes.add(name); },
                remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            }
        }
    };

    vm.createContext(context);
    vm.runInContext([
        cutFunction("function parseTimeToSeconds(value) {"),
        cutFunction("function validateTrim() {")
    ].join("\n\n"), context);

    return { context, classes };
}

// wynik walidacji tak, jak go widzi uzytkownik
function validate(options) {
    const page = buildPage(options);
    const result = page.context.validateTrim();

    return {
        result,
        text: page.context.trimValidation.textContent,
        isError: page.classes.has("is-error"),
        classes: [...page.classes].sort()
    };
}

test("B13b: w public/script.js nie ma zmiennej videoDurationSeconds ani komunikatu o dlugosci filmu", () => {
    assert.equal(scriptSource.includes("videoDurationSeconds"), false);
    assert.equal(/videoDuration/i.test(scriptSource), false, "zostala zmienna o podobnej nazwie");
    assert.equal(scriptSource.includes("długość filmu"), false, "zostal komunikat martwego warunku");
});

test("B13b: public/script.js dalej jest poprawnym skryptem", () => {
    assert.doesNotThrow(() => new vm.Script(scriptSource, { filename: "script.js" }));
});

test("B13b: validateTrim nie korzysta z zadnej zmiennej poza polami formularza", () => {
    const body = cutFunction("function validateTrim() {");
    const allowed = new Set([
        "function", "validateTrim", "const", "start", "end", "parseTimeToSeconds", "trimStartInput", "trimEndInput",
        "value", "trimValidation", "textContent", "classList", "remove", "add", "if", "return", "true", "false",
        "null", "Number", "isNaN"
    ]);

    // napisy (komunikaty) nie sa nazwami
    const names = body.replace(/"[^"]*"/g, "").match(/[A-Za-z_$][\w$]*/g);
    const unknown = [...new Set(names)].filter(name => !allowed.has(name));

    assert.deepEqual(unknown, []);
});

// poprawne ustawienia: [start, koniec]
const validTrims = [
    ["", ""],
    ["90", ""],
    ["", "90"],
    ["", "0"],
    ["0", ""],
    ["0", "1"],
    ["5", "12"],
    ["1:00", "2:00"],
    ["1:29", "90"],
    ["59:59", "1:00:00"],
    ["  5 ", " 12  "],
    // bardzo dalekie konce: nie ma zadnego limitu dlugosci filmu (i nie bylo, bo warunek byl martwy)
    ["", "3600"],
    ["", "99:59:59"],
    ["0", "100:00:00"],
    ["10:00:00", "9999:59:59"],
    ["", "999999999"]
];

for (const [start, end] of validTrims) {
    test(`B13b: poprawne przyciecie (start "${start}", koniec "${end}") przechodzi walidacje bez komunikatu`, () => {
        assert.deepEqual(validate({ trimStart: start, trimEnd: end }), {
            result: true,
            text: "",
            isError: false,
            classes: ["validation-message"]
        });
    });
}

// bledne ustawienia: [start, koniec, oczekiwany komunikat]
const invalidTrims = [
    ["2:00", "1:00", "Początek musi być mniejszy niż koniec."],
    ["1:00", "1:00", "Początek musi być mniejszy niż koniec."],
    ["1:30", "90", "Początek musi być mniejszy niż koniec."],
    ["0", "0", "Początek musi być mniejszy niż koniec."],
    ["100:00:00", "99:59:59", "Początek musi być mniejszy niż koniec."],
    ["abc", "", "Użyj formatu GG:MM:SS"],
    ["", "abc", "Użyj formatu GG:MM:SS"],
    ["", "1:75", "Użyj formatu GG:MM:SS"],
    ["-5", "10", "Użyj formatu GG:MM:SS"],
    ["5", "-10", "Użyj formatu GG:MM:SS"],
    ["1.5", "", "Użyj formatu GG:MM:SS"],
    // blad formatu ma pierwszenstwo przed kolejnoscia czasow
    ["2:00", "1:99", "Użyj formatu GG:MM:SS"]
];

for (const [start, end, message] of invalidTrims) {
    test(`B13b: bledne przyciecie (start "${start}", koniec "${end}") daje komunikat "${message}"`, () => {
        assert.deepEqual(validate({ trimStart: start, trimEnd: end }), {
            result: false,
            text: message,
            isError: true,
            classes: ["is-error", "validation-message"]
        });
    });
}

test("B13b: poprawne przyciecie kasuje wczesniejszy komunikat bledu", () => {
    assert.deepEqual(validate({
        trimStart: "5",
        trimEnd: "99:59:59",
        previousMessage: "Początek musi być mniejszy niż koniec.",
        previousError: true
    }), { result: true, text: "", isError: false, classes: ["validation-message"] });
});

test("B13b: kolejne wywolania na tej samej stronie - blad, poprawka, znowu blad", () => {
    const page = buildPage({ trimStart: "2:00", trimEnd: "1:00" });

    assert.equal(page.context.validateTrim(), false);
    assert.equal(page.context.trimValidation.textContent, "Początek musi być mniejszy niż koniec.");
    assert.equal(page.classes.has("is-error"), true);

    page.context.trimEndInput.value = "5:00:00";

    assert.equal(page.context.validateTrim(), true);
    assert.equal(page.context.trimValidation.textContent, "");
    assert.equal(page.classes.has("is-error"), false);

    page.context.trimStartInput.value = "x";

    assert.equal(page.context.validateTrim(), false);
    assert.equal(page.context.trimValidation.textContent, "Użyj formatu GG:MM:SS");
    assert.equal(page.classes.has("is-error"), true);
});
