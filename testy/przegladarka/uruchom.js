// Uruchamia wszystkie sprawdzenia strony w przegladarce: pliki *.przegladarka.js z tego folderu.
// Wywolanie: npm run test:przegladarka (albo node testy/przegladarka/uruchom.js). Wymaga przegladarki Edge.
// Osobny plik zamiast wzorca w package.json, zeby polecenie dzialalo tak samo w kazdej powloce i wersji Node.

const fs = require("node:fs");
const path = require("node:path");

fs.readdirSync(__dirname)
    .filter(name => name.endsWith(".przegladarka.js"))
    .sort()
    .forEach(name => require(path.join(__dirname, name)));
