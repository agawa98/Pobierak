// Pomoc dla testow, ktore wysylaja POST /api/download (zadanie UL-2b). To nie jest plik z testami.
// Od UL-2b kazde zadanie pobrania musi miec pole "folder", a gotowy plik jest przenoszony z downloads do tego folderu.
//
// folderDocelowy - folder tymczasowy w os.tmpdir(), usuwany na koncu procesu testow. Testy dopisuja go do zadania.
//
// Wiele starszych testow udaje pliki w downloads samym podmienionym fs.readdirSync - takich plikow nie ma na dysku,
// wiec nie da sie ich przeniesc. Dla nich (i tylko dla nich: zrodlo nie istnieje) fs.promises.rename jest udawane:
// niczego nie przenosi, a pare [skad, dokad] dopisuje do listy udawanePrzeniesienia. Plik, ktory istnieje, jest
// przenoszony naprawde. Prawdziwe przenoszenie sprawdza testy/folder-docelowy.test.js.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const folderDocelowy = fs.mkdtempSync(path.join(os.tmpdir(), "pobierak-cel-"));

process.on("exit", () => {
    try {
        fs.rmSync(folderDocelowy, { recursive: true, force: true });
    } catch {
        // folder tymczasowy - system i tak go kiedys usunie
    }
});

const udawanePrzeniesienia = [];
const originalRename = fs.promises.rename;
const originalExistsSync = fs.existsSync;

fs.promises.rename = async (from, to) => {
    if (!originalExistsSync(from)) {
        udawanePrzeniesienia.push([String(from), String(to)]);
        return;
    }

    return originalRename.call(fs.promises, from, to);
};

module.exports = { folderDocelowy, udawanePrzeniesienia };
