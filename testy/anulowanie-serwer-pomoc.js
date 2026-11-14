// Serwer dla testow zadania BUG-2 (testy/anulowanie.test.js). To nie jest plik z testami.
// Uruchamiany jako osobny proces: node anulowanie-serwer-pomoc.js <kopia app.js w os.tmpdir()> <atrapa programu>
// Wczytuje kopie app.js (jej folder downloads lezy w os.tmpdir()), a zamiast yt-dlp i ffmpeg uruchamia atrape -
// prawdziwy proces Node, zeby anulowanie mialo co zabijac. taskkill jest uruchamiany naprawde.
// Slucha na losowym wolnym porcie i wypisuje go w linii "PORT <numer>".

const childProcess = require("node:child_process");

const [appPath, fakeProgramPath] = process.argv.slice(2);
const originalSpawn = childProcess.spawn;

childProcess.spawn = (command, args, options) => {
    if (command === "taskkill") {
        return originalSpawn(command, args, options);
    }

    return originalSpawn(process.execPath, [fakeProgramPath, command, ...args], options);
};

const appModule = require(appPath);

// identyfikatory zadan w toku - test sprawdza, czy anulowane zadanie znika ze zbioru
appModule.app.get("/test/zadania", (req, res) => {
    res.json([...appModule.activeJobs.keys()]);
});

const server = appModule.app.listen(0, "127.0.0.1", () => {
    console.log(`PORT ${server.address().port}`);
});
