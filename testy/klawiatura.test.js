// Testy zadania D3: obsluga z klawiatury.
// Czytaja public/style.css i public/index.html jako tekst (bez przegladarki): pola wyboru trybu
// i przelacznik mono/stereo sa ukryte wizualnie, a nie przez display: none; sa reguly obwodki fokusu;
// pola przycinania maja aria-label, a etykieta "Przytnij" jest powiazana z #trimStart.
// Zachowanie w prawdziwej przegladarce sprawdza testy/przegladarka/klawiatura.przegladarka.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const cssSource = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");
const htmlSource = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");

// rozklada CSS na reguly: { selectors: [...], declarations: { wlasciwosc: wartosc }, media }
// wystarcza dla tego pliku: komentarze, zwykle reguly i jeden poziom @media / @keyframes
function parseCss(source) {
    const rules = [];
    const text = source.replace(/\/\*[\s\S]*?\*\//g, "");
    let position = 0;

    function readBlock(from, media) {
        let index = from;

        while (index < text.length) {
            const open = text.indexOf("{", index);
            const close = text.indexOf("}", index);

            if (close !== -1 && (open === -1 || close < open)) {
                return close + 1;
            }

            if (open === -1) {
                return text.length;
            }

            const prelude = text.slice(index, open).trim();

            if (prelude.startsWith("@media") || prelude.startsWith("@keyframes")) {
                index = readBlock(open + 1, prelude);
                continue;
            }

            const end = text.indexOf("}", open);
            const declarations = {};

            text.slice(open + 1, end).split(";").forEach((part) => {
                const colon = part.indexOf(":");

                if (colon === -1) {
                    return;
                }

                declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
            });

            rules.push({
                selectors: prelude.split(",").map(selector => selector.replace(/\s+/g, " ").trim()),
                declarations,
                media
            });

            index = end + 1;
        }

        return index;
    }

    while (position < text.length) {
        position = readBlock(position, null);
    }

    return rules;
}

const rules = parseCss(cssSource);

// wszystkie deklaracje dla danego selektora, zlozone w kolejnosci z pliku (pozniejsza wygrywa)
function declarationsFor(selector) {
    const result = {};

    rules.filter(rule => rule.selectors.includes(selector))
        .forEach(rule => Object.assign(result, rule.declarations));

    return result;
}

// atrybuty znacznika o podanym id
function attributesOf(id) {
    const match = htmlSource.match(new RegExp(`<[a-z]+\\b[^>]*\\bid="${id}"[^>]*>`));

    assert.notEqual(match, null, `w index.html nie ma elementu #${id}`);

    const attributes = {};

    for (const pair of match[0].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
        attributes[pair[1]] = pair[2];
    }

    return attributes;
}

test("D3: parser CSS z tego testu czyta plik (kontrola samego testu)", () => {
    assert.equal(declarationsFor(".choice-row").display, "flex");
    assert.equal(declarationsFor("#terminalLogs::-webkit-scrollbar").display, "none");
    assert.equal(rules.some(rule => rule.media && rule.selectors.includes(".choice")), true);
});

for (const selector of [".choice input", ".channel-switch input"]) {
    test(`D3: ${selector} - ukrycie wizualne zamiast display: none`, () => {
        const declarations = declarationsFor(selector);

        assert.equal(declarations.display, undefined, "pole z display: none jest niedostepne dla klawisza Tab");
        assert.equal(declarations.visibility, undefined, "visibility: hidden tez wylacza pole z kolejnosci Tab");
        assert.equal(declarations.position, "absolute");
        assert.equal(declarations.opacity, "0");
        assert.equal(declarations.width, "1px");
        assert.equal(declarations.height, "1px");
        assert.equal(declarations["pointer-events"], "none");
    });
}

test("D3: zadna regula nie ukrywa pol trybu ani przelacznika przez display: none / visibility: hidden", () => {
    const hiding = rules.filter(rule =>
        rule.selectors.some(selector => /(\.choice|\.channel-switch)\b.*\binput\b/.test(selector)) &&
        (rule.declarations.display === "none" || rule.declarations.visibility === "hidden"));

    assert.deepEqual(hiding, []);
});

test("D3: pole ukryte wizualnie jest pozycjonowane wzgledem swojej etykiety", () => {
    assert.equal(declarationsFor(".choice").position, "relative");
    assert.equal(declarationsFor(".channel-switch").position, "relative");
});

for (const selector of [
    ".choice input:focus-visible + span",
    ".channel-switch input:focus-visible + .switch-track",
    ".knob-dial:focus-within"
]) {
    test(`D3: ${selector} - widoczna obwodka fokusu`, () => {
        const declarations = declarationsFor(selector);

        assert.notEqual(declarations.outline, undefined, `brak reguly outline dla ${selector}`);

        const match = declarations.outline.match(/^(\d+)px solid (#[0-9a-fA-F]{6})$/);

        assert.notEqual(match, null, `nieoczekiwany zapis obwodki: ${declarations.outline}`);
        assert.equal(Number(match[1]) >= 2, true, "obwodka cienka niz 2px jest slabo widoczna");
    });
}

test("D3: obwodka fokusu nie jest przypisana do stanu bez fokusu", () => {
    for (const selector of [".choice span", ".switch-track", ".knob-dial", ".choice input:checked + span"]) {
        assert.equal(declarationsFor(selector).outline, undefined, selector);
    }
});

test("D3: #trimStart i #trimEnd maja aria-label", () => {
    assert.equal(attributesOf("trimStart")["aria-label"], "Początek przycięcia");
    assert.equal(attributesOf("trimEnd")["aria-label"], "Koniec przycięcia");
});

test("D3: etykieta Przytnij jest powiazana z #trimStart", () => {
    const match = htmlSource.match(/<label([^>]*)>\s*Przytnij\s*<\/label>/);

    assert.notEqual(match, null, "w index.html nie ma etykiety Przytnij");
    assert.match(match[1], /\bfor="trimStart"/);
});

test("D3: pola przycinania zachowuja id, name, typ i podpowiedz", () => {
    assert.deepEqual(
        { ...attributesOf("trimStart"), "aria-label": undefined },
        { id: "trimStart", name: "trimStart", type: "text", placeholder: "start", "aria-label": undefined }
    );
    assert.deepEqual(
        { ...attributesOf("trimEnd"), "aria-label": undefined },
        { id: "trimEnd", name: "trimEnd", type: "text", placeholder: "koniec", "aria-label": undefined }
    );
});
