// Testy zadania BUG-1a: sprawdzanie linku YouTube przed pobieraniem (zakaz playlist, kanalow i innych stron YouTube).
// sprawdzLinkYoutube z app.js (serwer) i z public/script.js (strona) maja dawac identyczne wyniki:
// null = link przyjety, tekst = komunikat bledu. Linki spoza YouTube przechodza bez oceny.
// Nic nie pobieraja z internetu: zadania do /api/download w tych testach sa odrzucane (400) przed pobieraniem.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const appModule = require(path.join(__dirname, "..", "app.js"));
const scriptSource = fs.readFileSync(path.join(__dirname, "..", "public", "script.js"), "utf8");

// wycina funkcje sprawdzLinkYoutube z public/script.js i uruchamia ja bez przegladarki (reszta pliku potrzebuje DOM).
// w nowym kontekscie vm nie ma URL, wiec podajemy ten z Node (ta sama norma WHATWG co w przegladarce)
function loadFrontendCheck() {
    const match = scriptSource.match(/function sprawdzLinkYoutube\(url\) \{[\s\S]*?\r?\n\}/);

    assert.ok(match, "w public/script.js nie ma funkcji sprawdzLinkYoutube(url)");

    return vm.runInNewContext(`(${match[0]})`, { URL });
}

const sides = [
    { name: "serwer (app.js)", check: appModule.sprawdzLinkYoutube },
    { name: "strona (public/script.js)", check: loadFrontendCheck() }
];

const PLAYLIST = "To link do playlisty. Wklej link do jednego filmu.";
const CHANNEL = "To link do kanału. Wklej link do jednego filmu.";
const NOT_VIDEO = "To nie jest link do filmu.";

