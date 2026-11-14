// Testy zadania B13i + D4: package.json i licencja.
// Czytaja package.json, package-lock.json i LICENSE jako pliki: package.json jest poprawnym JSON-em,
// ma "main": "app.js", niepusty opis, "engines": { "node": ">=18" } i "license": "MIT",
// skrypt "start" uruchamia plik z pola "main", a LICENSE to pelny tekst licencji MIT (rok 2026, agawa98).
// Samo "npm start" (start serwera przez "node app.js") sprawdza testy/start.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.join(__dirname, "..");
const packagePath = path.join(projectDir, "package.json");
const lockPath = path.join(projectDir, "package-lock.json");
const licensePath = path.join(projectDir, "LICENSE");

const packageSource = fs.readFileSync(packagePath, "utf8");

// wzorcowy tekst licencji MIT (bez linii z prawami autorskimi), porownywany po zwinieciu bialych znakow
const mitBody = [
    "Permission is hereby granted, free of charge, to any person obtaining a copy",
    "of this software and associated documentation files (the \"Software\"), to deal",
    "in the Software without restriction, including without limitation the rights",
    "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
    "copies of the Software, and to permit persons to whom the Software is",
    "furnished to do so, subject to the following conditions:",
    "The above copyright notice and this permission notice shall be included in all",
    "copies or substantial portions of the Software.",
    "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
    "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
    "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
    "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
    "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
    "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
    "SOFTWARE."
].join(" ");

function collapseWhitespace(text) {
    return text.replace(/\s+/g, " ").trim();
}

function readPackage() {
    return JSON.parse(packageSource);
}

test("package.json", async (t) => {
    await t.test("jest poprawnym JSON-em z obiektem na wierzchu", () => {
        let parsed;

        assert.doesNotThrow(() => {
            parsed = JSON.parse(packageSource);
        });
        assert.equal(typeof parsed, "object");
        assert.notEqual(parsed, null);
        assert.equal(Array.isArray(parsed), false);
    });

    await t.test("nie zaczyna sie od znacznika BOM", () => {
        assert.notEqual(packageSource.charCodeAt(0), 0xfeff);
    });

    await t.test("\"main\" to app.js i taki plik istnieje", () => {
        const pkg = readPackage();

        assert.equal(pkg.main, "app.js");
        assert.equal(fs.statSync(path.join(projectDir, pkg.main)).isFile(), true);
    });

    await t.test("\"description\" to krotki, niepusty opis w jednej linii", () => {
        const { description } = readPackage();

        assert.equal(typeof description, "string");
        assert.ok(description.trim().length >= 10, "opis jest pusty albo za krotki");
        assert.ok(description.length <= 200, "opis ma byc krotki");
        assert.equal(description, description.trim());
        assert.doesNotMatch(description, /[\r\n]/);
    });

    await t.test("\"engines\" wymaga Node >=18 i niczego wiecej", () => {
        assert.deepEqual(readPackage().engines, { node: ">=18" });
    });

    await t.test("\"license\" to MIT", () => {
        assert.equal(readPackage().license, "MIT");
    });

    await t.test("skrypt \"start\" uruchamia plik z pola \"main\"", () => {
        const pkg = readPackage();

        assert.equal(pkg.scripts.start, `node ${pkg.main}`);
    });

    await t.test("pozostale pola bez zmian (nazwa, wersja, skrypt test, zaleznosci)", () => {
        const pkg = readPackage();

        assert.equal(pkg.name, "pobierak");
        assert.equal(pkg.version, "1.0.0");
        assert.equal(pkg.type, "commonjs");
        assert.equal(pkg.scripts.test, "node --test");
        assert.deepEqual(Object.keys(pkg.dependencies), ["express"]);
        assert.deepEqual(Object.keys(pkg.devDependencies), ["playwright-core"]);
    });
});

test("package-lock.json zgadza sie z package.json", async (t) => {
    const lockRoot = JSON.parse(fs.readFileSync(lockPath, "utf8")).packages[""];

    await t.test("licencja", () => {
        assert.equal(lockRoot.license, readPackage().license);
    });

    await t.test("engines", () => {
        assert.deepEqual(lockRoot.engines, readPackage().engines);
    });

    await t.test("zaleznosci", () => {
        const pkg = readPackage();

        assert.deepEqual(lockRoot.dependencies, pkg.dependencies);
        assert.deepEqual(lockRoot.devDependencies, pkg.devDependencies);
    });
});

test("LICENSE", async (t) => {
    const licenseSource = fs.readFileSync(licensePath, "utf8");
    const lines = licenseSource.split(/\r?\n/);
    const nonEmptyLines = lines.filter(line => line.trim() !== "");

    await t.test("plik lezy obok package.json i nazywa sie dokladnie LICENSE", () => {
        assert.ok(fs.readdirSync(projectDir).includes("LICENSE"));
    });

    await t.test("zaczyna sie od naglowka \"MIT License\"", () => {
        assert.equal(nonEmptyLines[0], "MIT License");
    });

    await t.test("druga linia to prawa autorskie: rok 2026, wlasciciel agawa98", () => {
        assert.equal(nonEmptyLines[1], "Copyright (c) 2026 agawa98");
    });

    await t.test("jest tylko jedna linia z prawami autorskimi", () => {
        assert.equal(lines.filter(line => /^\s*Copyright\b/i.test(line)).length, 1);
    });

    await t.test("reszta to pelny, niezmieniony tekst licencji MIT", () => {
        const body = collapseWhitespace(nonEmptyLines.slice(2).join("\n"));

        assert.equal(body, mitBody);
    });

    await t.test("nie zostaly pola do uzupelnienia ze wzorca", () => {
        assert.doesNotMatch(licenseSource, /<year>|<copyright holders>|\[year\]|\[fullname\]/i);
    });
});
