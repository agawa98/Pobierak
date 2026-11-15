// Testy zadania D1: uruchamianie dwuklikiem (WINDOWS-start.bat, MACOS-start.command, LINUX-start.sh, .gitattributes).
//
// Trzy rodzaje sprawdzen:
// 1. Tresc plikow: konce linii, pierwsza linia, przejscie do wlasnego folderu, identyfikatory winget,
//    jedyna roznica miedzy MACOS-start.command i LINUX-start.sh, .gitattributes, tryb 100755 w repozytorium.
// 2. MACOS-start.command i LINUX-start.sh uruchomione naprawde przez sh na kopii w folderze tymczasowym.
//    Wszystkie programy (node, npm, yt-dlp, ffmpeg, deno, brew, uname, sleep, open, xdg-open) sa atrapami,
//    ktore zapisuja swoje wywolania do pliku. PATH zawiera tylko folder atrap i folder z dirname/chmod,
//    wiec test niczego nie instaluje, nie startuje serwera i nie otwiera przegladarki.
//    System (macOS/Linux) wybiera atrapa uname, wiec obie galezie da sie sprawdzic na kazdym systemie.
//    Foldery Homebrew (/opt/homebrew/bin, /usr/local/bin) sa w kopii skryptu podmienione na foldery
//    w katalogu tymczasowym, zeby prawdziwe programy z tych folderow nie wygraly z atrapami.
//    Na Windowsie sh jest brane z Git for Windows; gdy go nie ma, te testy sa pomijane.
// 3. WINDOWS-start.bat uruchomiony naprawde przez cmd (tylko na Windowsie) na kopii w folderze tymczasowym,
//    z atrapami node.cmd, npm.cmd, winget.cmd itd. Atrapa ping.cmd konczy sie bledem, wiec polecenie
//    "ping ... && start http://..." nie otwiera przegladarki.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const projectDir = path.join(__dirname, "..");
const isWindows = process.platform === "win32";

function readScript(name) {
    return fs.readFileSync(path.join(projectDir, name), "utf8");
}

// ---------- szukanie programow potrzebnych samym testom ----------