// [link, oczekiwany wynik]: null = przyjety
const cases = [
    // przyjete: jeden film
    ["https://www.youtube.com/watch?v=jBoKCUKJkiY", null],
    ["https://youtube.com/watch?v=jBoKCUKJkiY", null],
    ["https://m.youtube.com/watch?v=jBoKCUKJkiY", null],
    ["https://music.youtube.com/watch?v=jBoKCUKJkiY", null],
    ["http://www.youtube.com/watch?v=jBoKCUKJkiY", null],
    ["https://WWW.YouTube.com/watch?v=jBoKCUKJkiY", null],
    ["https://www.youtube.com/watch?v=jBoKCUKJkiY&t=42s", null],
    ["https://www.youtube.com/watch?feature=share&v=jBoKCUKJkiY", null],
    ["https://www.youtube.com/watch/?v=jBoKCUKJkiY", null],
    // film z playlisty: pobiera sie tylko ten film (--no-playlist zostaje)
    ["https://www.youtube.com/watch?v=jBoKCUKJkiY&list=PLtestowaPlaylista123", null],
    ["https://www.youtube.com/watch?v=jBoKCUKJkiY&list=PLtestowaPlaylista123&index=2", null],
    ["https://www.youtube.com/watch?list=PLtestowaPlaylista123&v=jBoKCUKJkiY", null],
    ["https://music.youtube.com/watch?v=jBoKCUKJkiY&list=RDAMVMjBoKCUKJkiY", null],
    ["https://www.youtube.com/shorts/jBoKCUKJkiY", null],
    ["https://youtube.com/shorts/jBoKCUKJkiY?feature=share", null],
    ["https://www.youtube.com/shorts/jBoKCUKJkiY/", null],
    ["https://www.youtube.com/live/jBoKCUKJkiY", null],
    ["https://www.youtube.com/live/jBoKCUKJkiY?si=abc", null],
    ["https://www.youtube.com/embed/jBoKCUKJkiY", null],
    ["https://www.youtube-nocookie.com/embed/jBoKCUKJkiY", null],
    ["https://youtube-nocookie.com/embed/jBoKCUKJkiY?start=10", null],
    ["https://youtu.be/jBoKCUKJkiY", null],
    ["https://youtu.be/jBoKCUKJkiY?t=10", null],
    ["https://youtu.be/jBoKCUKJkiY?si=abc&list=PLtestowaPlaylista123", null],
    ["https://youtu.be/jBoKCUKJkiY/", null],
    ["  https://www.youtube.com/watch?v=jBoKCUKJkiY  ", null],

    // odrzucone: playlisty
    ["https://www.youtube.com/playlist?list=PLtestowaPlaylista123", PLAYLIST],
    ["https://youtube.com/playlist?list=PLtestowaPlaylista123&si=abc", PLAYLIST],
    ["https://m.youtube.com/playlist?list=PLtestowaPlaylista123", PLAYLIST],
    ["https://music.youtube.com/playlist?list=OLAK5uy_test", PLAYLIST],
    ["https://www.youtube.com/watch?list=PLtestowaPlaylista123", PLAYLIST],
    ["https://www.youtube.com/watch?list=PLtestowaPlaylista123&index=3", PLAYLIST],
    ["https://www.youtube.com/watch?v=&list=PLtestowaPlaylista123", PLAYLIST],

    // odrzucone: kanaly, takze z koncowkami
    ["https://www.youtube.com/channel/UC1234567890abcdefghijkl", CHANNEL],
    ["https://www.youtube.com/channel/UC1234567890abcdefghijkl/videos", CHANNEL],
    ["https://www.youtube.com/@nazwa", CHANNEL],
    ["https://www.youtube.com/@nazwa/", CHANNEL],
    ["https://m.youtube.com/@nazwa", CHANNEL],
    ["https://www.youtube.com/@nazwa/videos", CHANNEL],
    ["https://www.youtube.com/@nazwa/shorts", CHANNEL],
    ["https://www.youtube.com/@nazwa/streams", CHANNEL],
    ["https://www.youtube.com/@nazwa/live", CHANNEL],
    ["https://www.youtube.com/@nazwa?si=abc", CHANNEL],
    ["https://www.youtube.com/c/nazwa", CHANNEL],
    ["https://www.youtube.com/c/nazwa/videos", CHANNEL],
    ["https://www.youtube.com/c/nazwa/streams", CHANNEL],
    ["https://www.youtube.com/user/nazwa", CHANNEL],
    ["https://www.youtube.com/user/nazwa/shorts", CHANNEL],
    ["https://www.youtube.com/user/nazwa/live", CHANNEL],
    ["https://www.youtube.com/channel/UC1234567890abcdefghijkl/streams", CHANNEL],

    // odrzucone: inne strony YouTube
    ["https://www.youtube.com/", NOT_VIDEO],
    ["https://www.youtube.com", NOT_VIDEO],
    ["https://youtu.be/", NOT_VIDEO],
    ["https://youtu.be/jBoKCUKJkiY/cos", NOT_VIDEO],
    ["https://www.youtube.com/feed/subscriptions", NOT_VIDEO],
    ["https://www.youtube.com/feed/trending", NOT_VIDEO],
    ["https://www.youtube.com/results?search_query=kot", NOT_VIDEO],
    ["https://www.youtube.com/watch", NOT_VIDEO],
    ["https://www.youtube.com/watch?v=", NOT_VIDEO],
    ["https://www.youtube.com/watch?t=10", NOT_VIDEO],
    ["https://www.youtube.com/playlist", NOT_VIDEO],
    ["https://www.youtube.com/shorts", NOT_VIDEO],
    ["https://www.youtube.com/shorts/", NOT_VIDEO],
    ["https://www.youtube.com/shorts/jBoKCUKJkiY/cos", NOT_VIDEO],
    ["https://www.youtube.com/live", NOT_VIDEO],
    ["https://www.youtube.com/embed", NOT_VIDEO],
    ["https://www.youtube.com/channel", NOT_VIDEO],
    ["https://www.youtube.com/channel/", NOT_VIDEO],
    ["https://www.youtube.com/c", NOT_VIDEO],
    ["https://www.youtube.com/user", NOT_VIDEO],
    ["https://www.youtube.com/@", NOT_VIDEO],
    ["https://music.youtube.com/", NOT_VIDEO],
    ["https://www.youtube-nocookie.com/", NOT_VIDEO],

    // inne serwisy i hosty podobne do YouTube: bez oceny (ocenia je yt-dlp)
    ["https://vimeo.com/123456", null],
    ["https://www.pinterest.com/pin/123456/", null],
    ["https://example.com/playlist?list=PLtestowaPlaylista123", null],
    ["https://example.com/@nazwa", null],
    ["https://notyoutube.com/playlist?list=PLtestowaPlaylista123", null],
    ["https://youtube.com.example.com/playlist?list=PLtestowaPlaylista123", null],
    ["https://gaming.youtube.com/playlist?list=PLtestowaPlaylista123", null],
    ["http://127.0.0.1:9/nie-istnieje", null],

    // nie da sie odczytac jako adres: bez oceny (odrzuca je reszta walidacji jako "Nieprawidłowy URL.")
    ["", null],
    ["to nie jest adres", null],
    ["www.youtube.com/playlist?list=PLtestowaPlaylista123", null]
];

