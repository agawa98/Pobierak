// Testy zadania G5: testy na trzech systemach.
// 1. Plik .github/workflows/testy.yml czytany jako tekst (bez biblioteki YAML, zeby nie dokladac zaleznosci):
//    uruchamianie przy push i pull_request, macierz trzech systemow, Node 20, instalacja ffmpeg osobno
//    dla kazdego systemu, npm ci, npm test - w tej kolejnosci.
// 2. Skrypt "test" w package.json to samo "node --test" (bez skladni jednej powloki).
// 3. app.js da sie wczytac w kilku procesach naraz, gdy nie ma jeszcze folderu downloads
//    (tak startuje "node --test" na swiezej kopii repozytorium, np. na GitHubie) i gdy folder juz jest.
// Nic nie pobieraja z internetu. Pliki robocze leza w os.tmpdir().

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const projectDir = path.join(__dirname, "..");
const workflowPath = path.join(projectDir, ".github", "workflows", "testy.yml");
const appPath = path.join(projectDir, "app.js");

// linie pliku bez komentarzy i pustych, z policzonym wcieciem
function readWorkflowLines() {
    return fs.readFileSync(workflowPath, "utf8")
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
        .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
}

// linie lezace pod podanym kluczem (glebsze wciecie), az do pierwszej linii o wcieciu takim samym albo mniejszym
function blockUnder(lines, keyText, keyIndent) {
    const start = lines.findIndex((line) => line.text === keyText && line.indent === keyIndent);

    assert.notEqual(start, -1, `brak klucza "${keyText}" z wcieciem ${keyIndent}`);

    const block = [];

    for (let i = start + 1; i < lines.length && lines[i].indent > keyIndent; i++) {
        block.push(lines[i]);
    }

    return block;
}

// kroki zadania: kazdy zaczyna sie od "- " z wcieciem 6, pola kroku to pary klucz: wartosc
function readSteps(lines) {
    const steps = [];

    for (const line of blockUnder(lines, "steps:", 4)) {
        let text = line.text;

        if (line.indent === 6 && text.startsWith("- ")) {
            steps.push({ lines: [] });
            text = text.slice(2);
        }

        assert.ok(steps.length > 0, "pierwsza linia pod steps: musi zaczynac krok");

        const step = steps[steps.length - 1];
        const match = /^([\w-]+):\s*(.*)$/.exec(text);

        step.lines.push(text);

        if (match && step[match[1]] === undefined) {
            step[match[1]] = match[2];
        }
    }

    // polecenia kroku: wartosc "run" w jednej linii albo linie pod "run: |"
    for (const step of steps) {
        const runIndex = step.lines.findIndex((text) => text.startsWith("run:"));

        step.commands = [];

        if (runIndex !== -1) {
            step.commands = step.run === "|" ? step.lines.slice(runIndex + 1) : [step.run];
        }
    }

    return steps;
}

function findStepIndex(steps, predicate, description) {
    const indexes = steps.map((step, index) => (predicate(step) ? index : -1)).filter((index) => index !== -1);

    assert.equal(indexes.length, 1, `krok "${description}" ma byc dokladnie jeden, jest ${indexes.length}`);

    return indexes[0];
}

const hasCommand = (pattern) => (step) => step.commands.some((command) => pattern.test(command));

test("G5: plik workflow istnieje, nie ma tabulatorow i ma nazwe", () => {
    const source = fs.readFileSync(workflowPath, "utf8");

    assert.ok(!source.includes("\t"), "YAML nie dopuszcza tabulatorow we wcieciach");
    assert.ok(readWorkflowLines().some((line) => line.indent === 0 && /^name:\s*\S+/.test(line.text)));
});

test("G5: workflow uruchamia sie przy push i pull_request, bez ograniczenia do galezi", () => {
    const block = blockUnder(readWorkflowLines(), "on:", 0);

    assert.deepEqual(block.map((line) => line.text).sort(), ["pull_request:", "push:"]);
    assert.ok(block.every((line) => line.indent === 2));
});

