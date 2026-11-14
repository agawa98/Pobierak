// Testy zadania D2: font Space Grotesk z plikow lokalnych.
// Czytaja public/style.css, public/index.html i public/script.js jako tekst oraz pliki z public/fonts/:
// nie ma juz odwolan do Google, reguly @font-face wskazuja istniejace pliki woff2, obejmuja wagi 400, 600, 700
// i polskie znaki, maja font-display: swap, a obok fontu lezy licencja OFL. Serwer wydaje pliki fontu.
// Faktyczne wyswietlanie i zadania sieciowe sprawdza testy/przegladarka/font.przegladarka.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const fontsDir = path.join(publicDir, "fonts");
const cssSource = fs.readFileSync(path.join(publicDir, "style.css"), "utf8");
const cssWithoutComments = cssSource.replace(/\/\*[\s\S]*?\*\//g, "");

// wszystkie bloki @font-face z pliku: { family, style, weight, display, src, unicodeRange }
function readFontFaces(source) {
    const faces = [];

    for (const match of source.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
        const declarations = {};

        match[1].split(";").forEach((part) => {
            const colon = part.indexOf(":");

            if (colon !== -1) {
                declarations[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
            }
        });

        faces.push(declarations);
    }

    return faces;
}

const fontFaces = readFontFaces(cssWithoutComments);
const spaceGroteskFaces = fontFaces.filter(face => /^['"]?Space Grotesk['"]?$/.test(face["font-family"] || ""));

// adresy z deklaracji src: [{ url, format }]
function readSources(face) {
    return [...(face.src || "").matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/g)]
        .map(match => ({ url: match[1], format: match[2] }));
}

// czy regula obejmuje dana wage: "400" albo zakres "300 700"; brak deklaracji znaczy 400
function coversWeight(face, weight) {
    const parts = (face["font-weight"] || "400").split(/\s+/).map((part) => {
        if (part === "normal") return 400;
        if (part === "bold") return 700;
        return Number(part);
    });

    if (parts.some(Number.isNaN)) {
        return false;
    }

    return parts.length === 1 ? parts[0] === weight : parts[0] <= weight && weight <= parts[1];
}

// czy regula obejmuje dany znak: brak unicode-range znaczy wszystkie znaki
function coversCharacter(face, character) {
    const range = face["unicode-range"];

    if (!range) {
        return true;
    }

    const code = character.codePointAt(0);

    return range.split(",").some((part) => {
        const match = part.trim().match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);

        if (!match) {
            return false;
        }

        const from = parseInt(match[1], 16);
        const to = match[2] ? parseInt(match[2], 16) : from;

        return from <= code && code <= to;
    });
}

// plik na dysku, na ktory wskazuje adres z CSS (adres jest wzgledem style.css, czyli folderu public)
function fileForUrl(url) {
    return path.join(publicDir, ...url.split("/"));
}

test("D2: kontrola samego testu - czytanie regul @font-face", () => {
    const sample = readFontFaces("@font-face { font-family: 'X'; font-weight: 300 700; src: url('a/b.woff2') format('woff2'); unicode-range: U+0100-017F, U+20AC; }");

    assert.equal(sample.length, 1);
    assert.deepEqual(readSources(sample[0]), [{ url: "a/b.woff2", format: "woff2" }]);
    assert.equal(coversWeight(sample[0], 300), true);
    assert.equal(coversWeight(sample[0], 600), true);
    assert.equal(coversWeight(sample[0], 800), false);
    assert.equal(coversWeight({ "font-weight": "600" }, 600), true);
    assert.equal(coversWeight({ "font-weight": "600" }, 700), false);
    assert.equal(coversWeight({}, 400), true);
    assert.equal(coversCharacter(sample[0], "ą"), true);
    assert.equal(coversCharacter(sample[0], "€"), true);
    assert.equal(coversCharacter(sample[0], "a"), false);
    assert.equal(coversCharacter({}, "a"), true);
});

test("D2: style.css nie importuje niczego (brak @import)", () => {
    assert.equal(/@import/i.test(cssWithoutComments), false);
});

for (const fileName of ["style.css", "index.html", "script.js"]) {
    test(`D2: public/${fileName} nie odwoluje sie do serwerow fontow Google`, () => {
        const source = fs.readFileSync(path.join(publicDir, fileName), "utf8");

        assert.equal(/fonts\.googleapis\.com/i.test(source), false, "jest fonts.googleapis.com");
        assert.equal(/fonts\.gstatic\.com/i.test(source), false, "jest fonts.gstatic.com");
    });
}

test("D2: style.css nie wczytuje niczego spod adresu zewnetrznego", () => {
    const urls = [...cssWithoutComments.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)].map(match => match[1]);

    assert.notEqual(urls.length, 0);

    for (const url of urls) {
        assert.equal(/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url), false, `adres zewnetrzny: ${url}`);
    }
});