function findInPath(fileNames) {
    const folders = (process.env.PATH || process.env.Path || "").split(path.delimiter).filter(Boolean);

    for (const folder of folders) {
        for (const fileName of fileNames) {
            const candidate = path.join(folder, fileName);

            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

// zwraca { sh, toolsDir } albo null, gdy nie ma czym uruchomic skryptu sh
function findShell() {
    if (!isWindows) {
        const sh = fs.existsSync("/bin/sh") ? "/bin/sh" : findInPath(["sh"]);

        return sh ? { sh, toolsDir: null } : null;
    }

    // Windows: sh z Git for Windows (folder usr\bin ma tez dirname i chmod)
    const candidates = [];
    const shInPath = findInPath(["sh.exe"]);
    const git = findInPath(["git.exe"]);

    if (shInPath) {
        candidates.push(path.dirname(shInPath));
        candidates.push(path.join(path.dirname(shInPath), "..", "usr", "bin"));
    }

    if (git) {
        candidates.push(path.join(path.dirname(git), "..", "usr", "bin"));
    }

    for (const folder of candidates) {
        if (fs.existsSync(path.join(folder, "sh.exe")) && fs.existsSync(path.join(folder, "dirname.exe"))) {
            return { sh: path.join(folder, "sh.exe"), toolsDir: folder };
        }
    }

    return null;
}

const shell = findShell();
const skipSh = shell ? false : "brak sh (na Windowsie potrzebny Git for Windows)";
const skipBat = isWindows ? false : "WINDOWS-start.bat dziala tylko na Windowsie";

function slash(text) {
    return text.replace(/\\/g, "/");
}

// sciezka w zapisie zrozumialym dla sh (na Windowsie /c/Users/..., bo dwukropek dzieli PATH), odstepy poprzedzone ukosnikiem
function shWord(text) {
    let result = slash(text);

    if (isWindows) {
        result = result.replace(/^([A-Za-z]):/, (match, drive) => `/${drive.toLowerCase()}`);
    }

    return result.replace(/ /g, "\\ ");
}

function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readLog(logPath) {
    if (!fs.existsSync(logPath)) {
        return [];
    }

    return fs.readFileSync(logPath, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

// czeka, az w logu atrap pojawi sie linia zaczynajaca sie od podanego tekstu
function waitForLog(logPath, prefix, timeoutMs = 10000) {
    const end = Date.now() + timeoutMs;

    while (Date.now() < end) {
        if (readLog(logPath).some((line) => line.startsWith(prefix))) {
            return true;
        }

        sleepMs(50);
    }

    return false;
}

function removeDir(dir) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

// ---------- 1. tresc plikow ----------

test("D1: pliki startowe - tresc", async (t) => {
    await t.test("wszystkie cztery pliki istnieja", () => {
        for (const name of ["WINDOWS-start.bat", "MACOS-start.command", "LINUX-start.sh", ".gitattributes"]) {
            assert.ok(fs.existsSync(path.join(projectDir, name)), `brak pliku ${name}`);
        }
    });

    await t.test(".gitattributes wymusza LF dla sh i command oraz CRLF dla bat", () => {
        const lines = readScript(".gitattributes").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

        assert.deepEqual(lines, ["*.sh text eol=lf", "*.command text eol=lf", "*.bat text eol=crlf"]);
    });

    for (const name of ["MACOS-start.command", "LINUX-start.sh"]) {
        await t.test(`${name}: bez znaku \\r, zaczyna sie od #!/bin/sh`, () => {
            const source = readScript(name);

            assert.equal(source.includes("\r"), false, "plik zawiera znak \\r");
            assert.ok(source.startsWith("#!/bin/sh\n"), "pierwsza linia to nie #!/bin/sh");
            assert.ok(source.endsWith("\n"), "plik nie konczy sie znakiem nowej linii");
        });

        await t.test(`${name}: pierwsze polecenie to przejscie do wlasnego folderu`, () => {
            const commands = readScript(name).split("\n").map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#"));

            assert.ok(commands[0].startsWith('cd "$(dirname "$0")"'), `pierwsze polecenie: ${commands[0]}`);
        });

        await t.test(`${name}: niczego nie aktualizuje i sam nie instaluje Homebrew`, () => {
            const commands = readScript(name).split("\n").map((line) => line.trim())
                .filter((line) => line && !line.startsWith("#") && !line.startsWith("echo ") && !line.startsWith("printf "));
            const code = commands.join("\n");

            assert.doesNotMatch(code, /\b(upgrade|update)\b/);
            assert.doesNotMatch(code, /\b(curl|sudo|apt|dnf|pacman|pipx)\b/);
            // jedyne wywolanie brew poza sprawdzeniem obecnosci to instalacja brakujacych
            assert.deepEqual(commands.filter((line) => /\bbrew\b/.test(line)), ["if ! jest_program brew; then", "brew install $BRAK"]);
        });

        await t.test(`${name}: na macOS doklada do PATH foldery Homebrew, gdy istnieja`, () => {
            const source = readScript(name);
            const block = source.slice(source.indexOf('if [ "$SYSTEM" = "Darwin" ]; then'), source.indexOf("jest_program() {"));

            assert.match(block, /for FOLDER in \/opt\/homebrew\/bin \/usr\/local\/bin; do/);
            assert.match(block, /if \[ -d "\$FOLDER" \]; then/);
            assert.match(block, /PATH="\$FOLDER:\$PATH"/);
            assert.match(block, /export PATH/);
        });
    }

    await t.test("MACOS-start.command i LINUX-start.sh roznia sie tylko poleceniem otwierajacym przegladarke", () => {
        const commandLines = readScript("MACOS-start.command").split("\n");
        const shLines = readScript("LINUX-start.sh").split("\n");

        assert.equal(commandLines.length, shLines.length);

        const different = [];

        commandLines.forEach((line, index) => {
            if (line !== shLines[index]) {
                different.push([line, shLines[index]]);
            }
        });

        assert.deepEqual(different, [[
            '(sleep 2; open "$ADRES") >/dev/null 2>&1 &',
            '(sleep 2; xdg-open "$ADRES") >/dev/null 2>&1 &'
        ]]);
    });

    await t.test("WINDOWS-start.bat: konce linii CRLF, same znaki ASCII", () => {
        const source = readScript("WINDOWS-start.bat");

        assert.equal(/(^|[^\r])\n/.test(source), false, "jest linia zakonczona samym \\n");
        assert.equal(/\r(?!\n)/.test(source), false, "jest samotny znak \\r");
        assert.ok(source.split("\r\n").length > 20);
        // polskie litery w pliku .bat psulyby sie w oknie cmd (strona kodowa)
        assert.equal(/[^\x09\x0a\x0d\x20-\x7e]/.test(source), false, "plik zawiera znaki spoza ASCII");
    });

    await t.test("WINDOWS-start.bat: pierwsze polecenie robocze to cd /d \"%~dp0\"", () => {
        const commands = readScript("WINDOWS-start.bat").split("\r\n").map((line) => line.trim())
            .filter((line) => line && !/^rem\b/i.test(line) && !/^@echo off$/i.test(line) && !/^setlocal\b/i.test(line));

        assert.equal(commands[0], 'cd /d "%~dp0"');
    });

    await t.test("WINDOWS-start.bat: identyfikatory pakietow winget i brak aktualizacji", () => {
        const lines = readScript("WINDOWS-start.bat").split("\r\n").map((line) => line.trim());
        const wingetCalls = lines.filter((line) => /\bwinget (install|upgrade|update|import)\b/.test(line));

        assert.deepEqual(wingetCalls, [
            'if /i "%~1"=="node" call winget install --id OpenJS.NodeJS.LTS -e',
            'if /i "%~1"=="yt-dlp" call winget install --id yt-dlp.yt-dlp -e',
            'if /i "%~1"=="ffmpeg" call winget install --id yt-dlp.FFmpeg -e',
            'if /i "%~1"=="deno" call winget install --id DenoLand.Deno -e'
        ]);
    });

    await t.test("WINDOWS-start.bat: czeka na klawisz (pause) przed kazdym zakonczeniem z komunikatem", () => {
        const lines = readScript("WINDOWS-start.bat").split("\r\n").map((line) => line.trim());

        // linie od podanej (wlacznie) do najblizszego "exit /b"
        function blockFrom(startLine) {
            const start = lines.indexOf(startLine);

            assert.ok(start >= 0, `brak linii: ${startLine}`);

            const end = lines.findIndex((line, index) => index > start && /^exit \/b \d$/.test(line));

            assert.ok(end > start, `brak exit /b po linii: ${startLine}`);

            return lines.slice(start, end + 1);
        }

        // po instalacji: komunikat o ponownym uruchomieniu, pause, exit /b 0
        const afterInstall = blockFrom("for %%P in (%BRAK%) do call :instaluj %%P");

        assert.ok(afterInstall.some((line) => /uruchom WINDOWS-start.bat jeszcze raz/.test(line)));
        assert.deepEqual(afterInstall.slice(-2), ["pause", "exit /b 0"]);

        // po N: pause, exit /b 1
        const refusal = blockFrom(":odmowa");

        assert.ok(refusal.some((line) => /README/.test(line)));
        assert.deepEqual(refusal.slice(-2), ["pause", "exit /b 1"]);

        // brak winget wpada w ten sam koniec co odmowa (miedzy etykietami nie ma exit ani goto)
        const noWinget = lines.slice(lines.indexOf(":brak_winget"), lines.indexOf(":odmowa"));

        assert.ok(lines.indexOf(":brak_winget") >= 0 && noWinget.length >= 2);
        assert.equal(noWinget.some((line) => /^(exit|goto)\b/i.test(line)), false);

        // nieudany npm install: pause, exit /b 1
        assert.deepEqual(blockFrom("echo npm install sie nie powiodl.").slice(-2), ["pause", "exit /b 1"]);

        // blad programu (np. zajety port): okno nie znika od razu
        assert.deepEqual(lines.filter(Boolean).slice(-2), ["call node app.js", "if errorlevel 1 pause"]);
    });

    await t.test("WINDOWS-start.bat: przegladarka przez start, potem node app.js", () => {
        const source = readScript("WINDOWS-start.bat");
        const openIndex = source.indexOf("&& start http://localhost:%PORT%");
        const nodeIndex = source.indexOf("call node app.js");

        assert.ok(source.includes('if not defined PORT set "PORT=3000"'));
        assert.ok(openIndex > 0, "brak polecenia start z adresem strony");
        assert.ok(nodeIndex > openIndex, "node app.js powinien byc po poleceniu otwierajacym przegladarke");
    });

    await t.test("MACOS-start.command i LINUX-start.sh maja w repozytorium prawo do uruchamiania (100755)", (t) => {
        const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: projectDir, encoding: "utf8" });

        if (top.error || top.status !== 0 || path.resolve(top.stdout.trim()) !== path.resolve(projectDir)) {
            t.skip("folder programu nie jest repozytorium git (np. kopia bez .git)");
            return;
        }

        const listed = spawnSync("git", ["ls-files", "-s", "MACOS-start.command", "LINUX-start.sh"], { cwd: projectDir, encoding: "utf8" });
        const lines = listed.stdout.split(/\r?\n/).filter(Boolean);

        assert.equal(lines.length, 2, `git ls-files zwrocil: ${listed.stdout}`);

        for (const line of lines) {
            assert.ok(line.startsWith("100755 "), `zly tryb: ${line}`);
        }
    });

    await t.test("MACOS-start.command i LINUX-start.sh maja poprawna skladnie (sh -n)", { skip: skipSh }, () => {
        for (const name of ["MACOS-start.command", "LINUX-start.sh"]) {
            const result = spawnSync(shell.sh, ["-n", slash(path.join(projectDir, name))], { encoding: "utf8" });

            assert.equal(result.status, 0, `${name}: ${result.stderr}`);
        }
    });
});

// ---------- 2. MACOS-start.command i LINUX-start.sh uruchomione przez sh ----------

const shFakeHeader = [
    "#!/bin/sh",
    "if [ -f znacznik.txt ]; then GDZIE=tu; else GDZIE=gdzie-indziej; fi"
];

function writeShFake(fakesDir, name, body = "") {
    const lines = [...shFakeHeader, `echo "${name}|$GDZIE|$*" >> "$POBIERAK_LOG"`, body, ""];

    fs.writeFileSync(path.join(fakesDir, name), lines.join("\n"), { mode: 0o755 });
}

// atrapa brew: "instaluje" program, tworzac jego atrape w folderze atrap
const brewWorks = [
    'if [ "$1" = "install" ]; then',
    "    shift",
    '    for P in "$@"; do',
    "        printf '#!/bin/sh\\nexit 0\\n' > \"$POBIERAK_FAKES/$P\"",
    '        chmod +x "$POBIERAK_FAKES/$P"',
    "    done",
    "fi"
].join("\n");

function prepareSh(scriptName, options = {}) {
    const {
        programs = ["node", "npm", "yt-dlp", "ffmpeg", "deno"],
        system = "Linux",
        brew = null,              // null = brak brew, "dziala", "zepsuty"
        nodeModules = true,
        binFiles = [],
        npmFails = false,
        homebrewDir = "brak",     // "brak" = folderu nie ma, "pusty", "z-brew" = brew lezy tylko tam
        homebrewPrograms = []     // atrapy programow lezace tylko w podstawionym folderze Homebrew
    } = options;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-start-"));
    const programDir = path.join(root, "program z odstepem");
    const fakesDir = path.join(root, "atrapy");
    const otherDir = path.join(root, "inny");
    const logPath = path.join(root, "wywolania.log");
    const brewDir = path.join(root, "homebrew-bin");

    for (const dir of [programDir, fakesDir, otherDir]) {
        fs.mkdirSync(dir);
    }

    // Skrypt na macOS doklada do PATH /opt/homebrew/bin i /usr/local/bin. Na komputerze z Homebrew
    // prawdziwe programy wygralyby z atrapami (i test moglby uruchomic prawdziwe brew install),
    // wiec w kopii skryptu te dwa foldery sa podmienione na foldery w katalogu tymczasowym.
    // Sam napis w oryginale sprawdza test tresci wyzej.
    const original = readScript(scriptName);
    const sandboxed = original.replace(
        "for FOLDER in /opt/homebrew/bin /usr/local/bin; do",
        () => `for FOLDER in ${shWord(brewDir)} ${shWord(path.join(root, "usr-local-bin-ktorego-nie-ma"))}; do`
    );

    assert.notEqual(sandboxed, original, "w skrypcie nie ma linii z folderami Homebrew");
    assert.equal(sandboxed.includes("/opt/homebrew"), false);
    assert.equal(sandboxed.includes("/usr/local"), false);
    fs.writeFileSync(path.join(programDir, scriptName), sandboxed);

    if (homebrewDir !== "brak") {
        fs.mkdirSync(brewDir);
    }

    if (homebrewDir === "z-brew") {
        writeShFake(brewDir, "brew", brewWorks);
    }

    for (const name of homebrewPrograms) {
        writeShFake(brewDir, name);
    }
    fs.writeFileSync(path.join(programDir, "znacznik.txt"), "folder programu\n");
    fs.writeFileSync(path.join(programDir, "app.js"), "// atrapa\n");

    if (nodeModules) {
        fs.mkdirSync(path.join(programDir, "node_modules"));
    }

    if (binFiles.length > 0) {
        fs.mkdirSync(path.join(programDir, "bin"));

        for (const name of binFiles) {
            fs.writeFileSync(path.join(programDir, "bin", name), "atrapa\n", { mode: 0o755 });
        }
    }

    for (const name of programs) {
        writeShFake(fakesDir, name, name === "npm" && npmFails ? "exit 1" : "");
    }

    writeShFake(fakesDir, "uname", 'echo "$POBIERAK_UNAME"');
    writeShFake(fakesDir, "sleep");
    writeShFake(fakesDir, "open");
    writeShFake(fakesDir, "xdg-open");

    if (brew === "dziala") {
        writeShFake(fakesDir, "brew", brewWorks);
    } else if (brew === "zepsuty") {
        writeShFake(fakesDir, "brew", "exit 1");
    }

    // prawdziwe narzedzia potrzebne skryptowi i atrapom: dirname i chmod
    let toolsDir = shell.toolsDir;

    if (!toolsDir) {
        toolsDir = path.join(root, "narzedzia");
        fs.mkdirSync(toolsDir);

        for (const tool of ["dirname", "chmod"]) {
            const real = findInPath([tool]) || ["/usr/bin", "/bin"].map((dir) => path.join(dir, tool)).find((p) => fs.existsSync(p));

            assert.ok(real, `brak programu ${tool}`);
            fs.symlinkSync(real, path.join(toolsDir, tool));
        }
    }

    const env = {
        PATH: [fakesDir, toolsDir].join(path.delimiter),
        POBIERAK_LOG: slash(logPath),
        POBIERAK_FAKES: slash(fakesDir),
        POBIERAK_UNAME: system
    };

    if (isWindows) {
        env.SystemRoot = process.env.SystemRoot;
    }

    function run(input = "", extraEnv = {}) {
        const result = spawnSync(shell.sh, [slash(path.join(programDir, scriptName))], {
            cwd: otherDir,
            env: { ...env, ...extraEnv },
            input,
            encoding: "utf8",
            timeout: 60000
        });

        return { status: result.status, output: `${result.stdout}${result.stderr}`, error: result.error };
    }

    return {
        run,
        log: () => readLog(logPath).filter((line) => !line.startsWith("uname|")),
        waitFor: (prefix) => waitForLog(logPath, prefix),
        cleanup: () => removeDir(root)
    };
}

const shScripts = [
    { name: "MACOS-start.command", opener: "open", otherOpener: "xdg-open" },
    { name: "LINUX-start.sh", opener: "xdg-open", otherOpener: "open" }
];

for (const script of shScripts) {
    const { name, opener, otherOpener } = script;

    test(`D1: ${name} uruchomiony przez sh`, { skip: skipSh }, async (t) => {
        for (const system of ["Darwin", "Linux"]) {
            await t.test(`${system}: wszystko jest - bez pytan, bez npm install, start programu i przegladarka`, () => {
                const env = prepareSh(name, { system, brew: "dziala" });

                try {
                    const result = env.run();

                    assert.equal(result.status, 0, result.output);
                    assert.ok(env.waitFor(`${opener}|`), `przegladarka nie zostala otwarta: ${env.log().join(" ; ")}`);

                    const log = env.log();

                    // node app.js w folderze programu, mimo startu z innego katalogu
                    assert.ok(log.includes("node|tu|app.js"), log.join(" ; "));
                    assert.ok(log.includes(`${opener}|tu|http://localhost:3000`), log.join(" ; "));
                    assert.ok(log.includes("sleep|tu|2"), "przegladarka powinna czekac na start serwera");
                    assert.equal(log.some((line) => line.startsWith(`${otherOpener}|`)), false, `uzyto ${otherOpener}`);
                    assert.equal(log.some((line) => line.startsWith("npm|")), false, "npm install mimo node_modules");
                    assert.equal(log.some((line) => line.startsWith("brew|")), false, "brew wywolany, choc niczego nie brakuje");
                    // nic o brakujacych programach
                    assert.equal(result.output.trim(), "");
                } finally {
                    env.cleanup();
                }
            });
        }

        await t.test("brak node_modules - npm install w folderze programu, potem node app.js", () => {
            const env = prepareSh(name, { nodeModules: false });

            try {
                const result = env.run();

                assert.equal(result.status, 0, result.output);
                assert.ok(env.waitFor(`${opener}|`));

                const log = env.log();
                const npmIndex = log.indexOf("npm|tu|install");
                const nodeIndex = log.indexOf("node|tu|app.js");

                assert.ok(npmIndex >= 0, log.join(" ; "));
                assert.ok(nodeIndex > npmIndex, "node app.js powinien ruszyc po npm install");
                assert.equal(log.filter((line) => line.startsWith("npm|")).length, 1);
            } finally {
                env.cleanup();
            }
        });

        await t.test("nieudany npm install - program nie startuje, przegladarka sie nie otwiera", () => {
            const env = prepareSh(name, { nodeModules: false, npmFails: true });

            try {
                const result = env.run();

                assert.notEqual(result.status, 0);
                assert.match(result.output, /npm install sie nie powiodl/);
                sleepMs(300);

                const log = env.log();

                assert.equal(log.some((line) => line.startsWith("node|")), false);
                assert.equal(log.some((line) => /^(open|xdg-open|sleep)\|/.test(line)), false);
            } finally {
                env.cleanup();
            }
        });

        await t.test("PORT ze zmiennej srodowiskowej trafia do adresu strony", () => {
            const env = prepareSh(name);

            try {
                const result = env.run("", { PORT: "4123" });

                assert.equal(result.status, 0, result.output);
                assert.ok(env.waitFor(`${opener}|`));
                assert.ok(env.log().includes(`${opener}|tu|http://localhost:4123`), env.log().join(" ; "));
            } finally {
                env.cleanup();
            }
        });

        await t.test("yt-dlp i ffmpeg w folderze bin obok skryptu licza sie jako obecne", () => {
            const env = prepareSh(name, { programs: ["node", "npm", "deno"], binFiles: ["yt-dlp", "ffmpeg"] });

            try {
                const result = env.run();

                assert.equal(result.status, 0, result.output);
                assert.ok(env.waitFor(`${opener}|`));
                assert.ok(env.log().includes("node|tu|app.js"));
                assert.doesNotMatch(result.output, /Brakuje/);
            } finally {
                env.cleanup();
            }
        });

        await t.test("node i deno w folderze bin NIE licza sie jako obecne", () => {
            const env = prepareSh(name, { programs: ["npm", "yt-dlp", "ffmpeg"], binFiles: ["node", "deno"] });

            try {
                const result = env.run();

                assert.notEqual(result.status, 0);
                assert.match(result.output, /Brakuje programow: node deno\r?\n/);
                assert.equal(env.log().some((line) => line.startsWith("node|")), false);
            } finally {
                env.cleanup();
            }
        });

        await t.test("macOS: brak deno, odpowiedz T - brew install deno, potem start bez ponownego uruchamiania", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], brew: "dziala" });

            try {
                const result = env.run("T\n");

                assert.equal(result.status, 0, result.output);
                assert.match(result.output, /Brakuje programow: deno\r?\n/);
                assert.match(result.output, /Zainstalowac\? \[T\/N\] /);
                assert.ok(env.waitFor(`${opener}|`));

                const log = env.log();

                assert.deepEqual(log.filter((line) => line.startsWith("brew|")), ["brew|tu|install deno"]);
                assert.ok(log.indexOf("node|tu|app.js") > log.indexOf("brew|tu|install deno"), log.join(" ; "));
            } finally {
                env.cleanup();
            }
        });

        await t.test("macOS: brakuje kilku programow, odpowiedz t - jedno brew install tylko z brakujacymi", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["npm", "ffmpeg"], brew: "dziala" });

            try {
                const result = env.run("t\n");

                assert.equal(result.status, 0, result.output);
                assert.match(result.output, /Brakuje programow: node yt-dlp deno\r?\n/);
                assert.ok(env.waitFor(`${opener}|`));
                assert.deepEqual(env.log().filter((line) => line.startsWith("brew|")), ["brew|tu|install node yt-dlp deno"]);
            } finally {
                env.cleanup();
            }
        });

        for (const [answer, label] of [["N\n", "N"], ["\n", "sam Enter"], ["", "brak odpowiedzi (koniec wejscia)"], ["nie wiem\n", "inny tekst"], ["x\n", "x"], ["Y\n", "Y"]]) {
            await t.test(`macOS: brak deno, odpowiedz: ${label} - nic nie instaluje i nie startuje`, () => {
                const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], brew: "dziala" });

                try {
                    const result = env.run(answer);

                    assert.notEqual(result.status, 0);
                    assert.match(result.output, /Zainstalowac\? \[T\/N\] /);
                    assert.match(result.output, /Brakuje: deno/);
                    assert.match(result.output, /README/);
                    sleepMs(200);
                    assert.deepEqual(env.log(), [], "zaden program nie powinien zostac wywolany");
                } finally {
                    env.cleanup();
                }
            });
        }

        await t.test("macOS: brew tylko w folderze Homebrew spoza PATH - skrypt go znajduje i instaluje", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], homebrewDir: "z-brew" });

            try {
                const result = env.run("T\n");

                assert.equal(result.status, 0, result.output);
                assert.match(result.output, /Zainstalowac\? \[T\/N\] /);
                assert.doesNotMatch(result.output, /brew\.sh/);
                assert.ok(env.waitFor(`${opener}|`));

                const log = env.log();

                assert.deepEqual(log.filter((line) => line.startsWith("brew|")), ["brew|tu|install deno"]);
                assert.ok(log.includes("node|tu|app.js"), log.join(" ; "));
            } finally {
                env.cleanup();
            }
        });

        await t.test("macOS: programy tylko w folderze Homebrew spoza PATH licza sie jako obecne", () => {
            const env = prepareSh(name, {
                system: "Darwin",
                programs: ["npm"],
                homebrewDir: "pusty",
                homebrewPrograms: ["node", "yt-dlp", "ffmpeg", "deno"]
            });

            try {
                const result = env.run();

                assert.equal(result.status, 0, result.output);
                assert.doesNotMatch(result.output, /Brakuje/);
                assert.ok(env.waitFor(`${opener}|`));
                assert.ok(env.log().includes("node|tu|app.js"), env.log().join(" ; "));
            } finally {
                env.cleanup();
            }
        });

        await t.test("Linux: folder Homebrew NIE jest dokladany do PATH", () => {
            const env = prepareSh(name, {
                system: "Linux",
                programs: ["npm"],
                homebrewDir: "pusty",
                homebrewPrograms: ["node", "yt-dlp", "ffmpeg", "deno"]
            });

            try {
                const result = env.run();

                assert.notEqual(result.status, 0);
                assert.match(result.output, /Brakuje programow: node yt-dlp ffmpeg deno\r?\n/);
                sleepMs(200);
                assert.deepEqual(env.log(), []);
            } finally {
                env.cleanup();
            }
        });

        await t.test("macOS: folder Homebrew istnieje, ale bez brew - komunikat o braku Homebrew", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], homebrewDir: "pusty" });

            try {
                const result = env.run("T\n");

                assert.notEqual(result.status, 0);
                assert.match(result.output, /https:\/\/brew\.sh/);
                assert.doesNotMatch(result.output, /Zainstalowac\?/);
                sleepMs(200);
                assert.deepEqual(env.log(), []);
            } finally {
                env.cleanup();
            }
        });

        for (const [present, missing] of [["yt-dlp", "ffmpeg"], ["ffmpeg", "yt-dlp"]]) {
            await t.test(`w folderze bin jest tylko ${present} - brakuje ${missing}`, () => {
                const env = prepareSh(name, { programs: ["node", "npm", "deno"], binFiles: [present] });

                try {
                    const result = env.run();

                    assert.notEqual(result.status, 0);
                    assert.match(result.output, new RegExp(`Brakuje programow: ${missing}\\r?\\n`));
                    sleepMs(200);
                    assert.deepEqual(env.log(), []);
                } finally {
                    env.cleanup();
                }
            });
        }

        await t.test("macOS: brew install sie nie udaje - program nie startuje", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], brew: "zepsuty" });

            try {
                const result = env.run("T\n");

                assert.notEqual(result.status, 0);
                assert.match(result.output, /Nadal brakuje: deno/);
                sleepMs(200);
                assert.deepEqual(env.log(), ["brew|tu|install deno"]);
            } finally {
                env.cleanup();
            }
        });

        await t.test("macOS: brak Homebrew - adres brew.sh i komenda, bez pytania i bez instalacji", () => {
            const env = prepareSh(name, { system: "Darwin", programs: ["node", "npm", "yt-dlp", "ffmpeg"], brew: null });

            try {
                const result = env.run("T\n");

                assert.notEqual(result.status, 0);
                assert.match(result.output, /Brakuje programow: deno\r?\n/);
                assert.match(result.output, /https:\/\/brew\.sh/);
                assert.ok(result.output.includes('/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'));
                assert.match(result.output, /uruchom ten skrypt jeszcze raz/);
                assert.doesNotMatch(result.output, /Zainstalowac\?/);
                sleepMs(200);
                assert.deepEqual(env.log(), []);
            } finally {
                env.cleanup();
            }
        });

        await t.test("Linux: brak programow - lista, komendy apt/dnf/pacman, pipx, README; nic nie instaluje", () => {
            // brew jest w PATH i dziala, a mimo to na Linuksie nie moze zostac uzyty
            const env = prepareSh(name, { system: "Linux", programs: ["node", "npm"], brew: "dziala" });

            try {
                const result = env.run("T\n");

                assert.notEqual(result.status, 0);
                assert.match(result.output, /Brakuje programow: yt-dlp ffmpeg deno\r?\n/);
                assert.match(result.output, /apt install/);
                assert.match(result.output, /dnf install/);
                assert.match(result.output, /pacman -S/);
                assert.match(result.output, /pipx/);
                assert.match(result.output, /oficjalnego pliku/);
                assert.match(result.output, /README/);
                assert.doesNotMatch(result.output, /Zainstalowac\?/);
                sleepMs(200);
                assert.deepEqual(env.log(), []);
            } finally {
                env.cleanup();
            }
        });
    });
}