test("G5: jedno zadanie z macierza windows-latest, macos-latest, ubuntu-latest", () => {
    const lines = readWorkflowLines();
    const jobs = blockUnder(lines, "jobs:", 0).filter((line) => line.indent === 2);

    assert.equal(jobs.length, 1, "ma byc jedno zadanie");

    const job = blockUnder(lines, jobs[0].text, 2);

    assert.ok(job.some((line) => line.indent === 4 && line.text === "runs-on: ${{ matrix.os }}"), "runs-on bierze system z macierzy");

    const matrix = blockUnder(lines, "matrix:", 6);

    assert.equal(matrix.length, 1, "macierz ma tylko liste systemow");

    const match = /^os:\s*\[(.*)\]$/.exec(matrix[0].text);

    assert.ok(match, `nieoczekiwany zapis macierzy: ${matrix[0].text}`);
    assert.deepEqual(match[1].split(",").map((name) => name.trim()).sort(), ["macos-latest", "ubuntu-latest", "windows-latest"]);
});

test("G5: blad na jednym systemie nie przerywa testow na pozostalych (fail-fast: false)", () => {
    const strategy = blockUnder(readWorkflowLines(), "strategy:", 4);

    assert.ok(strategy.some((line) => line.indent === 6 && line.text === "fail-fast: false"));
});

test("G5: kroki - checkout, Node 20, ffmpeg, npm ci, npm test w tej kolejnosci", () => {
    const steps = readSteps(readWorkflowLines());

    const checkout = findStepIndex(steps, (step) => /^actions\/checkout@v\d+$/.test(step.uses || ""), "checkout");
    const node = findStepIndex(steps, (step) => /^actions\/setup-node@v\d+$/.test(step.uses || ""), "setup-node");
    const ffmpegCheck = findStepIndex(steps, hasCommand(/^ffmpeg -version$/), "sprawdzenie ffmpeg");
    const install = findStepIndex(steps, hasCommand(/^npm ci$/), "npm ci");
    const tests = findStepIndex(steps, hasCommand(/^npm test$/), "npm test");
    const ffmpegInstalls = steps.map((step, index) => (hasCommand(/install.*\bffmpeg\b/)(step) ? index : -1)).filter((index) => index !== -1);

    assert.ok(steps[node].lines.includes("node-version: 20"), "Node w wersji 20");
    assert.equal(ffmpegInstalls.length, 3, "trzy kroki instalacji ffmpeg, po jednym na system");

    assert.ok(checkout < node, "checkout przed Node");
    assert.ok(node < Math.min(...ffmpegInstalls), "Node przed instalacja ffmpeg");
    assert.ok(Math.max(...ffmpegInstalls) < ffmpegCheck, "sprawdzenie ffmpeg po wszystkich instalacjach");
    assert.ok(ffmpegCheck < install, "sprawdzenie ffmpeg przed npm ci");
    assert.ok(install < tests, "npm ci przed npm test");
    assert.equal(tests, steps.length - 1, "npm test jest ostatnim krokiem");

    // kroki z poleceniami testow nie sa warunkowe - ida na kazdym systemie
    for (const index of [checkout, node, ffmpegCheck, install, tests]) {
        assert.equal(steps[index].if, undefined, `krok ${index + 1} nie moze miec warunku "if"`);
    }
});

test("G5: instalacja ffmpeg - wlasciwy menedzer pakietow dla kazdego systemu", () => {
    const steps = readSteps(readWorkflowLines());
    const expected = [
        ["Windows", /^choco install ffmpeg\b/],
        ["macOS", /^brew install ffmpeg$/],
        ["Linux", /^sudo apt-get update && sudo apt-get install -y ffmpeg$/]
    ];

    for (const [system, pattern] of expected) {
        const index = findStepIndex(steps, (step) => step.if === `runner.os == '${system}'`, `ffmpeg dla ${system}`);

        assert.equal(steps[index].commands.length, 1);
        assert.match(steps[index].commands[0], pattern, `polecenie dla ${system}`);
    }

    // choco bez -y czekalby na odpowiedz
    const windows = steps.find((step) => step.if === "runner.os == 'Windows'");

    assert.match(windows.commands[0], /(^|\s)-y(\s|$)/);
});

test("G5: krok sprawdzenia zatrzymuje przebieg, gdy brakuje ffmpeg albo ffprobe", () => {
    const steps = readSteps(readWorkflowLines());
    const step = steps[findStepIndex(steps, hasCommand(/^ffmpeg -version$/), "sprawdzenie ffmpeg")];

    // osobne linie w bash (GitHub uruchamia go z -e): blad pierwszego polecenia konczy krok
    assert.equal(step.shell, "bash");
    assert.deepEqual(step.commands, ["ffmpeg -version", "ffprobe -version"]);
});