test("D2: sa reguly @font-face dla Space Grotesk i tylko dla niego", () => {
    assert.notEqual(spaceGroteskFaces.length, 0);
    assert.equal(spaceGroteskFaces.length, fontFaces.length);
});

test("D2: body dalej uzywa fontu Space Grotesk", () => {
    const body = cssWithoutComments.match(/(?:^|\})\s*body\s*\{([^}]*)\}/);

    assert.notEqual(body, null);
    assert.match(body[1], /font-family:\s*'Space Grotesk',\s*Arial,\s*sans-serif/);
});

test("D2: kazda regula @font-face ma font-display: swap i styl normal", () => {
    for (const face of spaceGroteskFaces) {
        assert.equal(face["font-display"], "swap");
        assert.equal(face["font-style"] || "normal", "normal");
    }
});

test("D2: kazda regula @font-face wskazuje lokalny, istniejacy plik woff2 w public/fonts", () => {
    for (const face of spaceGroteskFaces) {
        const sources = readSources(face);

        assert.equal(sources.length, 1, `src: ${face.src}`);
        assert.equal(sources[0].format, "woff2");
        assert.match(sources[0].url, /^fonts\/[a-z0-9-]+\.woff2$/);

        const filePath = fileForUrl(sources[0].url);

        assert.equal(fs.existsSync(filePath), true, `brak pliku ${filePath}`);

        const content = fs.readFileSync(filePath);

        // sygnatura formatu woff2 i rozsadny rozmiar (nie pusty plik ani strona bledu)
        assert.equal(content.subarray(0, 4).toString("latin1"), "wOF2");
        assert.equal(content.length > 5000, true, `plik ma tylko ${content.length} bajtow`);
        // dlugosc zapisana w naglowku woff2 (bajty 8-11) zgadza sie z rozmiarem pliku, czyli plik nie jest uciety
        assert.equal(content.readUInt32BE(8), content.length);
    }
});

test("D2: w public/fonts nie ma plikow fontu, do ktorych nie prowadzi zadna regula", () => {
    const used = spaceGroteskFaces.flatMap(readSources).map(source => path.basename(source.url)).sort();
    const present = fs.readdirSync(fontsDir).filter(name => name.endsWith(".woff2")).sort();

    assert.deepEqual([...new Set(used)], present);
});

const polishCharacters = [..."ąćęłńóśźżĄĆĘŁŃÓŚŹŻ"];
const basicCharacters = [..."AZaz09 .,:;!?#[]%-"];

for (const weight of [400, 600, 700]) {
    test(`D2: waga ${weight} ma font dla liter podstawowych i dla polskich znakow`, () => {
        const faces = spaceGroteskFaces.filter(face => coversWeight(face, weight));

        for (const character of [...basicCharacters, ...polishCharacters]) {
            assert.equal(
                faces.some(face => coversCharacter(face, character)),
                true,
                `brak reguly dla znaku "${character}" w wadze ${weight}`
            );
        }
    });
}

test("D2: sa osobne zestawy latin i latin-ext (znak podstawowy i polski z roznych plikow albo jeden plik na wszystko)", () => {
    const fileFor = character => spaceGroteskFaces
        .filter(face => coversWeight(face, 400) && coversCharacter(face, character))
        .map(face => readSources(face)[0].url);

    assert.equal(fileFor("a").length, 1, "litera a pasuje do wiecej niz jednej reguly");
    assert.equal(fileFor("ł").length, 1, "litera ł pasuje do wiecej niz jednej reguly");
});

test("D2: obok fontu lezy licencja OFL tego fontu", () => {
    const licensePath = path.join(fontsDir, "OFL.txt");

    assert.equal(fs.existsSync(licensePath), true);

    const license = fs.readFileSync(licensePath, "utf8");

    assert.match(license, /Space Grotesk/);
    assert.match(license, /SIL Open Font License, Version 1\.1/);
    assert.match(license, /PERMISSION & CONDITIONS/);
    assert.match(license, /THE FONT SOFTWARE IS PROVIDED "AS IS"/);
});

test("D2: serwer wydaje pliki fontu i licencje", async () => {
    const { app } = require(path.join(__dirname, "..", "app.js"));
    const server = await new Promise((resolve, reject) => {
        const started = app.listen(0, "127.0.0.1", () => resolve(started));
        started.on("error", reject);
    });

    try {
        const baseUrl = `http://127.0.0.1:${server.address().port}`;

        for (const source of spaceGroteskFaces.flatMap(readSources)) {
            const response = await fetch(`${baseUrl}/${source.url}`);
            const body = Buffer.from(await response.arrayBuffer());

            assert.equal(response.status, 200, source.url);
            assert.match(response.headers.get("content-type"), /^font\/woff2/);
            assert.deepEqual(body, fs.readFileSync(fileForUrl(source.url)));
        }

        const license = await fetch(`${baseUrl}/fonts/OFL.txt`);

        assert.equal(license.status, 200);
    } finally {
        await new Promise((resolve) => {
            server.close(() => resolve());
            server.closeAllConnections();
        });
    }
});
