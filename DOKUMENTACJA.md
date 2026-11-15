# Pobierak — dokumentacja techniczna

Krótki opis dla kogoś, kto chce zrozumieć albo zmienić kod. Instrukcja dla użytkownika jest w `README.md`.

## Z czego składa się program

- `app.js` — cały serwer (Node + Express). Waliduje żądania, uruchamia yt-dlp i ffmpeg, przenosi gotowe pliki, sprząta. Serwer startuje tylko przy `node app.js`; przy `require` (testy) plik jedynie eksportuje funkcje.
- `public/` — strona: `index.html`, `script.js` (formularz, walidacja, postęp, logi w tle), `style.css`, `fonts/`.
- `downloads/` — folder roboczy. yt-dlp i ffmpeg piszą tutaj; użytkownik nie bierze stąd plików.
- `testy/` — testy automatyczne (`*.test.js`), testy w przeglądarce (`testy/przegladarka/`), ręczny przegląd z internetem (`testy/przeglad/`).
- `start.bat` (Windows), `start.command` (macOS), `start.sh` (Linux) — uruchamianie dwuklikiem: sprawdzają `node`, `yt-dlp`, `ffmpeg`, `deno`, za zgodą doinstalowują brakujące, startują serwer i otwierają przeglądarkę.
- `.github/workflows/testy.yml` — `npm test` na Windowsie, macOS i Linuksie.

Programy zewnętrzne (`resolveBinary`): najpierw zmienna `YTDLP_PATH` / `FFMPEG_PATH`, potem folder `bin/` obok `app.js`, na końcu sama nazwa z `PATH`. Port: zmienna `PORT` (domyślnie 3000). Serwer nasłuchuje na `127.0.0.1`.

## Co się dzieje po kliknięciu „Pobierz”

1. **Strona** sprawdza link (`sprawdzLinkYoutube`), czasy przycięcia (`validateTrim`) i czy wybrano folder. Gdy coś jest źle, żądanie nie wychodzi. Potem wysyła `POST /api/download` z polami: `url`, `type`, `format`, `bitrate`, `resolution`, `experimental`, `folder`.
2. **Serwer** (`validateRequest`) sprawdza wszystko jeszcze raz: link, tryb, format, bitrate, rozdzielczość (1440p i 2160p tylko w MKV), opcje eksperymentalne, czasy, a na końcu folder (`sprawdzFolderDocelowy`: pełna ścieżka, istnieje, da się w nim zapisać — sprawdzane plikiem próbnym). Błąd = 400 z komunikatem po polsku.
3. Zadanie dostaje identyfikator (`getJobId`) i trafia do `activeJobs`. Każdy plik zadania ma w nazwie `[<jobId>]`.
4. **yt-dlp** pobiera do `downloads/` (`downloadAudio`, `downloadVideo`, `downloadSeparate`). Wspólne argumenty (`buildYtDlpBaseArgs`): `--no-playlist`, `--no-mtime`, `--newline`, `--match-filter "!is_live & !is_upcoming"`, `--playlist-items 1`. Wyjście idzie na żywo do logów strony; z linii postępu strona robi napis na przycisku.
5. **ffmpeg** (`processDownloadedFile`) uruchamia się tylko, gdy trzeba (`shouldProcessMedia`): efekty audio, mono, przycięcie, format mpeg/mjpeg, inne rozszerzenie niż wybrane, a w trybie „osobno” obraz mp4 (przepakowanie z `+faststart`). ffmpeg pisze do pliku `tmp-...`, który po sukcesie dostaje końcową nazwę.
6. **Zapis**: `moveFilesToTargetFolder` przenosi gotowe pliki do folderu docelowego (`rename`, a między dyskami kopia + usunięcie). Istniejący plik nie jest nadpisywany — nowy dostaje numer, np. `nazwa (2).mp3`.
7. Odpowiedź `{ success, message, files: [{ name, path }] }`. Serwer zapamiętuje zapisane ścieżki (`rememberSavedFiles`), żeby dało się je pokazać przyciskiem „Pokaż w folderze”.

Błąd pobierania daje 500 z komunikatem. Znane błędy yt-dlp mają czytelny tekst (`recognizeYtDlpError`: pin bez filmu, film bez dźwięku); trwająca transmisja daje osobny komunikat. Gdy yt-dlp ma ponad 90 dni, do błędu dochodzi rada o aktualizacji.

## Obsługiwane serwisy i reguły linków

Reguły są w `sprawdzLinkYoutube` — dwie identyczne kopie w `app.js` i `public/script.js` (zmieniać obie).
- **YouTube** (`youtube.com`, `www.`, `m.`, `music.`, `youtube-nocookie.com`, `youtu.be`): przyjmowane `/watch?v=...`, `youtu.be/<id>`, `/shorts/<id>`, `/live/<id>`, `/embed/<id>`. Odrzucane: playlisty (`/playlist`, `/watch` z samym `list=`), kanały (`/@nazwa/...`, `/channel|c|user/...`), inne strony. Trwającą albo zaplanowaną transmisję odrzuca dopiero yt-dlp (filtr z punktu 4).
- **Pinterest** (`pinterest.<kraj>` z poddomeną albo bez, `pin.it`): przyjmowane `/pin/<id>` i `pin.it/<kod>`; tablice, profile i wyszukiwanie odrzucane. Dla pinów obraz w trybie „osobno” ma osobny filtr formatu (`buildVideoOnlyFormat`).
- **Inne serwisy** przechodzą bez oceny — ocenia je yt-dlp; z listy pobiera się tylko pierwsza pozycja.

