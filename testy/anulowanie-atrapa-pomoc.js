// Atrapa yt-dlp i ffmpeg dla testow zadania BUG-2 (testy/anulowanie.test.js). To nie jest plik z testami.
// Uruchamiana zamiast prawdziwego programu: node anulowanie-atrapa-pomoc.js <program> <argumenty programu...>
// Niczego nie pobiera. Pliki zapisuje tam, gdzie zapisalby je prawdziwy program (folder downloads kopii app.js w os.tmpdir()).
//
// ATRAPA_LOG  - plik, do ktorego atrapa dopisuje linie "start <numer> <pid> <pid potomka albo 0> <program>"
// ATRAPA_WISI - numer uruchomienia (liczony od 1), ktore ma dzialac bez konca; pozostale koncza sie od razu kodem 0.
//               Uruchomienie, ktore wisi, startuje wlasny proces potomny (tak jak yt-dlp uruchamia ffmpeg).

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");

const [command, ...args] = process.argv.slice(2);
const logPath = process.env.ATRAPA_LOG;
const hangOn = Number(process.env.ATRAPA_WISI || 0);

const previous = fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : "";
const callNumber = previous.split("\n").filter(line => line.startsWith("start ")).length + 1;
const hangs = callNumber === hangOn;

// plik, ktory zapisalby program: yt-dlp wedlug szablonu -o, ffmpeg - ostatni argument
let outputPath;

if (args.includes("-o")) {
    const template = args[args.indexOf("-o") + 1];
    const extension = args.includes("-x") ? "mp3" : "mp4";

    outputPath = template.replace("%(title).150B", "Film").replace("%(ext)s", extension);
} else {
    outputPath = args[args.length - 1];
}

let grandchildPid = 0;

if (hangs) {
    // niedokonczony plik: yt-dlp pisze do .part, ffmpeg prosto do pliku tmp-
    fs.writeFileSync(args.includes("-o") ? `${outputPath}.part` : outputPath, "niedokonczone");

    // Windows: Node sam zabija swoje zwykle procesy potomne, gdy ginie (inaczej niz yt-dlp z ffmpeg). detached to wylacza,
    // wiec potomka zabije dopiero taskkill /T. Poza Windowsem potomek zostaje w grupie procesu, do ktorej idzie sygnal
    const grandchild = childProcess.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);"], {
        stdio: "ignore",
        detached: process.platform === "win32",
        windowsHide: true
    });

    grandchildPid = grandchild.pid;
} else {
    fs.writeFileSync(outputPath, "gotowe");
}

fs.appendFileSync(logPath, `start ${callNumber} ${process.pid} ${grandchildPid} ${path.basename(command)}\n`);

if (hangs) {
    setInterval(() => {}, 1000);
}
