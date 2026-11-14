// Testy zadania B13a: logi z backendu trafiaja do strony z prawdziwymi znakami konca linii,
// a strona dzieli je na osobne wiersze (\n, \r\n i samo \r).
// Nic nie pobieraja z internetu i nie uruchamiaja yt-dlp ani ffmpeg. Serwer slucha na losowym wolnym porcie
// tylko na 127.0.0.1 i jest zamykany po kazdym tescie.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");

const appModule = require(path.join(__dirname, "..", "app.js"));
const scriptPath = path.join(__dirname, "..", "public", "script.js");
const scriptSource = fs.readFileSync(scriptPath, "utf8");

// ---------- pomocnicze: serwer i klient logow ----------

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

// podlacza sie do /api/logs tak jak EventSource i zbiera surowe zdarzenia (tekst miedzy pustymi liniami)
function connectLogClient(server) {
    return new Promise((resolve, reject) => {
        const client = { events: [], waiting: [], request: null };

        client.request = http.get({ host: "127.0.0.1", port: server.address().port, path: "/api/logs" }, (res) => {
            let buffer = "";

            res.setEncoding("utf8");
            res.on("data", (chunk) => {
                buffer += chunk;

                let end = buffer.indexOf("\n\n");

                while (end !== -1) {
                    client.events.push(buffer.slice(0, end));
                    buffer = buffer.slice(end + 2);
                    end = buffer.indexOf("\n\n");
                }

                client.waiting.splice(0).forEach(check => check());
            });
            res.on("error", () => {});
        });

        client.request.on("error", () => {});

        // czeka, az przyjdzie co najmniej "count" zdarzen
        client.waitForEvents = (count) => new Promise((done, fail) => {
            const timer = setTimeout(() => fail(new Error(`przyszlo ${client.events.length} zdarzen zamiast ${count}`)), 5000);

            const check = () => {
                if (client.events.length >= count) {
                    clearTimeout(timer);
                    done();
                } else {
                    client.waiting.push(check);
                }
            };

            check();
        });

        // pierwsze zdarzenie to powitanie; dopiero po nim klient jest na liscie odbiorcow
        client.waitForEvents(1).then(() => resolve(client), reject);
    });
}

// zdarzenie SSE musi byc jedna linia "data: <json>". zwraca rozkodowany obiekt
function parseEvent(rawEvent) {
    assert.equal(rawEvent.startsWith("data: "), true, `zdarzenie nie zaczyna sie od "data: ": ${JSON.stringify(rawEvent)}`);
    assert.equal(/[\r\n]/.test(rawEvent), false, `zdarzenie ma w srodku znak konca linii: ${JSON.stringify(rawEvent)}`);

    return JSON.parse(rawEvent.slice("data: ".length));
}

async function sendAndReceive(type, message) {
    const server = await startServer();

    try {
        const client = await connectLogClient(server);

        appModule.sendLogToClients(type, message);
        await client.waitForEvents(2);
        client.request.destroy();

        assert.equal(client.events.length, 2, "jedno wywolanie sendLogToClients to jedno zdarzenie");

        return parseEvent(client.events[1]);
    } finally {
        await stopServer(server);
    }
}

// ---------- pomocnicze: splitLogLines ze strony ----------

// wycina funkcje splitLogLines z public/script.js i uruchamia ja bez przegladarki (reszta pliku potrzebuje DOM)
function loadSplitLogLines() {
    const match = scriptSource.match(/function splitLogLines\(message\) \{[\s\S]*?\r?\n\}/);

    assert.ok(match, "w public/script.js nie ma funkcji splitLogLines(message)");

    return vm.runInNewContext(`(${match[0]})`);
}

// vm zwraca tablice z innego "swiata", wiec do porownan przepisujemy ja na zwykla
function split(message) {
    return Array.from(loadSplitLogLines()(message));
}

// ---------- backend: sendLogToClients ----------

test("B13a: powitanie na /api/logs dalej jest jednym zdarzeniem typu system", async () => {
    const server = await startServer();

    try {
        const client = await connectLogClient(server);
        client.request.destroy();

        assert.deepEqual(parseEvent(client.events[0]), { type: "system", message: "Połączono z logami backendu." });
    } finally {
        await stopServer(server);
    }
});

test("B13a: wiadomosc z \\n dociera z prawdziwym znakiem nowej linii, a nie z tekstem \\\\n", async () => {
    const message = "[download]  10.0% of 5.00MiB\n[download]  20.0% of 5.00MiB\n";

    assert.deepEqual(await sendAndReceive("YT-DLP", message), { type: "YT-DLP", message });
});

test("B13a: znaki \\r i \\r\\n dochodza bez zmian", async () => {
    const message = "frame=  10 fps=0.0\rframe=  20 fps=0.0\r\nkoniec";

    assert.deepEqual(await sendAndReceive("FFMPEG", message), { type: "FFMPEG", message });
});