// ---------- 3. WINDOWS-start.bat uruchomiony przez cmd ----------

function writeCmdFake(fakesDir, name, exitCode = 0) {
    const lines = [
        "@echo off",
        "if exist znacznik.txt (set \"GDZIE=tu\") else (set \"GDZIE=gdzie-indziej\")",
        `>>"%POBIERAK_LOG%" echo ${name}^|%GDZIE%^|%*`,
        `exit /b ${exitCode}`,
        ""
    ];

    fs.writeFileSync(path.join(fakesDir, `${name}.cmd`), lines.join("\r\n"));
}

function prepareBat(options = {}) {
    const {
        programs = ["node", "npm", "yt-dlp", "ffmpeg", "deno"],
        winget = true,
        nodeModules = true,
        binFiles = [],
        npmFails = false
    } = options;

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-start-"));
    const programDir = path.join(root, "program z odstepem");
    const fakesDir = path.join(root, "atrapy");
    const otherDir = path.join(root, "inny");
    const logPath = path.join(root, "wywolania.log");

    for (const dir of [programDir, fakesDir, otherDir]) {
        fs.mkdirSync(dir);
    }

    fs.copyFileSync(path.join(projectDir, "WINDOWS-start.bat"), path.join(programDir, "WINDOWS-start.bat"));
    fs.writeFileSync(path.join(programDir, "znacznik.txt"), "folder programu\r\n");
    fs.writeFileSync(path.join(programDir, "app.js"), "// atrapa\r\n");

    if (nodeModules) {
        fs.mkdirSync(path.join(programDir, "node_modules"));
    }

    if (binFiles.length > 0) {
        fs.mkdirSync(path.join(programDir, "bin"));

        for (const name of binFiles) {
            fs.writeFileSync(path.join(programDir, "bin", name), "atrapa\r\n");
        }
    }

    for (const name of programs) {
        writeCmdFake(fakesDir, name, name === "npm" && npmFails ? 1 : 0);
    }

    if (winget) {
        writeCmdFake(fakesDir, "winget");
    }

    // ping konczy sie bledem, wiec "ping ... && start http://..." nie otwiera przegladarki
    writeCmdFake(fakesDir, "ping", 1);

    const systemRoot = process.env.SystemRoot || "C:\\Windows";
    const env = {
        PATH: [fakesDir, path.join(systemRoot, "System32")].join(";"),
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SystemRoot: systemRoot,
        ComSpec: path.join(systemRoot, "System32", "cmd.exe"),
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
        POBIERAK_LOG: logPath
    };

    function run(input = "", extraEnv = {}) {
        const batPath = path.join(programDir, "WINDOWS-start.bat");
        const result = spawnSync(env.ComSpec, ["/d", "/s", "/c", `""${batPath}""`], {
            cwd: otherDir,
            env: { ...env, ...extraEnv },
            input,
            encoding: "utf8",
            timeout: 60000,
            windowsVerbatimArguments: true
        });

        return { status: result.status, output: `${result.stdout}${result.stderr}`, error: result.error };
    }

    return {
        run,
        log: () => readLog(logPath),
        waitFor: (prefix) => waitForLog(logPath, prefix),
        cleanup: () => removeDir(root)
    };
}

