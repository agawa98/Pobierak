// Testy zadania G2: README.md.
// Sprawdzaja, ze README istnieje, ma wymagane czesci i zgadza sie z kodem (identyfikatory winget ze start.bat,
// komenda Homebrew ze start.command, zmienne srodowiskowe i czas sprzatania z app.js, formaty z app.js),
// ze zrzut ekranu i pliki z odnosnikow sa w repozytorium oraz ze tabela "na czym sprawdzono" nie obiecuje Linuksa.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const projectDir = path.join(__dirname, "..");
const readmePath = path.join(projectDir, "README.md");

const readFile = name => fs.readFileSync(path.join(projectDir, name), "utf8");

const readme = fs.existsSync(readmePath) ? fs.readFileSync(readmePath, "utf8") : "";
const appSource = readFile("app.js");

// zwraca tresc sekcji od naglowka o podanym tytule do nastepnego naglowka tego samego albo wyzszego poziomu
function section(title) {
    const lines = readme.split(/\r?\n/);
    const start = lines.findIndex(line => /^#{1,6} /.test(line) && line.replace(/^#+ /, "").trim() === title);

    assert.notEqual(start, -1, `brak naglowka "${title}"`);

    const level = lines[start].match(/^#+/)[0].length;
    const rest = lines.slice(start + 1);
    const end = rest.findIndex(line => /^#{1,6} /.test(line) && line.match(/^#+/)[0].length <= level);

    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// wiersz tabeli zaczynajacy sie od podanej pierwszej komorki
function tableRow(text, firstCell) {
    const row = text.split(/\r?\n/).find(line => line.startsWith("|") && line.split("|")[1].trim().startsWith(firstCell));

    assert.ok(row, `brak wiersza tabeli "${firstCell}"`);

    return row;
}

test("README.md istnieje, jest w UTF-8 bez BOM i po polsku", () => {
    assert.ok(fs.existsSync(readmePath), "brak pliku README.md");
    assert.notEqual(readme.charCodeAt(0), 0xFEFF, "plik zaczyna sie od BOM");
    assert.ok(!readme.includes("�"), "plik ma zepsute znaki");
    assert.match(readme, /^# Pobierak\r?\n/);
    assert.match(readme, /[ąćęłńóśźż]/);
});

test("README ma wszystkie wymagane sekcje", () => {
    [
        "Wymagania", "Instalacja", "Windows", "macOS", "Linux", "Uruchamianie", "Na czym sprawdzono",
        "Gdy YouTube przestaje działać", "Ustawienia", "Folder `bin`", "Panel EXPERIMENTAL", "Linki", "Folder docelowy i pobieranie", "Licencja"
    ].forEach(title => section(title));

    // sekcje systemow sa czescia "Instalacja"
    const install = section("Instalacja");

    ["### Windows", "### macOS", "### Linux"].forEach(heading => assert.ok(install.includes(heading), heading));
});

test("zrzut ekranu jest w repozytorium i jest plikiem PNG", () => {
    const image = readme.match(/!\[[^\]]+\]\(([^)]+)\)/);

    assert.ok(image, "brak obrazka w README");
    assert.ok(!/^https?:/.test(image[1]), "zrzut ma lezec w repozytorium, a nie pod adresem zewnetrznym");

    const imagePath = path.join(projectDir, image[1]);

    assert.ok(fs.existsSync(imagePath), `brak pliku ${image[1]}`);

    const data = fs.readFileSync(imagePath);

    assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], "to nie jest plik PNG");
    assert.ok(data.readUInt32BE(16) >= 800, "zrzut jest za waski");      // szerokosc z naglowka IHDR
    assert.ok(data.readUInt32BE(20) >= 500, "zrzut jest za niski");
    assert.ok(data.length > 20000, "zrzut jest podejrzanie maly");
});

test("odnosniki do plikow i do sekcji prowadza w istniejace miejsca", () => {
    const links = [...readme.matchAll(/\]\(([^)\s]+)\)/g)].map(match => match[1]);

    const local = links.filter(link => !/^https?:/.test(link) && !link.startsWith("#"));

    assert.ok(local.includes("LICENSE"));
    local.forEach(link => assert.ok(fs.existsSync(path.join(projectDir, link)), `odnosnik do nieistniejacego pliku: ${link}`));

    // kotwice: naglowek zapisany malymi literami, bez znakow specjalnych, odstepy jako myslniki (tak jak robi to GitHub)
    const anchors = readme.split(/\r?\n/)
        .filter(line => /^#{1,6} /.test(line))
        .map(line => line.replace(/^#+ /, "").trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-"));

    links.filter(link => link.startsWith("#")).forEach(link => {
        assert.ok(anchors.includes(link.slice(1)), `odnosnik do nieistniejacej sekcji: ${link}`);
    });
});

test("wymagania: Node w wersji z package.json, yt-dlp, ffmpeg, Deno", () => {
    const requirements = section("Wymagania");
    const minNode = JSON.parse(readFile("package.json")).engines.node.replace(">=", "");

    assert.ok(tableRow(requirements, "[Node.js]").includes(`${minNode} lub nowszy`));
    ["[yt-dlp]", "[ffmpeg]", "[Deno]"].forEach(name => tableRow(requirements, name));
});

test("Windows: kroki ze start.bat i komendy winget z tymi samymi identyfikatorami co w skrypcie", () => {
    const windows = section("Windows");
    const idsInScript = [...readFile("start.bat").matchAll(/winget install --id (\S+) -e/g)].map(match => match[1]).sort();
    const idsInReadme = [...windows.matchAll(/^winget install --id (\S+) -e$/gm)].map(match => match[1]).sort();

    assert.equal(idsInScript.length, 4);
    assert.deepEqual(idsInReadme, idsInScript);

    assert.match(windows, /^1\. .*Download ZIP.*git clone/m);
    assert.match(windows, /^3\. .*`start\.bat`/m);
    assert.match(windows, /^4\. .*`Zainstalowac\? \[T\/N\]`.*`winget`/m);
    assert.match(windows, /^5\. .*`start\.bat`\*\* jeszcze raz/m);
    assert.ok(windows.includes("http://localhost:3000"));
    assert.match(windows, /Instalacja ręczna/);
    assert.match(windows, /^npm install\r?\nnpm start$/m);

    // pytanie w README jest tym samym tekstem, ktory wypisuje skrypt
    assert.ok(readFile("start.bat").includes("Zainstalowac? [T/N]"));
});

test("macOS: Homebrew z komenda ze start.command, start.command, blokada pliku, instalacja reczna", () => {
    const mac = section("macOS");
    const brewCommand = readFile("start.command").match(/\/bin\/bash -c "\$\(curl [^"]+\)"/);

    assert.ok(brewCommand, "nie znaleziono komendy Homebrew w start.command");
    assert.ok(mac.includes(brewCommand[0]), "komenda instalacji Homebrew rozni sie od tej ze start.command");
    assert.ok(mac.includes("https://brew.sh"));

    assert.match(mac, /^3\. .*`start\.command`/m);
    assert.match(mac, /^4\. .*`Zainstalowac\? \[T\/N\]`.*`brew`.*od razu/m);
    assert.match(mac, /prawym przyciskiem.*\*\*Otwórz\*\*/);
    assert.match(mac, /^sh start\.command$/m);

    const manual = mac.match(/^brew install (.+)$/m);

    assert.ok(manual, "brak komendy brew install");
    assert.deepEqual(manual[1].split(" ").sort(), ["deno", "ffmpeg", "node", "yt-dlp"]);
    assert.match(mac, /^npm install\r?\nnpm start$/m);
});

test("Linux: wprost napisane, ze nieuruchamiany; apt, dnf, pacman; yt-dlp z pliku albo pipx; ./start.sh", () => {
    const linux = section("Linux");

    assert.match(linux, /Na Linuksie program nie był uruchamiany ani razu/);
    assert.match(linux, /Zgłoszenia błędów są mile widziane/);
    assert.match(linux, /`start\.sh` niczego nie instaluje/);

    assert.match(linux, /^\s*sudo apt install .*nodejs.*ffmpeg/m);
    assert.match(linux, /^\s*sudo dnf install .*nodejs.*ffmpeg/m);
    assert.match(linux, /^\s*sudo pacman -S .*nodejs.*ffmpeg/m);
    assert.match(linux, /^\s*pipx install yt-dlp$/m);
    assert.ok(linux.includes("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"));
    assert.match(linux, /za stare/);
    assert.match(linux, /deno/i);
    assert.match(linux, /^\s*\.\/start\.sh$/m);
    assert.match(linux, /Dwuklik w `start\.sh` zależy od menedżera plików/);
    assert.match(linux, /^npm install\r?\nnpm start$/m);
});

test("uruchamianie: trzy skrypty istnieja i sa opisane, npm start jako sposob wszedzie", () => {
    const run = section("Uruchamianie");

    [["Windows", "start.bat"], ["macOS", "start.command"], ["Linux", "start.sh"]].forEach(([system, script]) => {
        assert.ok(tableRow(run, system).includes(script), `${system}: ${script}`);
        assert.ok(fs.existsSync(path.join(projectDir, script)), `brak pliku ${script}`);
    });

    assert.match(run, /^npm start$/m);
    assert.equal(JSON.parse(readFile("package.json")).scripts.start, "node app.js");
});

test("tabela 'na czym sprawdzono' nie opisuje Linuksa ani macOS jako sprawdzonych", () => {
    const checked = section("Na czym sprawdzono");

    assert.match(tableRow(checked, "Windows 11"), /Pobieranie sprawdzone ręcznie/);
    assert.match(tableRow(checked, "Linux"), /\| Niesprawdzony\./);
    // macOS: albo sprawdzony z podana wersja systemu, albo wprost niesprawdzony
    assert.match(tableRow(checked, "macOS"), /\| Niesprawdzony\.|macOS \d+.*sprawdzone ręcznie/);
});

test("aktualizacja yt-dlp: komenda dla kazdego sposobu instalacji", () => {
    const update = section("Gdy YouTube przestaje działać");
    const wingetId = readFile("start.bat").match(/winget install --id (yt-dlp\.\S+) -e/)[1];

    assert.equal(wingetId, "yt-dlp.yt-dlp");
    [`winget upgrade --id ${wingetId} -e`, "brew upgrade yt-dlp", "yt-dlp -U", "pipx upgrade yt-dlp"].forEach(command => {
        assert.ok(update.includes(`\`${command}\``), command);
    });
});

test("zmienne srodowiskowe z README sa tymi, ktore czyta app.js, z tymi samymi wartosciami domyslnymi", () => {
    const settings = section("Ustawienia");

    assert.ok(appSource.includes("process.env.PORT || 3000"));
    assert.ok(appSource.includes('process.env.HOST || "127.0.0.1"'));
    assert.ok(appSource.includes('resolveBinary("YTDLP_PATH", "yt-dlp")'));
    assert.ok(appSource.includes('resolveBinary("FFMPEG_PATH", "ffmpeg")'));

    assert.ok(tableRow(settings, "`PORT`").includes("| `3000` |"));
    // HOST zostaje w kodzie, ale README go nie opisuje (decyzja wlasciciela, zadanie GH-2a)
    assert.ok(!/`HOST`|HOST=/.test(readme), "README nie ma opisywac HOST");
    tableRow(settings, "`YTDLP_PATH`");
    tableRow(settings, "`FFMPEG_PATH`");

    // README nie opisuje zmiennych, ktorych program nie czyta
    const described = settings.split(/\r?\n/).filter(line => /^\| `[A-Z_]+` \|/.test(line)).length;

    assert.equal(described, 3);

    // przyklad dla trzech powlok
    assert.match(settings, /^set PORT=3001$/m);
    assert.match(settings, /^\$env:PORT = "3001"$/m);
    assert.match(settings, /^PORT=3001 npm start$/m);
});

test("folder bin: nazwy plikow dla Windowsa i pozostalych systemow, kolejnosc szukania", () => {
    const bin = section("Folder `bin`");

    ["`yt-dlp.exe`", "`ffmpeg.exe`", "`yt-dlp`", "`ffmpeg`"].forEach(name => assert.ok(bin.includes(name), name));
    assert.match(bin, /zmienna środowiskowa → folder `bin` → .*PATH/);
});

test("panel EXPERIMENTAL: wszystkie ustawienia z formularza", () => {
    const panel = section("Panel EXPERIMENTAL");
    const html = readFile(path.join("public", "index.html"));

    [["Bitcrush", "bitcrush"], ["Sample rate", "sampleRate"], ["Mono / Stereo", "channels"], ["Normalizuj głośność", "normalize"], ["Przytnij", "trimStart"]]
        .forEach(([label, fieldName]) => {
            tableRow(panel, `**${label}**`);
            assert.ok(html.includes(`name="${fieldName}"`), `formularz nie ma pola ${fieldName}`);
        });

    // zapisy czasu z README sa przyjmowane przez program
    const { parseTimeToSeconds } = require(path.join(projectDir, "app.js"));

    assert.ok(panel.includes("`90`") && panel.includes("`1:30`") && panel.includes("`1:02:03`"));
    assert.equal(parseTimeToSeconds("90"), 90);
    assert.equal(parseTimeToSeconds("1:30"), 90);
    assert.equal(parseTimeToSeconds("1:02:03"), 3723);
});

test("formaty wymienione w README to formaty przyjmowane przez program", () => {
    const intro = readme.slice(0, readme.indexOf("## Wymagania"));
    const formats = name => JSON.parse(appSource.match(new RegExp(`const ${name} = (\\[[^\\]]+\\]);`))[1]);

    const audioLine = intro.split(/\r?\n/).find(line => line.includes("**Tylko audio**"));
    const videoLine = intro.split(/\r?\n/).find(line => line.includes("**Film z dźwiękiem**"));

    formats("allowedAudioFormats").forEach(format => assert.ok(audioLine.includes(format.toUpperCase()), `audio: ${format}`));
    formats("allowedVideoFormats").forEach(format => assert.ok(videoLine.includes(format.toUpperCase()), `film: ${format}`));

    // README nie obiecuje formatow, ktorych nie ma (slowa z wielkich liter i cyfr, z co najmniej jedna litera)
    const mentioned = line => line.match(/\b(?=[A-Z0-9]*[A-Z])[A-Z0-9]{3,5}\b/g).map(word => word.toLowerCase());

    assert.deepEqual(mentioned(audioLine).sort(), formats("allowedAudioFormats").sort());
    assert.deepEqual(mentioned(videoLine).sort(), formats("allowedVideoFormats").sort());

    assert.ok(intro.includes("Dźwięk i obraz osobno"));
});

test("folder docelowy: opis wyboru folderu, przycisku Pokaz w folderze, rozdzielczosci i anulowania; bez pobierania przez przegladarke", () => {
    const folder = section("Folder docelowy i pobieranie");
    const { fileMaxAgeMinutes } = require(path.join(projectDir, "app.js"));
    const interval = Number(appSource.match(/const cleanupIntervalMinutes = (\d+);/)[1]);

    assert.match(folder, /Bez wybranego folderu pobrać się nie da/);
    assert.match(folder, /od razu w tym folderze/);
    assert.ok(folder.includes("Pokaż w folderze"));
    assert.ok(readFile(path.join("public", "script.js")).includes("Pokaż w folderze"));
    assert.ok(readFile(path.join("public", "index.html")).includes("Wybierz folder"));

    assert.match(folder, /Domyślnie wybrane jest 1080p/);
    assert.match(folder, /1440p i 2160p są dostępne tylko dla MKV/);
    assert.match(folder, /H\.264.*1080p.*„Best”/s);
    assert.match(folder, /Zamknięcie albo odświeżenie karty.*przerywa/);

    // downloads to tylko miejsce robocze; czasy sprzatania zgadzaja sie z app.js
    assert.ok(folder.includes(`starsze niż ${fileMaxAgeMinutes} minut`));
    assert.ok(folder.includes(`co ${interval} minut`));

    // README nie opisuje pobierania pliku przez przegladarke
    assert.ok(!/folderu pobierania przeglądarki|przeglądarka zapisuje|Link pod przyciskiem/.test(readme));
    assert.ok(!readme.includes("HOST="));
});

test("linki: YouTube (pojedynczy film, short, zakonczona transmisja) i Pinterest, reszta odrzucana", () => {
    const links = section("Linki");

    assert.match(links, /YouTube i Pinterest/);
    assert.ok(links.includes("youtube.com/shorts/") && links.includes("pinterest.com/pin/"));
    assert.match(links, /pojedynczy film, short albo zapis zakończonej transmisji/);
    assert.match(links, /Playlisty, kanały i trwające transmisje są odrzucane/);
});

test("licencja: MIT z odnosnikiem do pliku LICENSE, zgodna z package.json", () => {
    const license = section("Licencja");

    assert.ok(license.includes("[MIT](LICENSE)"));
    assert.ok(license.includes("2026 agawa98"));
    assert.equal(JSON.parse(readFile("package.json")).license, "MIT");
});

test("komendy npm z README istnieja w package.json", () => {
    const scripts = JSON.parse(readFile("package.json")).scripts;
    const used = new Set([...readme.matchAll(/npm (?:run )?(start|test(?::[a-z]+)?)\b/g)].map(match => match[1]));

    assert.ok(used.has("start") && used.has("test"));
    used.forEach(name => assert.ok(scripts[name], `package.json nie ma skryptu ${name}`));
});