test("B13a: tekst z ukosnikiem i litera n (np. sciezka Windows) dochodzi bez zmian", async () => {
    const message = "C:\\nowy\\folder\\plik.mp3 \"cudzyslow\" ąęłż";

    assert.deepEqual(await sendAndReceive("YT-DLP", message), { type: "YT-DLP", message });
});

test("B13a: wiadomosc, ktora nie jest napisem, jest zamieniana na napis", async () => {
    assert.deepEqual(await sendAndReceive("YT-DLP", Buffer.from("linia 1\nlinia 2")), { type: "YT-DLP", message: "linia 1\nlinia 2" });
    assert.deepEqual(await sendAndReceive("YT-DLP", 42), { type: "YT-DLP", message: "42" });
});

test("B13a: kazdy podlaczony klient dostaje to samo zdarzenie, kolejne wywolania to kolejne zdarzenia", async () => {
    const server = await startServer();

    try {
        const first = await connectLogClient(server);
        const second = await connectLogClient(server);

        appModule.sendLogToClients("YT-DLP", "a\nb");
        appModule.sendLogToClients("FFMPEG", "c\rd");

        await first.waitForEvents(3);
        await second.waitForEvents(3);
        first.request.destroy();
        second.request.destroy();

        for (const client of [first, second]) {
            assert.equal(client.events.length, 3);
            assert.deepEqual(parseEvent(client.events[1]), { type: "YT-DLP", message: "a\nb" });
            assert.deepEqual(parseEvent(client.events[2]), { type: "FFMPEG", message: "c\rd" });
        }
    } finally {
        await stopServer(server);
    }
});

// ---------- frontend: splitLogLines ----------

test("B13a: splitLogLines dzieli po \\n", () => {
    assert.deepEqual(
        split("[download]  10.0% of 5.00MiB\n[download]  20.0% of 5.00MiB\n[download] 100% of 5.00MiB"),
        ["[download]  10.0% of 5.00MiB", "[download]  20.0% of 5.00MiB", "[download] 100% of 5.00MiB"]
    );
});

test("B13a: splitLogLines dzieli po samym \\r (postep ffmpeg i yt-dlp bez --newline)", () => {
    assert.deepEqual(split("frame= 10\rframe= 20\rframe= 30"), ["frame= 10", "frame= 20", "frame= 30"]);
});

test("B13a: splitLogLines dzieli po \\r\\n (Windows) i nie robi z tego pustej linii", () => {
    assert.deepEqual(split("linia 1\r\nlinia 2\r\n"), ["linia 1", "linia 2"]);
});

test("B13a: splitLogLines - mieszane konce linii, puste linie i spacje na brzegach", () => {
    assert.deepEqual(split("\n  a  \r\n\r\nb\r\rc\n\n"), ["a", "b", "c"]);
});

test("B13a: splitLogLines nie dzieli po tekscie z ukosnikiem i litera n", () => {
    assert.deepEqual(split("C:\\nowy\\folder"), ["C:\\nowy\\folder"]);
    assert.deepEqual(split("a\\nb"), ["a\\nb"]);
});

test("B13a: splitLogLines - jedna linia, pusty napis i same konce linii", () => {
    assert.deepEqual(split("jedna linia"), ["jedna linia"]);
    assert.deepEqual(split(""), []);
    assert.deepEqual(split("\r\n\n\r"), []);
});

test("B13a: odbieranie logow na stronie uzywa splitLogLines, a stary podzial po tekscie \\\\n zniknal", () => {
    const handler = scriptSource.match(/backendLogs\.onmessage = \(event\) => \{[\s\S]*?\r?\n\};/);

    assert.ok(handler, "w public/script.js nie ma backendLogs.onmessage");
    assert.match(handler[0], /splitLogLines\(log\.message\)/);
    assert.equal(scriptSource.includes('.split("\\\\n")'), false, "zostal podzial po tekscie \\\\n");
});

// ---------- cala droga: backend -> strona ----------

test("B13a: porcja wyjscia yt-dlp z kilkoma liniami postepu daje po przejsciu przez serwer osobne linie", async () => {
    const chunk = "[download]   0.5% of    5.00MiB at  1.00MiB/s ETA 00:05\n"
        + "[download]  50.0% of    5.00MiB at  2.00MiB/s ETA 00:01\r\n"
        + "[download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s\n";

    const received = await sendAndReceive("YT-DLP", chunk);

    assert.deepEqual(split(received.message), [
        "[download]   0.5% of    5.00MiB at  1.00MiB/s ETA 00:05",
        "[download]  50.0% of    5.00MiB at  2.00MiB/s ETA 00:01",
        "[download] 100% of    5.00MiB in 00:00:02 at 2.50MiB/s"
    ]);
});