for (const side of sides) {
    test(`BUG-1a: ${side.name} - tabela linkow przyjetych i odrzuconych`, () => {
        for (const [url, expected] of cases) {
            assert.strictEqual(side.check(url), expected, `${JSON.stringify(url)} powinno dac ${JSON.stringify(expected)}`);
        }
    });
}

test("BUG-1a: obie kopie funkcji daja identyczny wynik dla kazdego linku z tabeli", () => {
    const [backend, frontend] = sides;

    for (const [url] of cases) {
        assert.strictEqual(backend.check(url), frontend.check(url), `rozny wynik dla ${JSON.stringify(url)}`);
    }
});

test("BUG-1a: obie kopie funkcji daja identyczny wynik dla wszystkich polaczen hosta, sciezki i parametrow", () => {
    const [backend, frontend] = sides;
    const hosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com",
        "www.youtube-nocookie.com", "youtu.be", "example.com"];
    const paths = ["", "/", "/watch", "/playlist", "/shorts/abc", "/shorts", "/live/abc", "/embed/abc", "/abc", "/abc/def",
        "/channel/UCx", "/@nazwa", "/@nazwa/videos", "/c/nazwa/live", "/user/nazwa/streams", "/feed/trending", "/results"];
    const queries = ["", "?v=abc", "?list=PLx", "?v=abc&list=PLx", "?v=", "?list=", "?search_query=kot"];
    let checked = 0;

    for (const host of hosts) {
        for (const urlPath of paths) {
            for (const query of queries) {
                const url = `https://${host}${urlPath}${query}`;

                assert.strictEqual(backend.check(url), frontend.check(url), `rozny wynik dla ${url}`);
                checked++;
            }
        }
    }

    assert.equal(checked, hosts.length * paths.length * queries.length);
});

// ---------- endpoint /api/download: odrzucony link daje 400 z tym samym komunikatem ----------

function startServer() {
    return new Promise((resolve, reject) => {
        const server = appModule.app.listen(0, "127.0.0.1", () => resolve(server));
        server.on("error", reject);
    });
}

function stopServer(server) {
    return new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
    });
}

// zadanie audio z poprawnymi opcjami i podanym linkiem. trimStart = "1:75" (bledny czas) gwarantuje, ze nawet
// link przepuszczony przez sprawdzanie linku zostanie odrzucony dalej, wiec test nigdy niczego nie pobiera
async function postDownload(server, url, trimStart = "") {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            url,
            type: "audio",
            format: "mp3",
            bitrate: "best",
            resolution: "best",
            experimental: { bitcrush: 0, sampleRate: "default", channels: "stereo", normalize: false, trimStart, trimEnd: "" }
        })
    });

    return { status: response.status, body: await response.json() };
}

async function withQuietServer(run) {
    const server = await startServer();
    const originalLog = console.log;

    console.log = () => {};

    try {
        await run(server);
    } finally {
        console.log = originalLog;
        await stopServer(server);
    }
}

test("BUG-1a: /api/download odrzuca playlisty, kanaly i inne strony YouTube kodem 400 z komunikatem z funkcji", async () => {
    await withQuietServer(async (server) => {
        const rejected = cases.filter(([, expected]) => expected !== null);

        assert.ok(rejected.length > 40);

        for (const [url, expected] of rejected) {
            const result = await postDownload(server, url);

            assert.equal(result.status, 400, url);
            assert.deepEqual(result.body, { success: false, message: expected }, url);
        }
    });
});

test("BUG-1a: /api/download przepuszcza przez sprawdzanie linku film YouTube i link z innego serwisu", async () => {
    await withQuietServer(async (server) => {
        // bledny czas sprawia, ze serwer odrzuca zadanie dopiero na czasie przycinania - czyli link zostal przyjety
        for (const url of ["https://www.youtube.com/watch?v=jBoKCUKJkiY&list=PLtestowaPlaylista123", "https://youtu.be/jBoKCUKJkiY",
            "https://www.youtube.com/shorts/jBoKCUKJkiY", "https://vimeo.com/123456"]) {
            const result = await postDownload(server, url, "1:75");

            assert.equal(result.status, 400, url);
            assert.deepEqual(result.body, { success: false, message: "Nieprawidłowy format czasu przycinania." }, url);
        }
    });
});

test("BUG-1a: nieczytelny adres dalej daje stary komunikat Nieprawidlowy URL", async () => {
    await withQuietServer(async (server) => {
        const result = await postDownload(server, "www.youtube.com/playlist?list=PLtestowaPlaylista123");

        assert.equal(result.status, 400);
        assert.deepEqual(result.body, { success: false, message: "Nieprawidłowy URL." });
    });
});