test("D1: WINDOWS-start.bat uruchomiony przez cmd", { skip: skipBat }, async (t) => {
    await t.test("wszystko jest - bez pytan, bez npm install, node app.js w folderze programu", () => {
        const env = prepareBat();

        try {
            const result = env.run();

            assert.equal(result.error, undefined);
            assert.ok(env.waitFor("ping|"), `brak opoznionego otwarcia przegladarki: ${env.log().join(" ; ")}`);

            const log = env.log();

            assert.ok(log.includes("node|tu|app.js"), log.join(" ; "));
            assert.ok(log.includes("ping|tu|-n 3 127.0.0.1"), log.join(" ; "));
            assert.equal(log.some((line) => line.startsWith("npm|")), false, "npm install mimo node_modules");
            assert.equal(log.some((line) => line.startsWith("winget|")), false, "winget wywolany, choc niczego nie brakuje");
            assert.equal(result.output.trim(), "");
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak node_modules - npm install w folderze programu, potem node app.js", () => {
        const env = prepareBat({ nodeModules: false });

        try {
            env.run();
            assert.ok(env.waitFor("ping|"));

            const log = env.log();
            const npmIndex = log.indexOf("npm|tu|install");

            assert.ok(npmIndex >= 0, log.join(" ; "));
            assert.ok(log.indexOf("node|tu|app.js") > npmIndex, log.join(" ; "));
        } finally {
            env.cleanup();
        }
    });

    await t.test("nieudany npm install - program nie startuje", () => {
        const env = prepareBat({ nodeModules: false, npmFails: true });

        try {
            const result = env.run();

            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /npm install sie nie powiodl/);
            sleepMs(300);
            assert.deepEqual(env.log(), ["npm|tu|install"]);
        } finally {
            env.cleanup();
        }
    });

    await t.test("yt-dlp.exe i ffmpeg.exe w folderze bin licza sie jako obecne", () => {
        const env = prepareBat({ programs: ["node", "npm", "deno"], binFiles: ["yt-dlp.exe", "ffmpeg.exe"] });

        try {
            const result = env.run();

            assert.ok(env.waitFor("ping|"));
            assert.ok(env.log().includes("node|tu|app.js"));
            assert.doesNotMatch(result.output, /Brakuje/);
        } finally {
            env.cleanup();
        }
    });

    for (const [present, missing] of [["yt-dlp.exe", "ffmpeg"], ["ffmpeg.exe", "yt-dlp"]]) {
        await t.test(`w folderze bin jest tylko ${present} - brakuje ${missing}`, () => {
            const env = prepareBat({ programs: ["node", "npm", "deno"], binFiles: [present] });

            try {
                const result = env.run("N\r\n");

                assert.equal(result.status, 1, result.output);
                assert.match(result.output, new RegExp(`Brakuje programow: ${missing}\\r?\\n`));
                sleepMs(300);
                assert.deepEqual(env.log(), []);
            } finally {
                env.cleanup();
            }
        });
    }

    await t.test("node.exe i deno.exe w folderze bin NIE licza sie jako obecne", () => {
        const env = prepareBat({ programs: ["npm", "yt-dlp", "ffmpeg"], binFiles: ["node.exe", "deno.exe"] });

        try {
            const result = env.run("N\r\n");

            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Brakuje programow: node deno\r?\n/);
            sleepMs(300);
            assert.deepEqual(env.log(), []);
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak deno, odpowiedz N - wypisuje deno, niczego nie instaluje i nie startuje", () => {
        const env = prepareBat({ programs: ["node", "npm", "yt-dlp", "ffmpeg"] });

        try {
            const result = env.run("N\r\n");

            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Brakuje programow: deno\r?\n/);
            assert.match(result.output, /Zainstalowac\? \[T\/N\]/);
            assert.match(result.output, /Nic nie zostalo zainstalowane\. Brakuje: deno/);
            assert.match(result.output, /README/);
            sleepMs(300);
            assert.deepEqual(env.log(), []);
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak odpowiedzi (koniec wejscia) - niczego nie instaluje", () => {
        const env = prepareBat({ programs: ["node", "npm", "yt-dlp", "ffmpeg"] });

        try {
            const result = env.run("");

            assert.equal(result.status, 1, result.output);
            sleepMs(300);
            assert.deepEqual(env.log(), []);
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak yt-dlp i deno, odpowiedz T - winget install tylko dla brakujacych, bez startu programu", () => {
        const env = prepareBat({ programs: ["node", "npm", "ffmpeg"] });

        try {
            const result = env.run("T\r\n");

            assert.equal(result.status, 0, result.output);
            assert.match(result.output, /Brakuje programow: yt-dlp deno\r?\n/);
            assert.match(result.output, /uruchom WINDOWS-start.bat jeszcze raz/);
            sleepMs(300);
            assert.deepEqual(env.log(), [
                "winget|tu|install --id yt-dlp.yt-dlp -e",
                "winget|tu|install --id DenoLand.Deno -e"
            ]);
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak wszystkiego, odpowiedz t - cztery pakiety, kazdy raz", () => {
        const env = prepareBat({ programs: ["npm"] });

        try {
            const result = env.run("t\r\n");

            assert.equal(result.status, 0, result.output);
            assert.match(result.output, /Brakuje programow: node yt-dlp ffmpeg deno\r?\n/);
            sleepMs(300);
            assert.deepEqual(env.log(), [
                "winget|tu|install --id OpenJS.NodeJS.LTS -e",
                "winget|tu|install --id yt-dlp.yt-dlp -e",
                "winget|tu|install --id yt-dlp.FFmpeg -e",
                "winget|tu|install --id DenoLand.Deno -e"
            ]);
        } finally {
            env.cleanup();
        }
    });

    await t.test("brak winget - bez pytania, lista brakow i odeslanie do README", () => {
        const env = prepareBat({ programs: ["node", "npm", "yt-dlp", "ffmpeg"], winget: false });

        try {
            const result = env.run("T\r\n");

            assert.equal(result.status, 1, result.output);
            assert.match(result.output, /Nie znaleziono programu winget/);
            assert.match(result.output, /Brakuje: deno/);
            assert.match(result.output, /README/);
            assert.doesNotMatch(result.output, /Zainstalowac\?/);
            sleepMs(300);
            assert.deepEqual(env.log(), []);
        } finally {
            env.cleanup();
        }
    });
});