test("G5: workflow nie instaluje yt-dlp i nie wypycha niczego", () => {
    const steps = readSteps(readWorkflowLines());
    const commands = steps.flatMap((step) => step.commands).join("\n");

    assert.doesNotMatch(commands, /yt-dlp/);
    assert.doesNotMatch(commands, /git push|npm publish/);
});

test("G5: skrypt test w package.json to node --test, bez skladni jednej powloki", () => {
    const scripts = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8")).scripts;

    assert.equal(scripts.test, "node --test");
});

test("G5: zaden plik testow nie lezy w folderze downloads ani nie ma na sztywno folderu tymczasowego jednego systemu", () => {
    const testFiles = fs.readdirSync(__dirname).filter((name) => name.endsWith(".test.js"));

    assert.ok(testFiles.length > 20);

    for (const name of testFiles) {
        const source = fs.readFileSync(path.join(__dirname, name), "utf8");

        // folder tymczasowy tylko przez os.tmpdir()
        assert.doesNotMatch(source, /AppData\\+Local\\+Temp|["'`]\/tmp\/|["'`]\/var\/folders/, name);
        // kto tworzy folder tymczasowy, robi to w os.tmpdir()
        for (const match of source.matchAll(/mkdtempSync\(([^\n]*)/g)) {
            assert.match(match[1], /^path\.join\(os\.tmpdir\(\)/, `${name}: mkdtempSync poza os.tmpdir()`);
        }
    }
});

// ---------- app.js wczytywany w kilku procesach naraz ----------

// kopia app.js w nowym folderze tymczasowym (bez folderu downloads), moduly brane z projektu przez NODE_PATH
function makeAppCopy(t) {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-g5-"));

    t.after(() => fs.rmSync(workDir, { recursive: true, force: true }));
    fs.copyFileSync(appPath, path.join(workDir, "app.js"));
    fs.mkdirSync(path.join(workDir, "public"));

    return workDir;
}

function requireAppInChild(workDir) {
    return new Promise((resolve) => {
        const env = { ...process.env, NODE_PATH: path.join(projectDir, "node_modules") };
        const script = "require(process.argv[1]); console.log('wczytany');";
        const child = childProcess.spawn(process.execPath, ["-e", script, path.join(workDir, "app.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
        let output = "";

        child.stdout.on("data", (chunk) => { output += chunk; });
        child.stderr.on("data", (chunk) => { output += chunk; });
        child.on("close", (code) => resolve({ code, output }));
    });
}

test("G5: app.js wczytany w 12 procesach naraz bez folderu downloads - zaden nie konczy sie bledem", async (t) => {
    // kilka podejsc, bo wyscig nie trafia sie za kazdym razem
    for (let attempt = 0; attempt < 3; attempt++) {
        const workDir = makeAppCopy(t);
        const results = await Promise.all(Array.from({ length: 12 }, () => requireAppInChild(workDir)));

        for (const result of results) {
            assert.equal(result.code, 0, result.output);
            assert.match(result.output, /wczytany/);
            assert.doesNotMatch(result.output, /EEXIST/);
        }

        assert.ok(fs.statSync(path.join(workDir, "downloads")).isDirectory());
    }
});

test("G5: app.js wczytany, gdy folder downloads juz jest - folder i jego pliki zostaja", async (t) => {
    const workDir = makeAppCopy(t);
    const downloads = path.join(workDir, "downloads");

    fs.mkdirSync(downloads);
    fs.writeFileSync(path.join(downloads, "plik.txt"), "x");

    const result = await requireAppInChild(workDir);

    assert.equal(result.code, 0, result.output);
    assert.deepEqual(fs.readdirSync(downloads), ["plik.txt"]);
});

test("G5: app.js tworzy folder downloads jednym wywolaniem, bez wczesniejszego existsSync", () => {
    const source = fs.readFileSync(appPath, "utf8");

    assert.match(source, /fs\.mkdirSync\(downloadsDir, \{ recursive: true \}\);/);
    assert.doesNotMatch(source, /existsSync\(downloadsDir\)/);
});