Rozdzielczość ogranicza krótszy bok obrazu (`limitShorterSide`), więc pionowe filmy dostają tę samą jakość co poziome. W MP4 obraz jest w H.264 (stąd najwyżej 1080p).

## Adresy serwera

- `POST /api/download` — pobiera według formularza i zapisuje w folderze docelowym; odpowiada po zakończeniu.
- `GET /api/logs` — strumień zdarzeń (SSE) z wyjściem yt-dlp i ffmpeg oraz ostrzeżeniem o starym yt-dlp.
- `POST /api/folder/wybierz` — otwiera systemowe okno wyboru folderu; wynik `selected`, `cancelled` albo `unavailable` (wtedy strona pokazuje pole do wpisania ścieżki).
- `POST /api/folder/pokaz` — otwiera menedżer plików z zaznaczonym plikiem; tylko dla plików zapisanych przez program od ostatniego startu.

`/api/download` i `/api/folder/...` przyjmują tylko żądania z adresu pętli zwrotnej (`onlyLocalRequests`), inaczej 403.

## Tryby pobierania i panel EXPERIMENTAL

- **Tylko audio** (`audio`): yt-dlp `-x --audio-format <mp3|wav|m4a|flac>` z jakością z bitrate.
- **Film z dźwiękiem** (`video`): yt-dlp łączy najlepszy obraz z dźwiękiem (`buildVideoFormat`) w mp4/mkv; mpeg i mjpeg koduje ffmpeg. Przycisk pokazuje osobno postęp obrazu i dźwięku.
- **Osobno** (`separate`): dwa wywołania yt-dlp — sam obraz (bez ścieżki dźwiękowej, `-an`) i dźwięk w mp3.

Panel EXPERIMENTAL od strony ffmpeg (`buildAudioFilters`):
- **Bitcrush** 0–15 → filtr `acrusher` (mniej bitów, mniej próbek), z `volume` przed i po.
- **Sample rate** → `aresample=<wartość>`; przy bitcrush albo zmianie sample rate także `aformat=sample_fmts=s16`.
- **Normalizacja** → `loudnorm`, a bez wybranego sample rate dodatkowo `aresample=48000` (loudnorm podbija do 192 kHz).
- **Mono** → `-ac 1`.
- **Przycięcie** → `-ss` / `-to` przed `-i`. yt-dlp pobiera cały film, tnie dopiero ffmpeg, bo pobieranie samego wycinka cięło dźwięk niedokładnie. Obraz jest wtedy kodowany od nowa (`libx264 veryfast crf 20`, `buildTrimVideoArgs`), żeby cięcie było co do klatki.

W trybie „osobno” efekty dotyczą pliku mp3, a przycięcie obu plików.

## Anulowanie i sprzątanie

- Przycisku „Anuluj” nie ma. Zamknięcie albo odświeżenie karty zrywa połączenie `/api/download`; serwer (`res.on("close")` → `cancelJob`) zabija bieżący proces razem z potomnymi (`killProcessTree`: Windows `taskkill /T /F`, gdzie indziej SIGTERM do grupy, po 2 s SIGKILL), nie uruchamia następnych kroków i nie wysyła odpowiedzi.
- Po anulowaniu `removeJobFiles` usuwa z `downloads/` pliki z `[<jobId>]`, a `removeMovedFiles` — pliki, które to zadanie zdążyło przenieść do folderu docelowego. Innych plików w folderze użytkownika program nie usuwa.
- `cleanupOldDownloads` przy starcie i co 10 minut usuwa z `downloads/` pliki starsze niż 30 minut (wiek z daty zapisu), z pominięciem plików zadań w toku. Tak znikają też resztki po błędach.

## Testy

- `npm test` (`node --test`) — wszystkie `testy/*.test.js`. Nie pobierają z internetu i nie uruchamiają prawdziwego yt-dlp: `spawn` jest podmieniany na atrapę, pliki powstają w folderze tymczasowym, serwery testowe słuchają na losowym porcie. Część testów uruchamia prawdziwy ffmpeg na próbce z generatora; bez ffmpeg/ffprobe są pomijane. Pokrywają m.in.: argumenty yt-dlp i ffmpeg, walidację żądań i linków, czasy przycięcia, filtry audio, nazwy plików, folder docelowy i przenoszenie, okna systemowe (same argumenty), anulowanie i sprzątanie, logi, ostrzeżenie o starym yt-dlp, skrypty startowe, zgodność README z kodem, logikę strony (na atrapach DOM).
- `npm run test:przegladarka` — strona w prawdziwej przeglądarce Edge (`playwright-core`) z atrapą serwera: przyciski, postęp, pole statusu, walidacja, folder, klawiatura, czcionka, odtwarzanie.
- `node testy/przeglad/przeglad-koncowy.js` — ręczny przegląd na prawdziwych pobraniach z internetu (kilka minut). Nie jest częścią żadnego `npm test`. Uwaga: skrypt pochodzi sprzed folderu docelowego (nie wysyła pola `folder`, zakłada adres `/downloads`), więc przed użyciem trzeba go przepisać.
