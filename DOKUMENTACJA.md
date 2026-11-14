# Pobierak — dokumentacja zmian

Opis zmian wprowadzanych zadaniami z `ZADANIA.md`. Każde zadanie ma własną sekcję: co zmieniono, przyjęte założenia, co sprawdzono i co zostało niesprawdzone.

## Testy

- Uruchamianie: `npm test` w folderze programu (skrypt to `node --test`, bez składni konkretnej powłoki).
- Pliki testów leżą w `testy/` i mają nazwy `*.test.js` — tylko takie `node --test` znajduje sam w folderze o nazwie innej niż `test`.
- Testy nie pobierają niczego z internetu i nie uruchamiają yt-dlp. Tam, gdzie kod woła zewnętrzny program, test podmienia `child_process.spawn` na atrapę, która zapisuje polecenie i argumenty.
- Pliki robocze powstają w `os.tmpdir()` i są po teście usuwane. Testy nie piszą do `downloads`.
- `app.js` da się wczytać przez `require` bez startu serwera: nasłuchiwanie, pierwsze sprzątanie `downloads` i zegar sprzątania uruchamiają się tylko przy `node app.js` (`require.main === module`). Na końcu pliku jest `module.exports` z funkcjami potrzebnymi testom.

| Plik | Czego dotyczy |
|---|---|
| `testy/programy.test.js` | P1: `resolveBinary`, `buildYtDlpBaseArgs`, użycie `ytDlpBaseArgs` w trzech funkcjach pobierających, brak ścieżek wpisanych na sztywno |
| `testy/argumenty-ytdlp.test.js` | B4: `--no-playlist`, B13e: `--no-mtime` i B13a: `--newline` we wspólnych argumentach i w każdym wywołaniu yt-dlp (audio, film, oba wywołania trybu „osobno”) |
| `testy/logi.test.js` | B13a: `sendLogToClients` (zdarzenia odebrane z `/api/logs` przez prawdziwe połączenie HTTP na losowym porcie `127.0.0.1`) i `splitLogLines` ze strony |
| `testy/sprzatanie.test.js` | B8: `cleanupOldDownloads` — zwykłe sprzątanie, plik znikający przed `statSync` i między `statSync` a `unlinkSync`, inne błędy `fs`, brak folderu, żadne wywołanie `fs` poza `try` |
| `testy/czas.test.js` | B13c: `parseTimeToSeconds` z `app.js` i z `public/script.js` — poprawne zapisy, puste pole, błędne zapisy, identyczne wyniki obu funkcji (także dla wszystkich napisów do 5 znaków z wybranego zestawu), odrzucanie błędnego czasu przez `/api/download` |
| `testy/identyfikator.test.js` | B13h: `getJobId` (8 znaków szesnastkowych, różne wyniki), szablon nazwy pliku, szablon `-o` przekazany do yt-dlp przez `/api/download` w trzech trybach, nazwa pliku w odpowiedzi serwera |
| `testy/szukanie-pliku.test.js` | B3: `findGeneratedFile` — tytuły ze słowem `video`/`audio`, dokładna końcówka `<etykieta> [<id>].` i `[<id>].`, obcy identyfikator, tryb „osobno” przez `/api/download` z plikiem audio stojącym na liście przed plikiem wideo |
| `testy/format-wideo.test.js` | B13f: `buildVideoFormat` i `buildVideoOnlyFormat` — dokładne filtry dla mp4/mpeg/mjpeg z wariantem zapasowym na końcu, pierwszeństwo H.264, limit wysokości w każdym wariancie, mkv bez zmian, filtr przekazany do yt-dlp po `-f` |
| `testy/filtry-audio.test.js` | B6: `buildAudioFilters` — `aresample=48000` po `loudnorm` przy sample rate „default”, wybrana wartość bez zmian, kolejność filtrów, filtr `-af` przekazany do ffmpeg przez `processDownloadedFile`, sample rate wyniku z prawdziwego ffmpeg na próbce z generatora (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/jakosc-audio.test.js` | B5: `buildAudioQualityArgs`, opcje jakości przekazane do ffmpeg przez `processDownloadedFile` i `/api/download`, bitrate wyniku z prawdziwego ffmpeg (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/mpeg-sample-rate.test.js` | B7: `addVideoCodecArgs` — mp2 128k przy sample rate ≤ 24000, 192k w pozostałych przypadkach, inne formaty bez zmian, bitrate przekazany do ffmpeg przez `processDownloadedFile` i `/api/download`, prawdziwy ffmpeg z tymi argumentami na próbce z generatora dla każdego sample rate (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/rozszerzenie-mjpeg.test.js` | B10: `buildProcessedFileName` — `.avi` dla mjpeg (film i tryb „osobno”), pozostałe formaty i audio bez zmian, nazwa pliku przekazana do ffmpeg przez `processDownloadedFile` i adres w odpowiedzi `/api/download`, lista formatów bez `avi`, prawdziwy ffmpeg na próbce z generatora: kontener avi + kodek mjpeg (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/nazwa-wyniku.test.js` | B13g: `buildProcessedFileName` bez przedrostka, `buildTempFileName`, `processDownloadedFile` na prawdziwych plikach w folderze tymczasowym — ffmpeg pisze do `tmp-<nazwa>`, po sukcesie zostaje jeden plik pod nazwą oryginału, po błędzie plik tymczasowy znika, a oryginał zostaje; nieudana zmiana nazwy; adresy w odpowiedzi `/api/download`; prawdziwy ffmpeg na próbce z generatora (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/przycinanie.test.js` | B11: przycinanie w ffmpeg — `-ss`/`-to` przed `-i`, kodowanie obrazu (`buildTrimVideoArgs`) i dźwięku zamiast kopiowania w filmie i w trybie „osobno”, sam start i sam koniec, brak opcji wycinka w wywołaniach yt-dlp, czasy z formularza przez `/api/download`; prawdziwy ffmpeg na próbce z jedną klatką kluczową: długość, pierwsza klatka wycinka, liczba pakietów obrazu w pliku, zgranie obrazu z dźwiękiem (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/przepakowanie-osobno.test.js` | B12: wideo trybu „osobno” w mp4 — `addVideoCodecArgs` daje `-c copy -an -movflags +faststart`, pozostałe gałęzie bez zmian, `shouldProcessMedia`, całe polecenie ffmpeg z `processDownloadedFile` i przez `/api/download`, przycięcie dalej koduje; prawdziwy ffmpeg na próbce z generatora (zwykły mp4, mp4 w kawałkach, źródło z dźwiękiem, źródło mkv): obraz skopiowany bit w bit, H.264, długość, `moov` przed `mdat`, dekodowanie bez błędów, brak dźwięku (pomijane, gdy brak ffmpeg/ffprobe) |
| `testy/adresy-plikow.test.js` | B2: `buildDownloadUrl` (dokładne zakodowane adresy dla `#`, `%`, `?`, `&`, spacji, nawiasów, polskich liter; odkodowanie wraca do nazwy), `buildDownloadFiles`, odpowiedź `/api/download` w trzech trybach (`downloadUrl`, `downloadUrls`, `files`; także gdy ffmpeg zmienia rozszerzenie), brak `files` w odpowiedzi z błędem, `GET` pod adres z odpowiedzi zwraca 200 i treść pliku z `#` i `%` w nazwie, adres bez kodowania daje 404 |
| `testy/przyczyna-bledu.test.js` | G3a: `buildProcessErrorMessage` (ostatnia linia `ERROR:`, bez niej ostatnia niepusta linia, podział po `\n`, `\r\n` i `\r`, pusty stderr), `buildMissingProgramMessage`, `runProcess` na atrapie `spawn` (limit końcówki stderr, stdout niezbierany, `ENOENT` i inne błędy uruchomienia, logi dalej trafiają na stronę) i na prawdziwym procesie (Node ze skryptem, nieistniejący plik programu), odpowiedź 500 z `/api/download` w trzech trybach i przy `YTDLP_PATH` wskazującym nieistniejący plik |
| `testy/start.test.js` | G3b + G4: `HOST` (domyślnie `127.0.0.1`, wartość ze zmiennej), `startServer` (argumenty `app.listen`, prawdziwy nasłuch na `127.0.0.1`), `buildInstallHint` dla trzech systemów, `extractVersion`, `checkProgramVersion` na atrapie `spawn` i na prawdziwym procesie, `buildProgramReport`, `reportPrograms`, `buildPortInUseMessage`; prawdziwy `node app.js` jako osobny proces na wolnym porcie: wypisany adres, wersja programu, informacja o braku z podpowiedzią, serwer działa mimo braku programu, brak połączenia przez adres sieciowy komputera, zajęty port (zdanie, kod wyjścia 1, brak śladu stosu). tekst tylko na stderr nie jest wersją. Za yt-dlp podstawiony jest Node, za ffmpeg nieistniejący plik |
| `testy/przycisk.test.js` | B1: `handleDownloadSubmit`, `validateTrim` i `parseTimeToSeconds` wycięte z `public/script.js` i uruchomione na atrapach elementów strony — przy błędnym przycięciu przycisk nie zmienia stanu ani na chwilę (atrapa zapisuje każdą zmianę `disabled`, napisu i kółka ładowania), błąd trafia do logów, żądanie nie wychodzi; przy poprawnym czasie przycisk jest zablokowany na czas żądania i wraca do „Pobierz” (także po błędzie serwera i połączenia); po poprawieniu czasu drugie wysłanie działa |
| `testy/wpis-logu.test.js` | B9: `addLog` i `trimLogs` wycięte z `public/script.js` i uruchomione na atrapie dokumentu — wiersz to `p` ze `span` (tekst `[typ]`) i węzłem tekstowym (spacja + treść), znaczniki i encje w treści i w typie zostają zwykłym tekstem, `innerHTML` nie jest ustawiane ani razu, zwykłe linie mają tę samą budowę co wcześniej, limit 42 wierszy i przewijanie na dół działają jak dotąd |
| `testy/walidacja-przyciecia.test.js` | B13b: brak `videoDurationSeconds` i komunikatu o długości filmu w `public/script.js`, plik dalej jest poprawnym skryptem, `validateTrim` wycięte ze strony i uruchomione na atrapie bez tej zmiennej — poprawne ustawienia (także bardzo dalekie końce) przechodzą bez komunikatu, błędne dają dotychczasowe komunikaty, poprawka kasuje wcześniejszy błąd |
| `testy/utrata-polaczenia.test.js` | B13d: część `public/script.js` z obsługą logów backendu (od `new EventSource` do `trimLogs`) uruchomiona z atrapą `EventSource` i atrapą `addLog` — pierwszy błąd połączenia daje jeden wpis `[error]`, kolejne błędy nie dają następnych, `onopen` zeruje flagę (następna utrata znowu daje jeden wpis), `onopen` sam niczego nie wypisuje, wiadomości z backendu są wypisywane przed utratą i po ponownym połączeniu |
| `testy/pole-statusu.test.js` | U1 + U3 + U4: `#statusBox` w `index.html` (ukryte, `aria-live`, pod przyciskiem) i reguły `.status-box` w `style.css`; `clearStatus`, `showStatusError`, `showStatusSuccess` i `handleDownloadSubmit` wycięte z `public/script.js` i uruchomione na atrapie dokumentu — błąd serwera, błąd walidacji przycinania (także gdy pole już coś pokazuje), czyszczenie pola przy starcie pobierania, „Gotowe” z linkiem (tekst, `href`, `download`), dwa linki w trybie „osobno”, automatyczne pobieranie bez zmian, znaczniki HTML jako zwykły tekst, brak `innerHTML`, odpowiedź nie-JSON i JSON niebędący obiektem (komunikat z kodem HTTP), błąd samego `fetch`; reguły tła z logami w `style.css` bez zmian |
| `testy/postep-przycisku.test.js` | U2: obsługa logów backendu i `handleDownloadSubmit` wycięte z `public/script.js`, uruchomione na atrapach strony, `EventSource` i `fetch` — linia `[download] NN%` w czasie pobierania daje „Pobieram... NN%” (zaokrąglenie w dół, kilka linii w jednej wiadomości, różne odstępy), linie bez procentu i błędny zapis procentu nie zmieniają napisu, typ zaczynający się od `FFMPEG` daje „Przetwarzam...” (słowo ffmpeg w treści albo w środku typu nie), tryb „osobno”, powrót do „Pobierz” po sukcesie, błędzie serwera, zerwanym połączeniu i odpowiedzi nie-JSON, spóźnione linie po zakończeniu i linie przed pobieraniem nic nie zmieniają, błąd walidacji nie włącza postępu, drugie pobranie zaczyna od „Pobieram...”, linie dalej trafiają do tła |
| `testy/klawiatura.test.js` | D3: reguły ukrycia pól trybu i przełącznika, trzy reguły obwódki fokusu, `aria-label` pól przycinania, `for` etykiety „Przytnij” (opis w sekcji D3) |
| `testy/font.test.js` | D2: w `public/style.css` nie ma `@import` ani adresów zewnętrznych, w `style.css`, `index.html` i `script.js` nie ma `fonts.googleapis.com` ani `fonts.gstatic.com`; reguły `@font-face` dla Space Grotesk mają `font-display: swap`, wskazują istniejące pliki woff2 w `public/fonts/` (sygnatura `wOF2`, długość z nagłówka równa rozmiarowi pliku), obejmują wagi 400, 600, 700 oraz litery podstawowe i wszystkie polskie znaki; `body` dalej używa Space Grotesk; obok leży `OFL.txt`; serwer wydaje pliki fontu z typem `font/woff2` |
| `testy/pliki-projektu.test.js` | B13i + D4: `package.json` jest poprawnym JSON-em bez BOM, ma `"main": "app.js"` (plik istnieje), krótki niepusty opis, `"engines": { "node": ">=18" }`, `"license": "MIT"`, skrypt `start` uruchamia plik z pola `main`; wpis główny w `package-lock.json` ma tę samą licencję, `engines` i zależności; `LICENSE` zaczyna się od `MIT License` i `Copyright (c) 2026 agawa98`, a reszta to pełny tekst licencji MIT (porównanie ze wzorcem po zwinięciu białych znaków) |
| `testy/skrypty-startowe.test.js` | D1: treść `start.bat`, `start.command`, `start.sh` i `.gitattributes` (końce linii, `#!/bin/sh`, przejście do własnego folderu, identyfikatory winget, `pause`, jedyna różnica między `start.command` i `start.sh`, tryb `100755` w repozytorium, `sh -n`); `start.command` i `start.sh` uruchomione naprawdę przez `sh` oraz `start.bat` przez `cmd` na kopii w folderze tymczasowym, z atrapami wszystkich programów (opis w sekcji D1) |
| `testy/workflow.test.js` | G5: `.github/workflows/testy.yml` czytany jako tekst (uruchamianie przy `push` i `pull_request`, macierz trzech systemów, `fail-fast: false`, Node 20, instalacja ffmpeg przez `choco`/`brew`/`apt-get` z właściwym warunkiem, sprawdzenie `ffmpeg`/`ffprobe`, `npm ci`, `npm test`, kolejność kroków, brak yt-dlp); skrypt `test` w `package.json`; pliki testów bez folderów tymczasowych wpisanych na sztywno; `app.js` wczytany w 12 procesach naraz bez folderu `downloads` i przy istniejącym folderze |
| `testy/readme.test.js` | G2: `README.md` — wymagane sekcje, zrzut ekranu w repozytorium (PNG), odnośniki do istniejących plików i sekcji, zgodność z kodem: identyfikatory winget ze `start.bat`, komenda Homebrew ze `start.command`, zmienne środowiskowe i wartości domyślne z `app.js`, formaty, czas sprzątania `downloads`, skrypty npm; tabela „na czym sprawdzono” nie opisuje Linuksa jako sprawdzonego (opis w sekcji G2) |

Uwaga do `testy/start.test.js`: testy z prawdziwym `node app.js` uruchamiają kopię `app.js` i `public` w folderze tymczasowym (`os.tmpdir()`, moduły z `node_modules` projektu przez `NODE_PATH`). Program przy starcie sprząta swój `downloads`, więc uruchomiony z folderu projektu kasowałby tam pliki starsze niż 30 minut; kopia sprząta tylko własny, pusty folder. Po teście kopia jest usuwana.

Sprawdzenia strony w przeglądarce leżą osobno w `testy/przegladarka/` (pliki `*.przegladarka.js`) i uruchamia je `npm run test:przegladarka` (`node testy/przegladarka/uruchom.js`). Wymagają przeglądarki Edge, więc nie są częścią `npm test`. Niczego nie pobierają z internetu: żądania poza `127.0.0.1` są odcinane, a dane podstawia sam test.

| Plik | Czego dotyczy |
|---|---|
| `testy/przegladarka/logi.przegladarka.js` | B13a: linie postępu wysłane przez backend są osobnymi wierszami w tle strony (`#terminalLogs`) |
| `testy/przegladarka/czas.przegladarka.js` | B13c: `parseTimeToSeconds` na prawdziwej stronie daje to samo co backend; pola „Przytnij” pokazują błąd formatu dla błędnych zapisów |
| `testy/przegladarka/odtwarzanie.przegladarka.js` | B12: plik wideo trybu „osobno” (mp4) przepakowany przez program odtwarza się w elemencie `<video>` i daje się przewijać w przód i w tył (klatka po przewinięciu ma właściwy kolor); test kontrolny na uciętym pliku. Pomocnik: `testy/przegladarka/odtwarzanie-pomoc.js` (`playAndSeek`) |
| `testy/przegladarka/przycisk.przegladarka.js` | B1: start `2:00`, koniec `1:00`, klik „Pobierz” — przycisk zostaje aktywny z napisem „Pobierz” (licznik zmian przycisku równy 0), żądanie nie wychodzi, po poprawieniu czasu drugi klik je wysyła; przy poprawnym czasie przycisk jest zablokowany („Pobieram...”) do odpowiedzi serwera. Odpowiedź `/api/download` podstawia test |
| `testy/przegladarka/wpis-logu.przegladarka.js` | B9: `addLog("test", "<b>x</b> & <img src=x>")` na prawdziwej stronie pokazuje ten tekst dosłownie (bez elementów `<b>`/`<img>`, bez żądania po obrazek); log z backendu ze `<script>` i `onerror` nie wykonuje kodu; zwykłe linie mają te same wymiary, położenie, kolory i czcionkę co wiersz zbudowany dawnym `innerHTML` |
| `testy/przegladarka/walidacja-przyciecia.przegladarka.js` | B13b: strona wczytuje się bez błędów skryptu i nie ma zmiennej `videoDurationSeconds`; pola „Przytnij” pokazują te same komunikaty co wcześniej, także dla bardzo dalekiego końca; klik „Pobierz” z błędnym czasem nie wysyła żądania, z poprawnym wysyła. Odpowiedź `/api/download` podstawia test |
| `testy/przegladarka/utrata-polaczenia.przegladarka.js` | B13d: zatrzymanie prawdziwego serwera — po co najmniej trzech ponowionych próbach połączenia w tle strony jest jedna linia „Utracono połączenie z logami backendu.”; po starcie serwera na tym samym porcie logi wracają (drugie powitanie i linia wysłana przez backend); druga utrata daje dokładnie jedną nową linię. Trwa ok. 20 s |
| `testy/przegladarka/pole-statusu.przegladarka.js` | U1 + U3 + U4: pole na starcie ukryte; zły link → błąd pod przyciskiem z czerwoną obwódką, w karcie; udane pobranie → „Gotowe” z linkiem, który zwraca plik i po kliknięciu go pobiera (nazwa z `#` i `%`); tryb „osobno” → dwa linki jeden pod drugim; długa nazwa łamie się i nie rozpycha karty; znaczniki z serwera pokazane dosłownie; błąd walidacji przycinania w polu; odpowiedź nie-JSON → komunikat z kodem HTTP; brak odpowiedzi → „Nie udało się połączyć z backendem.”; tło z logami ma to samo położenie i styl. Odpowiedzi `/api/download` i pliki z `/downloads` podstawia test |
| `testy/przegladarka/postep-przycisku.przegladarka.js` | U2: linie wysłane przez prawdziwy serwer programu (`sendLogToClients` → `/api/logs`) przy wiszącym `/api/download` — napis przycisku przechodzi „Pobieram...” → „Pobieram... 0%” → „45%” → „100%” → „Przetwarzam...” → „Pobierz”; linia przed pobieraniem i spóźnione linie po nim nic nie zmieniają; drugie pobranie zaczyna od „Pobieram...”; logi bez procentu zostawiają „Pobieram...”; po błędzie 500 napis wraca do „Pobierz” |
| `testy/przegladarka/klawiatura.przegladarka.js` | D3: obsługa samą klawiaturą, widoczny fokus, wygląd bez fokusu bez zmian (opis w sekcji D3) |
| `testy/przeglad/przeglad-koncowy.js` | K1 (i K2): pełny przegląd na prawdziwych pobraniach — osobny skrypt, uruchamiany ręcznie `node testy/przeglad/przeglad-koncowy.js`, poza `npm test` i `npm run test:przegladarka`, bo pobiera film z YouTube (opis w sekcji K1) |
| `testy/przegladarka/font.przegladarka.js` | D2: strona nie wysyła żadnego żądania poza własny serwer (w tym do `fonts.googleapis.com` i `fonts.gstatic.com`); oba pliki fontu przychodzą z `/fonts/` z kodem 200; nagłówek, etykiety z polskimi znakami i próbka ze wszystkimi polskimi literami w wagach 400, 600, 700 są naprawdę rysowane fontem z pliku strony (protokół DevTools); wagi różnią się szerokością; zrzut ekranu do `logi-petli\zrzuty\` |

## P1: Instalacja zależności i szukanie programów (G1)

### Co zmieniono (`app.js`)

- Usunięte stałe `isWindows` i `binDir` oraz ścieżka `/usr/bin`.
- Nowa funkcja `resolveBinary(envName, baseName)`. Szuka programu po kolei:
  1. zmienna środowiskowa (`YTDLP_PATH`, `FFMPEG_PATH`) — jeśli jest ustawiona i niepusta, jej wartość jest używana bez sprawdzania, czy plik istnieje;
  2. plik w folderze `bin` obok `app.js`: `yt-dlp.exe` / `ffmpeg.exe` na Windowsie, `yt-dlp` / `ffmpeg` na macOS i Linuksie — tylko gdy plik istnieje;
  3. sama nazwa programu (system szuka go w PATH).

  Zwraca obiekt `{ command, fromPath }`: `command` to ścieżka albo nazwa do uruchomienia, `fromPath` mówi, czy program pochodzi z PATH.
- `ytDlpPath` i `ffmpegPath` są teraz wynikiem `resolveBinary` (pole `command`).
- Nowa stała `ytDlpBaseArgs` — wspólne argumenty każdego wywołania yt-dlp, budowana funkcją `buildYtDlpBaseArgs`. Na razie zawiera tylko `--ffmpeg-location <ścieżka do ffmpeg>`, i tylko wtedy, gdy ffmpeg pochodzi ze zmiennej środowiskowej albo z folderu `bin`. Gdy ffmpeg jest z PATH, tablica jest pusta. Używają jej `downloadAudio`, `downloadVideo` i oba wywołania w `downloadSeparate`.
- Start serwera, pierwsze sprzątanie i zegar sprzątania są w bloku `if (require.main === module)`; dodany `module.exports` (potrzebne testom, działanie `node app.js` bez zmian).
- `package.json`: dodany skrypt `"test": "node --test"`.
- `npm install` uruchomione — 0 podatności, bez zmian w `package-lock.json`.

### Przyjęte założenia

- `resolveBinary` zwraca obiekt, nie sam napis, bo `ytDlpBaseArgs` musi wiedzieć, czy ffmpeg pochodzi z PATH.
- Funkcja ma trzeci, opcjonalny parametr `options` (`env`, `binDir`, `platform`). Program go nie używa; służy testom, żeby sprawdzić zachowanie dla Windowsa, macOS i Linuksa na jednym komputerze.
- Do `--ffmpeg-location` trafia ścieżka do pliku ffmpeg, a nie folder (wcześniej był folder `bin`). yt-dlp przyjmuje obie postaci.
- Zmienna środowiskowa nie jest sprawdzana pod kątem istnienia pliku: jeśli ktoś ją ustawił, a pliku nie ma, przy pobieraniu pojawi się błąd uruchomienia programu (czytelny komunikat to zadanie G3a), zamiast cichego przejścia na inny program.
- Pusta zmienna (albo same spacje) liczy się jak nieustawiona.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 24 testy, wszystkie przechodzą.
- Bez folderu `bin`, yt-dlp i ffmpeg z PATH: `node app.js` startuje; `POST /api/download` (audio mp3, `https://www.youtube.com/shorts/jBoKCUKJkiY`) zwraca `success: true`; `ffprobe` pokazuje plik mp3, 33,15 s. W argumentach yt-dlp nie ma `--ffmpeg-location`.
- Start z `FFMPEG_PATH` i `YTDLP_PATH` ustawionymi na pełne ścieżki plików `ffmpeg.exe` i `yt-dlp.exe`: film mp4 360p pobrany poprawnie (`ffprobe`: h264 + aac, 33,2 s). yt-dlp dostał `--ffmpeg-location <plik ffmpeg.exe>` i połączył obraz z dźwiękiem, więc ścieżka do pliku (zamiast folderu) w tej fladze działa.
- Recenzja testów przez agenta `recenzent-testow`: trzy rundy, w trzeciej testy zaakceptowane bez poważnych uwag. Po pierwszej dopisane zostały testy folderu `bin` obok `app.js` (udawanego przez podmianę `fs.existsSync`) i asercje `ffmpegPath` / `ytDlpPath`. Po drugiej testy zmieniają katalog roboczy na `os.tmpdir()` na czas wczytania `app.js`, żeby odróżnić `bin` obok `app.js` od `bin` w bieżącym katalogu. W trzeciej recenzent zepsuł kod na kopii na 14 sposobów i testy wykryły wszystkie 14. Drobne uwagi zostały bez poprawek (zasada 2a): test zakazanych ścieżek szuka tylko czterech napisów; gdyby serwer startował przy `require`, `npm test` wykrywa błąd, ale sam się nie kończy.
- Powtórka w drugim wywołaniu pętli (2026-11-14): `npm test` 24/24; start bez folderu `bin` i pobranie mp3 128 udane (`ffprobe`: mp3, 33,15 s).

### Niesprawdzone

- **macOS — sprawdzenie nie zostało wykonane.** `ssh spliffzilla@mac` zwraca „Could not resolve hostname mac” (dwie próby, druga w kolejnym wywołaniu pętli); Tailscale na tym komputerze jest wylogowany (`tailscale status`: „You are logged out”), a zalogować może tylko właściciel. Do zrobienia po przywróceniu połączenia: skopiować kod na Maca, `npm install`, `node app.js`, pobrać przez `POST /api/download` audio mp3 i film mp4, zmierzyć `ffprobe`. Do tego czasu działanie na macOS (w tym łączenie obrazu z dźwiękiem w mp4) wynika tylko z testów `resolveBinary` dla `platform: "darwin"` uruchomionych na Windowsie.
- Linux: nic nie było uruchamiane (brak maszyny).
- Prawdziwy folder `bin` z programami nie był tworzony na dysku; ten układ sprawdzają tylko testy automatyczne.

## B4: `--no-playlist`

### Co zmieniono (`app.js`)

- `buildYtDlpBaseArgs` dopisuje na końcu `--no-playlist`, więc flaga jest w stałej `ytDlpBaseArgs` i trafia do każdego wywołania yt-dlp: `downloadAudio`, `downloadVideo` i oba wywołania w `downloadSeparate`. Link skopiowany podczas słuchania playlisty (`watch?v=...&list=...`) pobiera teraz tylko wskazany film.
- `ytDlpBaseArgs` wygląda teraz tak: `["--no-playlist"]`, gdy ffmpeg jest z PATH, albo `["--ffmpeg-location", <ścieżka>, "--no-playlist"]`.

### Przyjęte założenia

- Adres nie jest zmieniany (parametr `list=` zostaje w adresie); o pominięciu playlisty decyduje sama flaga yt-dlp.
- Link do samej playlisty, bez filmu (`playlist?list=...`), dalej pobiera całą playlistę — `--no-playlist` działa tylko wtedy, gdy adres wskazuje film. Zadanie tego nie obejmuje.

### Zmiana w istniejących testach (zgłoszenie)

W `testy/programy.test.js` (testy P1) zmienione zostały oczekiwane wartości w sześciu asercjach `ytDlpBaseArgs` / `buildYtDlpBaseArgs`: doszedł element `"--no-playlist"` (np. `[]` → `["--no-playlist"]`). Wynika to wprost z treści zadania: P1 sprawdzało dokładną zawartość tablicy, a B4 ją rozszerza. Żaden test nie został usunięty ani poluzowany; porównania dalej są dokładne (`deepEqual`). Dopisany jeden wiersz komentarza na górze pliku.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 36 testów (24 z P1 + 12 nowych), wszystkie przechodzą.
- Link testowy: `https://www.youtube.com/watch?v=jBoKCUKJkiY&list=UUcBFxaNrM1cOZ_VQez2auGQ` (film podany przez właściciela + publiczna playlista „wszystkie filmy” tego samego kanału).
- Sam yt-dlp, bez pobierania (`--flat-playlist --print id`): bez flagi ten adres daje około 100 pozycji playlisty, z `--no-playlist` jedną (`jBoKCUKJkiY`).
- Serwer (`node app.js`, port 3417), `POST /api/download` z tym adresem, przy pustym folderze `downloads`:
  - audio mp3 128 → `success: true`, w `downloads` przybył jeden plik (mp3, 33,15 s);
  - film mp4 360p → `success: true`, przybył jeden plik (mp4, 33,20 s);
  - „osobno” mp4 360p → `success: true`, przybyły dwa pliki: wideo (mp4, 33,13 s) i audio (mp3, 33,15 s) — tyle, ile ten tryb ma dawać.
  - W logu serwera każde z czterech wywołań yt-dlp ma `--no-playlist` i linię `Downloading just the video jBoKCUKJkiY because of --no-playlist`; nie ma żadnej linii `Downloading item`.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, testy zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 11 sposobów (m.in. brak flagi, `--yes-playlist`, literówka, flaga wstawiona w miejsce wartości innej opcji, flaga wycięta z jednego wywołania) i testy wykryły wszystkie 11; dwa z nich łapie tylko nowy plik. Zmianę oczekiwanych wartości w testach P1 uznał za wynikającą z zadania i nieosłabiającą testów. Drobne uwagi zostały bez poprawek (zasada 2a): trzeci test na tryb jest słabszy od pozostałych, dwa porównania w nowym pliku liczą wystąpienia zamiast porównywać całą tablicę (dokładne porównanie jest w testach P1), `loadApp` jest skopiowane z `programy.test.js` — przy kolejnych flagach (B13e, B13a) warto je wynieść do wspólnego pliku.

### Niesprawdzone

- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.
- Strona w przeglądarce nie była używana — pobrania szły przez `POST /api/download` (curl).

## B13e: `--no-mtime`

### Co zmieniono (`app.js`)

- `buildYtDlpBaseArgs` dopisuje `--no-mtime` po `--no-playlist`, więc flaga jest w stałej `ytDlpBaseArgs` i trafia do każdego wywołania yt-dlp (`downloadAudio`, `downloadVideo`, oba wywołania w `downloadSeparate`). Pobrany plik dostaje datę modyfikacji z chwili pobrania, a nie datę wrzucenia filmu. Ma to znaczenie dla sprzątania `downloads`, które usuwa pliki starsze niż 30 minut według daty modyfikacji.
- `ytDlpBaseArgs` wygląda teraz tak: `["--no-playlist", "--no-mtime"]`, gdy ffmpeg jest z PATH, albo `["--ffmpeg-location", <ścieżka>, "--no-playlist", "--no-mtime"]`.

### Przyjęte założenia

- Flaga jest dodawana zawsze, także dla wersji yt-dlp, w których `--no-mtime` jest już ustawieniem domyślnym (tak jest w zainstalowanej tu wersji 2026.03.17). Jawna flaga uniezależnia program od wersji yt-dlp i od pliku konfiguracyjnego yt-dlp użytkownika.

### Zmiana w istniejących testach (zgłoszenie)

Testy P1 i B4 porównują dokładną zawartość `ytDlpBaseArgs`, a B13e ją rozszerza, więc oczekiwane wartości musiały dostać element `"--no-mtime"`:

- `testy/programy.test.js`: sześć oczekiwanych tablic (np. `["--no-playlist"]` → `["--no-playlist", "--no-mtime"]`) i jeden wiersz komentarza na górze pliku.
- `testy/argumenty-ytdlp.test.js` (testy B4): dwie oczekiwane tablice oraz `args.length` 3 → 4; zmieniony komentarz na górze pliku.

Żaden test nie został usunięty ani poluzowany; porównania dalej są dokładne (`deepEqual`).

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 45 testów (36 wcześniejszych + 9 nowych z przedrostkiem „B13e:”), wszystkie przechodzą.
- Serwer (`node app.js`, port 3418), `POST /api/download` dla `https://www.youtube.com/shorts/jBoKCUKJkiY`, przy pustym folderze `downloads`: audio mp3 128, film mp4 360p i „osobno” mp4 360p — wszystkie `success: true`. Wszystkie cztery pliki mają datę modyfikacji z przedziału między wysłaniem pierwszego żądania a odpowiedzią na ostatnie (15 sekund). W logu serwera każde z czterech wywołań yt-dlp ma `--no-mtime`.
- Sam yt-dlp, dla porównania (pliki w folderze tymczasowym, potem usunięte): z `--mtime` plik dostał datę 2026-11-09 06:01 (pięć dni wstecz), z `--no-mtime` datę z chwili pobrania. Flaga robi więc to, czego wymaga zadanie.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, testy zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 15 sposobów (m.in. brak flagi, `--mtime`, literówka, flaga podwójna, flaga w miejscu wartości innej opcji, flaga wycięta z jednego wywołania) i testy wykryły wszystkie 15; pięć z nich łapią tylko nowe testy. Zmianę oczekiwanych wartości w starych testach uznał za wynikającą z zadania i nieosłabiającą testów. Drobne uwagi zostały bez poprawek (zasada 2a): trzy pierwsze testy B13e powtarzają dokładne porównania z `programy.test.js`; dwa testy z „B4” w nazwie sprawdzają teraz także `--no-mtime`.

### Niesprawdzone

- Różnicy „przed zmianą / po zmianie” w samym programie nie da się tu pokazać: zainstalowany yt-dlp 2026.03.17 ma `--no-mtime` domyślnie, więc bez flagi pliki też dostawały bieżącą datę. Działanie na starszych wersjach yt-dlp (gdzie domyślne było `--mtime`) nie było uruchamiane; wynika z porównania `--mtime` / `--no-mtime` powyżej.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.
- Strona w przeglądarce nie była używana — pobrania szły przez `POST /api/download` (curl).

## B13a: Postęp w osobnych liniach

### Co zmieniono

- `app.js`, `buildYtDlpBaseArgs`: dopisuje `--newline` po `--no-mtime`, więc flaga jest w `ytDlpBaseArgs` i trafia do każdego wywołania yt-dlp. yt-dlp wypisuje wtedy każdą aktualizację postępu jako osobną linię, zamiast nadpisywać jedną linię znakiem `\r`. `ytDlpBaseArgs` to teraz `["--no-playlist", "--no-mtime", "--newline"]` (z `--ffmpeg-location <ścieżka>` na początku, gdy ffmpeg nie jest z PATH).
- `app.js`, `sendLogToClients`: usunięta ręczna zamiana `\n` na tekst `\n`. Wysyłane jest `JSON.stringify({ type, message: String(message) })`; JSON sam zapisuje znaki końca linii tak, że zdarzenie mieści się w jednej linii `data:`.
- `app.js`, `module.exports`: doszły `app` i `sendLogToClients` (potrzebne testom; działanie `node app.js` bez zmian).
- `public/script.js`: nowa funkcja `splitLogLines(message)`, która dzieli wiadomość wyrażeniem `/\r\n|\n|\r/`, obcina spacje na brzegach i odrzuca puste linie. `backendLogs.onmessage` używa jej zamiast podziału po tekście `"\n"`.
- `package.json`: nowy skrypt `test:przegladarka` (`node testy/przegladarka/uruchom.js`).
- Wygląd i działanie tła z logami (`#terminalLogs`) bez zmian — zmienia się tylko to, jak tekst jest dzielony na wiersze.

### Przyjęte założenia

- Podział wydzielony do osobnej funkcji `splitLogLines` (zadanie mówi tylko o zmianie wyrażenia), żeby dało się go przetestować bez przeglądarki. Test wycina tę funkcję z `public/script.js` i uruchamia ją w Node.
- Podział po samym `\r` obejmuje też postęp ffmpeg (`size=... time=...`), który dotąd bywał sklejany w jeden wiersz.
- Linia przecięta między dwiema porcjami wyjścia programu (połowa w jednej, połowa w drugiej) dalej daje dwa wiersze. Zadanie nie wymaga sklejania; w sprawdzeniu ręcznym taki przypadek nie wystąpił.

### Zmiana w istniejących testach (zgłoszenie)

Testy P1, B4 i B13e porównują dokładną zawartość `ytDlpBaseArgs`, a B13a ją rozszerza:

- `testy/programy.test.js`: sześć oczekiwanych tablic dostało `"--newline"`; jeden wiersz komentarza na górze.
- `testy/argumenty-ytdlp.test.js` (testy B4 i B13e): sześć oczekiwanych tablic dostało `"--newline"`, `args.length` 4 → 5; zmieniony komentarz na górze.

Żaden test nie został usunięty ani poluzowany; porównania dalej są dokładne (`deepEqual`).

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 67 testów (45 wcześniejszych + 22 nowe z przedrostkiem „B13a:”), wszystkie przechodzą.
- `npm run test:przegladarka` (Edge bez okna): 1 test, przechodzi. Strona otwarta z serwera na `127.0.0.1`, backend wysyła porcję z trzema liniami `[download] NN%` oraz porcję z `\r` i `\r\n`; w `#terminalLogs` jest sześć osobnych wierszy.
- Prawdziwe pobranie z otwartą stroną (jednorazowy skrypt z `playwright-core`, serwer `node app.js` na porcie 3419, film `https://www.youtube.com/shorts/jBoKCUKJkiY`, yt-dlp 2026.03.17): film mp4 „best” oraz audio mp3 128 z normalizacją, oba `success: true`. W tle strony przybyło 114 wierszy, z czego 61 to linie `[download] NN%`; żaden wiersz nie zawiera więcej niż jednej linii postępu, żaden nie zawiera tekstu `\n` ani znaku końca linii. Linie postępu ffmpeg też są osobnymi wierszami. Po sprawdzeniu serwer zatrzymany, oba pobrane pliki usunięte z `downloads`.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, testy zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 18 sposobów; `npm test` wykrył 15. Z trzech niewykrytych dwa nie zmieniają niczego dla użytkownika (podział bez `\r\n` daje ten sam wynik, bo puste linie są odrzucane; brak `String(...)` w `splitLogLines`), a trzeci (`onmessage` wypisuje całą wiadomość zamiast linii) wykrywa test w przeglądarce. Drobne uwagi zostały bez poprawek (zasada 2a): `npm test` sprawdza użycie `splitLogLines` w `onmessage` tylko po tekście źródła; dwa pierwsze testy `--newline` powtarzają porównania z innych plików; test czekający na zdarzenie pada dopiero po 5 s.

### Niesprawdzone

- Wygląd tła „na oko” — sprawdzana była treść wierszy, nie zrzut ekranu.
- Pobranie nie było wysyłane przyciskiem „Pobierz” na stronie, tylko przez `POST /api/download` przy otwartej stronie (wiersze tła pochodzą z prawdziwego połączenia strony z `/api/logs`).
- Tryb „osobno” w prawdziwym pobraniu (flaga w obu jego wywołaniach jest sprawdzona testem automatycznym).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane. Test w przeglądarce wymaga Edge.

## B8: Sprzątanie odporne na znikające pliki

### Co zmieniono (`app.js`)

- `cleanupOldDownloads`: `readdirSync` jest w `try/catch`; gdy się nie uda, w konsoli pojawia się „Nie udalo sie odczytac folderu pobierania: <komunikat>” i funkcja kończy to jedno sprzątanie.
- Cały krok dla jednego pliku (`statSync`, sprawdzenie wieku, `unlinkSync`) jest w jednym `try/catch`. Plik, który zniknął (błąd `ENOENT`), jest pomijany z wpisem „Pominieto plik, ktory zniknal w trakcie sprzatania: <nazwa>”. Każdy inny błąd daje wpis „Nie udalo sie usunac starego pliku: <nazwa> <komunikat>”. W obu przypadkach sprzątanie idzie dalej do następnych plików.
- Żadne wywołanie `fs` w tej funkcji nie stoi poza `try`.
- `cleanupOldDownloads(dir = downloadsDir)`: funkcja przyjmuje opcjonalny folder. Program woła ją bez argumentu, więc dalej sprząta `downloads`.
- `module.exports`: doszły `cleanupOldDownloads` i `fileMaxAgeMinutes` (potrzebne testom).

### Przyjęte założenia

- Opcjonalny parametr folderu dodany po to, żeby testy sprzątały folder w `os.tmpdir()`, a nie `downloads` programu. Zadanie go nie wymienia.
- Zadanie mówi o pliku, który zniknął; `try/catch` łapie też pozostałe błędy kroku (np. plik zajęty, brak dostępu), z osobnym wpisem. Wpis przy nieudanym usunięciu ma teraz także nazwę pliku (wcześniej sam komunikat błędu).
- Limit 30 minut i odstęp 10 minut bez zmian.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 77 testów (67 wcześniejszych + 10 nowych z przedrostkiem „B8:”), wszystkie przechodzą. Istniejące testy nie były zmieniane.
- Kod przeczytany: trzy wywołania `fs` w funkcji (`readdirSync`, `statSync`, `unlinkSync`), wszystkie wewnątrz `try`; to samo sprawdza test automatyczny.
- Start serwera z plikami w `downloads`: `node app.js` na porcie 3427 przy pliku sprzed 45 minut, pliku świeżym i podfolderze. Konsola: „Usunieto stary plik: b8-stary.txt”, potem „slucham na porcie 3427”; strona odpowiada 200; świeży plik i podfolder zostały. Po sprawdzeniu serwer zatrzymany, pliki próbne usunięte.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 12 sposobów; testy wykryły 11. Niewykryty: limit liczony jako 29 zamiast 30 minut (najbliższe progu pliki w teście mają 28 i 60 minut) — tego przeliczenia B8 nie zmienia. Drobne uwagi zostały bez poprawek (zasada 2a): ten margines progu, wrażliwość testu czytającego kod na formatowanie funkcji, błąd `readdirSync` sprawdzony tylko dla nieistniejącego folderu.

### Niesprawdzone

- Prawdziwy wyścig z działającym yt-dlp (plik znikający podczas pobierania) — okno jest zbyt wąskie, żeby je wywołać; znikanie pliku odtwarzają testy przez podmianę funkcji `fs`.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B13c: Wspólna walidacja czasu

### Co zmieniono

- `app.js`, `parseTimeToSeconds`: po sprawdzeniu pustego napisu funkcja zwraca `NaN` dla wszystkiego, co nie pasuje do `^\d+(:\d+){0,2}$` (same cyfry, najwyżej dwa dwukropki). Limit 59 dla minut i sekund w `MM:SS` i `GG:MM:SS` był tu już wcześniej i został.
- `public/script.js`, `parseTimeToSeconds`: to samo wyrażenie oraz dodany limit 59 dla minut i sekund w `MM:SS` i `GG:MM:SS` (wcześniej strona przyjmowała np. `1:75`).
- `app.js`, `module.exports`: doszło `parseTimeToSeconds` (potrzebne testom).
- Wyniki po obu stronach: `90` → 90, `1:30` → 90, `1:02:03` → 3723, puste pole → `null`; `1:75`, `1::2`, `0x10`, `1e3`, `-5`, `1.5` → `NaN`.

### Przyjęte założenia

- Sam zapis sekund (bez dwukropka) nie ma limitu 59, np. `90` i `3600` są poprawne — zadanie wymienia limit tylko dla `MM:SS` i `GG:MM:SS`. Pierwsza część zapisu też nie ma limitu (`90:00` → 5400).
- Spacje i inne białe znaki na początku i końcu są obcinane jak dotąd; w środku zapisu dają `NaN`.
- W `app.js` zostało wcześniejsze sprawdzenie liczb ujemnych, choć po dodaniu wyrażenia nigdy się nie uruchomi (zmiana punktowa, bez usuwania kodu autora).
- Komunikaty błędów na stronie i w odpowiedzi serwera bez zmian.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 87 testów (77 wcześniejszych + 10 nowych z przedrostkiem „B13c:”), wszystkie przechodzą. Istniejące testy nie były zmieniane.
- Przykłady z linii „Sprawdzenie” po obu stronach: w `npm test` (funkcja ze strony wycięta z `public/script.js` i uruchomiona bez przeglądarki) oraz na prawdziwej stronie w Edge.
- Obie funkcje dają ten sam wynik dla wszystkich 177 155 napisów o długości 1–5 ze znaków `0 1 5 6 9 : . - e x` i spacji; wynik jest też porównany z regułą z zadania policzoną osobno w teście.
- `POST /api/download` z błędnym czasem (`1:75`, `1::2`, `0x10`, `1e3`, `-5`, `1.5`, `1:60:00`, `1:2:3:4`, jako początek i jako koniec) zwraca 400 „Nieprawidłowy format czasu przycinania.”. Początek `1:30` i koniec `90` zwraca 400 „Początek przycinania musi być mniejszy niż koniec.” (oba zapisy to ten sam czas).
- `npm run test:przegladarka` (Edge bez okna): 3 testy (1 wcześniejszy + 2 nowe), wszystkie przechodzą. Pola „Przytnij” pokazują „Użyj formatu GG:MM:SS” dla sześciu błędnych zapisów z zadania i nic dla poprawnych.
- Testy wykryły błąd w trakcie pracy: pierwsza wersja zmiany miała wyrażenie bez ukośników (`^d+` zamiast `^\d+`); padło 5 testów, po poprawce przechodzą.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 14 sposobów; `npm test` wykrył 12. Dwa niewykryte: `{0,3}` zamiast `{0,2}` nie zmienia żadnego wyniku (cztery części i tak dają `NaN`); flaga `m` w wyrażeniu zmienia wynik tylko dla napisu ze znakiem nowej linii w środku, którego w polu na stronie nie da się wpisać.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): test endpointu nie podmienia `spawn`, więc gdyby walidacja czasu przestała działać, test padłby, ale serwer zdążyłby uruchomić yt-dlp na zmyślonym adresie `http://127.0.0.1:9/nie-istnieje`; na listach nie ma zapisu ze znakiem nowej linii w środku; test w przeglądarce nie ma zapisu `1:60`; wycinanie funkcji ze `script.js` zależy od jej formatowania.

### Niesprawdzone

- Prawdziwe pobranie z przycięciem — zadanie zmienia tylko rozpoznawanie zapisu czasu, nic nie było pobierane.
- Wysłanie formularza przyciskiem „Pobierz” z błędnym czasem (to zakres zadania B1).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane. Test w przeglądarce wymaga Edge.

### Uwaga dla właściciela (poza zakresem zadania)

- Bardzo długi ciąg cyfr (ponad 300) daje po obu stronach `Infinity`, a serwer przyjmuje go jako czas przycięcia. Zgłosił to recenzent; zadanie tego nie reguluje, więc kod zostaje bez zmian.

## B13h: Dłuższy identyfikator zadania

### Co zmieniono

- `app.js`, `getJobId`: `randomUUID().slice(0, 8)` zamiast `slice(0, 4)`. Identyfikator to 8 małych znaków szesnastkowych (początek UUID, bez myślnika). Nazwa pobranego pliku ma postać `<tytuł> [<8 znaków>].<rozszerzenie>`, w trybie „osobno” `<tytuł> video [<8 znaków>]...` i `<tytuł> audio [<8 znaków>]...`.
- `app.js`, `module.exports`: doszły `getJobId`, `findGeneratedFile`, `buildOutputTemplate`, `downloadsDir` (potrzebne testom).

### Przyjęte założenia

- Zmienia się tylko długość identyfikatora. Sposób szukania pliku po identyfikatorze (`findGeneratedFile`) zostaje bez zmian — to zakres zadania B3.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 94 testy (87 wcześniejszych + 7 nowych z przedrostkiem „B13h:”), wszystkie przechodzą. Istniejące testy nie były zmieniane.
- Prawdziwe pobranie przez `POST /api/download` (audio mp3, film testowy): plik `the #1 NO SCOPE player in rivals [7994579d].mp3`, `ffprobe` pokazuje mp3 i 33,15 s. Plik próbny został potem usunięty, serwer zatrzymany.
- Po cofnięciu zmiany do `slice(0, 4)` pada 6 z 7 nowych testów.
- Recenzja testów przez agenta `recenzent-testow`: dwie rundy. W pierwszej jedna poważna uwaga: ostatni test tworzył pusty plik w prawdziwym folderze `downloads`. Poprawione: test niczego nie zapisuje, lista plików folderu `downloads` jest podstawiana (`t.mock.method` na `fs.readdirSync`). W drugiej rundzie testy zaakceptowane. Recenzent zepsuł kod na kopii na 13 sposobów w pierwszej rundzie i 6 w drugiej; testy wykryły wszystkie.
- Drobne uwagi recenzenta: próg w teście różności poluzowany do `>= 1999` na 2000 losowań (jedna powtórka przy dobrym kodzie zdarza się mniej więcej raz na 2000 uruchomień); bez poprawki zostało to, że nazwa pliku w odpowiedzi serwera jest sprawdzana tylko dla audio (film i „osobno” mają sprawdzony szablon `-o`).

### Niesprawdzone

- Prawdziwe pobranie filmu i trybu „osobno” — nazwa pliku powstaje w tym samym miejscu kodu co dla audio; sprawdza to tylko test szablonu `-o`.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B3: Dokładne szukanie pliku w trybie „osobno”

### Co zmieniono (`app.js`)

- `findGeneratedFile(jobId, extraText)`: plik jest rozpoznawany po jednym, dokładnym fragmencie nazwy. Z etykietą to `<etykieta> [<jobId>].` (np. `video [ab12cd34].`), bez etykiety `[<jobId>].`. Wcześniej funkcja szukała osobno `[<jobId>]` i etykiety gdziekolwiek w nazwie, więc dla tytułu „my video essay” etykieta `video` pasowała także do pliku audio, a ten stoi na liście pierwszy.
- Wywołania w `downloadSeparate` (`findGeneratedFile(jobId, "video")` i `findGeneratedFile(jobId, "audio")`) zostały bez zmian — po poprawce funkcji działają poprawnie.

### Przyjęte założenia

- „Dokładna końcówka nazwy” to fragment `<etykieta> [<jobId>].`, po którym stoi już tylko rozszerzenie. Kod sprawdza obecność tego fragmentu w nazwie (`includes`), nie pozycję na samym końcu, bo rozszerzenie jest dowolne. Identyfikator jest losowy i ma 8 znaków, więc taki fragment nie trafi się w tytule.
- Przed etykietą nie jest wymagana spacja (zadanie podaje fragment bez niej). Nazwy tworzy `buildOutputTemplate`, zawsze w postaci `<tytuł> <etykieta> [<id>].<rozszerzenie>`.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 113 testów (94 wcześniejsze + 19 nowych z przedrostkiem „B3:”), wszystkie przechodzą. Istniejące testy nie były zmieniane.
- Na kodzie sprzed zmiany pada 15 z 19 nowych testów.
- Prawdziwe pobranie przez `POST /api/download` w trybie „osobno”, 360p, raz jako mkv i raz jako mp4. Film testowy nie ma słowa `video` w tytule, więc na czas sprawdzenia serwer został uruchomiony z folderu tymczasowego, w którym leżał plik `yt-dlp.conf` z opcją `--replace-in-metadata title "^" "my video essay "` (yt-dlp czyta taki plik z bieżącego folderu). Tytuł dostał przez to przedrostek „my video essay ”. Kod programu i jego ustawienia nie były do tego zmieniane. Wynik w obu przypadkach: pierwszy adres wskazuje plik `... video [<id>].mkv`/`.mp4` (`ffprobe`: sam obraz H.264, 33,13 s), drugi plik `... audio [<id>].mp3` (`ffprobe`: sam dźwięk mp3, 33,15 s). Pliki próbne i folder tymczasowy zostały usunięte, serwer zatrzymany.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 18 sposobów; testy wykryły 13. Cztery niewykryte (etykieta bez pierwszej litery, `findLast` zamiast `find`, wymagana spacja przed etykietą, wymagana spacja przed `[`) nie zmieniają wyniku dla nazw, które program tworzy. Piąte dotyczy kodu, którego zadanie nie ruszało: usunięcie warunku `!videoFile` w `downloadSeparate`.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): nie ma testu trybu „osobno”, w którym jednego z dwóch plików brakuje; nie ma nazwy z etykietą sklejoną z poprzednim słowem (`filmvideo [id].mp4` — obecny kod ją dopasuje, program takiej nazwy nie tworzy).

### Niesprawdzone

- Film, który ma słowo `video` w prawdziwym tytule z YouTube — tytuł był podmieniony opcją yt-dlp, jak opisano wyżej.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B13f: Zapasowy wybór formatu

### Co zmieniono (`app.js`)

- `buildVideoFormat` (film z dźwiękiem), formaty mp4/mpeg/mjpeg: na końcu filtra doszedł wariant bez wymogu kodeka. Dla „best”: `.../b[ext=mp4]/bv*+ba/b`. Dla wybranej rozdzielczości R: `.../b[ext=mp4][height<=R]/bv*[height<=R]+ba/b[height<=R]`.
- `buildVideoOnlyFormat` (tryb „osobno”), te same formaty: na końcu `/bv*`, a dla rozdzielczości `/bv*[height<=R]`.
- yt-dlp próbuje wariantów po `/` od lewej, więc H.264 z AAC dalej ma pierwszeństwo. Wariant zapasowy działa dopiero wtedy, gdy film nie ma H.264 w danej rozdzielczości — wcześniej kończyło się to błędem „Requested format is not available”.
- Filtry dla mkv bez zmian (nie miały wymogu kodeka).
- `module.exports`: doszły `buildVideoFormat` i `buildVideoOnlyFormat` (potrzebne testom).

### Przyjęte założenia

- Wariant zapasowy dla filmu z rozdzielczością ma limit wysokości w obu częściach (`bv*[height<=R]+ba` i `b[height<=R]`), tak jak istniejący filtr mkv.
- Zadanie dotyczy tylko wyboru formatu. Plik z wariantu zapasowego (np. AV1 albo VP9 z Opusem) trafia do kontenera mp4 przez `--merge-output-format mp4` bez przekodowania, więc taki plik mp4 nie będzie miał H.264. Dalsza obróbka w ffmpeg nie była zmieniana.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 161 testów (113 wcześniejszych + 48 nowych z przedrostkiem „B13f:”), wszystkie przechodzą. Istniejące testy nie były zmieniane.
- Na kodzie sprzed zmiany pada wszystkie 48 nowych testów — ale dlatego, że obie funkcje nie były wtedy eksportowane, więc ta liczba nic nie mówi o samych filtrach. O tym, że testy łapią błędy w filtrach, świadczą próby recenzenta (niżej).
- Prawdziwe pobranie przez `POST /api/download`, film testowy (pionowy short), typ „film”, mp4:
  - 720p → `ffprobe`: h264 360x640 + aac, 33,19 s. Film jest pionowy; limit dotyczy wysokości, a YouTube ma dla niego H.264 w 360x640 i 1080x1920, więc pod limit 720 mieści się 360x640. Ten sam format (nr 18) yt-dlp wybierał dla starego filtra.
  - „best” → `ffprobe`: h264 1080x1920 + aac, 33,20 s.
- Tryb „osobno”, mp4, 720p: sukces, plik wideo to h264 360x640.
- `yt-dlp -s --print` (bez pobierania) na filmie testowym: wszystkie cztery nowe filtry mp4 (film i „osobno”, 720 i „best”) wybierają format `avc1`. Sam wariant zapasowy użyty osobno wybiera AV1 z Opusem (`bv*+ba/b` → 401+251, 3840 wysokości), czyli w pełnym filtrze nie przejmuje pierwszeństwa.
- Działanie wariantu zapasowego: filtr z celowo niemożliwym pierwszym członem (`vcodec^=nieistnieje`) i wariantem zapasowym na końcu wybiera format (AV1), a ten sam filtr bez wariantu zapasowego kończy się błędem „Requested format is not available”.
- Pliki próbne usunięte, serwer zatrzymany; w konsoli serwera brak nieobsłużonych wyjątków.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 18 sposobów (brak wariantu zapasowego, wariant na początku, wymóg `ext` w zapasie, brak limitu wysokości, `<` zamiast `<=`, brak `+ba`, format wypadający z warunku, ucięcie filtra przed przekazaniem do yt-dlp i inne); testy wykryły wszystkie 18.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): oczekiwane napisy dla rozdzielczości powstają z szablonu (dosłowne napisy są w dwóch testach przekazania do yt-dlp); przekazanie filtra po `-f` sprawdzają cztery kombinacje; mkv ma tylko „best” i 720; `loadApp` jest kolejną kopią tej samej funkcji.

### Niesprawdzone

- Prawdziwe pobranie filmu, który nie ma H.264 — film testowy ma H.264 w każdej rozdzielczości. Wariant zapasowy sprawdzony tylko przez `yt-dlp -s` z niemożliwym pierwszym członem (wybór formatu, bez pobierania). Nie wiadomo, czy AV1/VP9 z Opusem poprawnie przechodzi łączenie do mp4 i konwersję do mpeg/mjpeg.
- Prawdziwe pobranie w formatach mpeg i mjpeg (filtr jest ten sam co dla mp4).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B6: Normalizacja bez 192 kHz

### Co zmieniono (`app.js`)

- `buildAudioFilters`: gdy normalizacja jest włączona, a sample rate to „default”, po `loudnorm` dochodzi `aresample=48000`. Filtr `loudnorm` sam podbija sample rate do 192 kHz, więc bez tego flac i wav wychodziły w 192 kHz (kilkukrotnie większe pliki).
- Gdy sample rate jest wybrany, zostaje dotychczasowe `aresample=<wartość>` (jeden `aresample`, nie dwa).
- Bez normalizacji nic się nie zmienia.
- `module.exports`: doszły `buildAudioFilters` i `processDownloadedFile` (potrzebne testom).

### Przyjęte założenia

- 48 kHz jest stałe, niezależnie od sample rate źródła (tak mówi zadanie). Dźwięk 44,1 kHz po normalizacji wychodzi więc w 48 kHz.
- Zmiana działa wszędzie, gdzie używane jest `buildAudioFilters`: audio (każdy format), film z dźwiękiem i ścieżka audio trybu „osobno”.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 189 testów (161 wcześniejszych + 28 nowych z przedrostkiem „B6:”), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy nie były zmieniane.
- Prawdziwe pobranie przez `POST /api/download`, film testowy, typ „audio”, normalizacja włączona:
  - flac, sample rate „default” → `ffprobe`: flac, 48000 Hz, stereo, 33,15 s.
  - wav, sample rate „default” → `ffprobe`: pcm_s16le, 48000 Hz, stereo, 33,15 s.
  - flac, sample rate 22050 → `ffprobe`: 22050 Hz (wybrana wartość zostaje).
  - W konsoli serwera ffmpeg dostał `-af loudnorm,aresample=48000` (dla 22050: `loudnorm,aresample=22050,aformat=sample_fmts=s16`).
- Pliki próbne usunięte, serwer zatrzymany; w konsoli serwera brak nieobsłużonych wyjątków.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 11 sposobów (usunięta gałąź, 44100 i 96000 zamiast 48000, odwrócony warunek, podwójny `aresample`, `aresample` przed `loudnorm`, gałąź tylko bez bitcrusha, `-af` nieprzekazane do ffmpeg i inne); testy wykryły wszystkie 11. Bez ffmpeg w PATH usunięcie gałęzi dalej wywraca 8 testów na atrapie.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): film sprawdzany przez `processDownloadedFile` tylko dla mp4 (`-af` jest dokładane przed rozgałęzieniem na formaty); próbka w testach z prawdziwym ffmpeg ma zawsze 44,1 kHz; brak testu przez `POST /api/download` z normalizacją; test z atrapą wypisuje w konsoli log „Nie udało się usunąć oryginału” dla nieistniejącego pliku (nic nie jest zapisywane ani usuwane).

### Niesprawdzone

- Testy z prawdziwym ffmpeg biorą ffmpeg z `ffmpegPath`, ale ffprobe zawsze z PATH. Gdy ffprobe nie ma w PATH (np. sam ffmpeg w folderze `bin`), 8 testów jest po cichu pomijanych.
- Recenzent raz, na świeżej kopii w folderze tymczasowym, dostał 2 porażki poza plikiem B6 (`testy/czas.test.js` i jeden test B4); cztery kolejne uruchomienia dały 189/189. Przyczyna nieustalona, w folderze projektu się nie powtórzyło.
- Prawdziwe pobranie filmu (mp4/mkv) i trybu „osobno” z normalizacją — sprawdzone tylko testami na atrapie.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B5: Jawna jakość przy przetwarzaniu audio

### Co zmieniono (`app.js`)

- Nowa funkcja `buildAudioQualityArgs(format, bitrate)` zwraca argumenty jakości dla ffmpeg:
  - mp3 + „best” → `-q:a 0` (najwyższa jakość VBR),
  - mp3 + wartość → `-b:a <wartość>K`,
  - m4a + „best” → `-b:a 256k`,
  - m4a + wartość → `-b:a <wartość>K`,
  - wav i flac → nic (bezstratne).
- `processDownloadedFile`, gałąź `mediaType === "audio"`: zamiast warunku „tylko mp3 i nie best” zawsze dokłada wynik tej funkcji. Wcześniej mp3 „best” i każde m4a po dowolnym efekcie wychodziły z domyślną jakością ffmpeg (ok. 128 kb/s).
- Ścieżka audio trybu „osobno” idzie tą samą gałęzią (mp3, „best”), więc dostaje `-q:a 0`.
- Dźwięk w filmie (gałąź `video`) bez zmian — tam jakość była już ustawiana (`aac 192k`).
- `module.exports`: doszło `buildAudioQualityArgs` (potrzebne testom).

### Przyjęte założenia

- Bez efektów ffmpeg dalej nie jest uruchamiany; jakość zostaje taka, jaką dał yt-dlp.
- W trybie „osobno” ścieżka audio jest zawsze traktowana jak „best” (tak było w kodzie; suwak bitrate jej nie dotyczy).

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 246 testów (189 wcześniejszych + 57 nowych z przedrostkiem „B5:”, plik `testy/jakosc-audio.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy nie były zmieniane.
- Testy obejmują: samą funkcję (wszystkie formaty i bitrate'y), argumenty, które naprawdę dostaje ffmpeg z `processDownloadedFile` (każdy efekt osobno), całą drogę przez `POST /api/download` z atrapami yt-dlp i ffmpeg (w tym tryb „osobno”) oraz prawdziwy ffmpeg na próbce z generatora szumu (pomiar bitrate przez `ffprobe`).
- Prawdziwy ffmpeg uruchomiony przez `processDownloadedFile` na plikach próbnych w `downloads` (20 s szumu stereo, pliki zrobione ffmpeg-iem, nie pobrane):
  - mp3 „best” + normalizacja → `ffprobe`: mp3, 48000 Hz, stereo, 243,5 kb/s.
  - m4a 256 + mono → `ffprobe`: aac, 1 kanał, 212,1 kb/s.
  - ścieżka audio trybu „osobno” (mp3 „best”) + normalizacja → 243,5 kb/s.
  - Dla porównania te same argumenty bez opcji jakości dają 128,6 kb/s (mp3).
  - Oryginały zostały usunięte przez program, pliki wynikowe usunięte ręcznie po pomiarze.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 32 sposoby (złe wartości `-q:a`/`-b:a`, brak opcji, stary warunek, opcja tylko przy filtrach albo tylko przy normalizacji, opcja dwa razy, opcja przed `-i` albo po pliku wynikowym, tryb „osobno” z bitrate z suwaka i inne); testy wykryły 31.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): brak testu dla samego przycinania bez efektów (jedyny niewykryty błąd: opcja jakości pomijana, gdy ffmpeg tylko przycina; zadanie B11 usuwa przycinanie z ffmpeg); testy z prawdziwym ffmpeg składają argumenty same, a nie przez `processDownloadedFile` (przekazanie pokrywają testy na atrapie); test „bez opcji jakości wychodzi ok. 128 kb/s” sprawdza domyślne ustawienia ffmpeg, nie kod; test trybu „osobno” wysyła bitrate `"16"`, a strona wysyła `null`.

### Niesprawdzone

- **Prawdziwe pobranie z YouTube (linia „Sprawdzenie” zadania) nie zostało wykonane.** W chwili sprawdzania YouTube odrzucał każde wywołanie yt-dlp z tego komputera: `HTTP Error 429: Too Many Requests` i „Sign in to confirm you’re not a bot” (cztery próby przez `POST /api/download` i dwie przez `yt-dlp -s`, w odstępie kilku minut). To blokada po stronie YouTube, niezwiązana ze zmianą. Zamiast tego sprawdzony został ten sam kod z prawdziwym ffmpeg na plikach próbnych (wyżej). Do powtórzenia, gdy blokada minie: audio mp3 „best” + normalizacja, audio m4a 256 + mono, tryb „osobno” + normalizacja. Zainstalowany yt-dlp ma wersję 2026.03.17 (sam ostrzega, że jest starszy niż 90 dni); nie był aktualizowany.
- Samo przycinanie bez efektów (mp3/m4a) — brak testu, patrz uwaga recenzenta.
- ffmpeg bez `libmp3lame`: testy z prawdziwym ffmpeg padną zamiast się pominąć.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B7: MPEG przy niskim sample rate

### Co zmieniono (`app.js`)

- `addVideoCodecArgs(ffmpegArgs, format, mediaType, sampleRate)` dostała czwarty argument: wybrany sample rate.
- Gałąź `mpeg` z dźwiękiem: `-b:a 128k`, gdy sample rate jest liczbą ≤ 24000 (8000, 11025, 12000, 16000, 22050, 24000); w pozostałych przypadkach (32000, 44100, 48000, „default”) zostaje `-b:a 192k`. Wcześniej zawsze było 192k, a enkoder mp2 odrzuca tę wartość przy niskich częstotliwościach („bitrate 192 is not allowed in mp2”).
- Oba wywołania w `processDownloadedFile` przekazują `experimental.sampleRate`.
- Pozostałe formaty (mp4, mkv, mjpeg) i mpeg bez dźwięku (tryb „osobno”, `-an`) bez zmian.
- `module.exports`: doszło `addVideoCodecArgs` (potrzebne testom).

### Przyjęte założenia

- Decyduje wartość wybrana pokrętłem, nie sample rate pliku źródłowego. Przy „default” zostaje 192k (dźwięk z YouTube ma 44100 albo 48000 Hz).
- Zmiana dotyczy tylko bitrate. Sample rate wyniku dalej ustawia filtr `aresample`.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 294 testy (246 wcześniejszych + 48 nowych z przedrostkiem „B7:”, plik `testy/mpeg-sample-rate.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy nie były zmieniane.
- Testy obejmują: samą funkcję dla każdej wartości dopuszczanej przez serwer, argumenty, które naprawdę dostaje ffmpeg z `processDownloadedFile`, całą drogę przez `POST /api/download` z atrapami yt-dlp i ffmpeg oraz prawdziwy ffmpeg uruchomiony z argumentami złożonymi przez `processDownloadedFile` na 2-sekundowej próbce z generatora (każdy sample rate kończy się sukcesem, `ffprobe` pokazuje mpeg2video + mp2 i bitrate 128000 albo 192000). Jeden test potwierdza sam błąd: stare 192k przy 16000 Hz kończy się błędem ffmpeg.
- Prawdziwe pobranie filmu testowego przez `POST /api/download` (film, mpeg, 360p), wynik zmierzony `ffprobe`:
  - sample rate 16000 → sukces; mpeg2video + mp2, 16000 Hz, stereo, 128 kb/s, 33,26 s.
  - sample rate 8000 → sukces; mpeg2video + mp2, **16000 Hz**, stereo, 128 kb/s, 33,26 s.
  - bez zmiany sample rate → sukces; mpeg2video + mp2, 44100 Hz, stereo, 192 kb/s, 33,20 s.
  - Pliki usunięte po pomiarze, serwer zatrzymany.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 10 sposobów zmieniających działanie (próg `<`, `<= 22050`, `<= 32000`, odwrócony warunek, brak przekazania sample rate, inne wartości bitrate, porównanie napisów zamiast liczb, zmiana w mjpeg, brak eksportu); testy wykryły wszystkie.
- Drobna uwaga recenzenta została bez poprawki (zasada 2a): test błędu wymaga w komunikacie ffmpeg napisu „not allowed in mp2”; inna wersja ffmpeg może sformułować go inaczej.

### Uwaga dla właściciela (poza zakresem zadania)

- Przy mpeg i sample rate 8000 plik ma dźwięk 16000 Hz, nie 8000. Enkoder mp2 obsługuje tylko 16000, 22050, 24000, 32000, 44100 i 48000 Hz, więc ffmpeg sam podnosi częstotliwość do najbliższej obsługiwanej. Dla 11025 i 12000 zapewne dzieje się to samo — nie było mierzone. Pobranie kończy się sukcesem, czyli zadanie jest spełnione; efekt „lo-fi” z filtra zostaje w dźwięku, zmienia się tylko częstotliwość zapisana w pliku.

### Niesprawdzone

- Prawdziwe pobranie przy pozostałych wartościach (11025, 12000, 22050, 24000, 32000, 44100, 48000) — tylko prawdziwy ffmpeg na próbce z generatora.
- Sample rate pliku wynikowego przy 11025 i 12000 (patrz uwaga wyżej).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B10: MJPEG z rozszerzeniem `.avi`

### Co zmieniono (`app.js`)

- `buildProcessedFileName`: dla formatu `mjpeg` (film i wideo z trybu „osobno”) plik wynikowy dostaje rozszerzenie `.avi` zamiast `.mjpeg`. ffmpeg od początku zapisywał ten format w kontenerze avi (`-f avi`), więc teraz rozszerzenie zgadza się z zawartością.
- Pozostałe formaty wideo (mp4, mpeg, mkv) i audio bez zmian.
- Lista formatów i walidacja bez zmian: opcja na stronie i wartość wysyłana do serwera dalej nazywa się `mjpeg`; `avi` jako format jest odrzucane (400).
- `module.exports`: doszło `buildProcessedFileName` (potrzebne testom).

### Przyjęte założenia

- Zmienia się tylko nazwa pliku. Argumenty ffmpeg (kodek mjpeg, dźwięk mp3 192k, `-f avi`) zostają jak były.
- Przedrostek `processed-` zostaje — usuwa go zadanie B13g.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 309 testów (294 wcześniejsze + 15 nowych z przedrostkiem „B10:”, plik `testy/rozszerzenie-mjpeg.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy nie były zmieniane.
- Testy obejmują: samą funkcję dla każdego formatu i trybu, nazwę pliku, którą naprawdę dostaje ffmpeg z `processDownloadedFile`, adres w odpowiedzi `POST /api/download` (film i tryb „osobno”, yt-dlp i ffmpeg to atrapy) oraz prawdziwy ffmpeg na 2-sekundowej próbce z generatora (`ffprobe`: kontener avi, kodek mjpeg; film ma dźwięk mp3, wideo z trybu „osobno” jest bez dźwięku).
- Prawdziwe pobranie filmu testowego przez `POST /api/download` (film, mjpeg, 360p): sukces, plik `processed-the #1 NO SCOPE player in rivals [3c7557b4].avi`; `ffprobe`: kontener `avi`, obraz `mjpeg`, dźwięk `mp3`, 33,25 s. Plik usunięty po pomiarze, serwer zatrzymany.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 12 sposobów (stare `.mjpeg`, `.avi` tylko w jednym trybie, `.avi` także dla mpeg, odwrócony warunek, podwójne rozszerzenie, `.AVI`, `-f mjpeg`, `avi` na liście formatów, inna nazwa zwrócona niż zapisana, tytuł obcięty na kropce, yt-dlp łączący do avi); testy wykryły wszystkie.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): `ffprobe` jest brany z PATH, więc bez niego testy z prawdziwym ffmpeg się pomijają; lista formatów jest sprawdzana przez czytanie źródła wyrażeniem regularnym; brak przypadku z przycięciem i ze znakami `#`/`%` w tytule (nazwa od nich nie zależy).

### Niesprawdzone

- Prawdziwe pobranie w trybie „osobno” z formatem mjpeg — tylko testy (atrapy i prawdziwy ffmpeg na próbce).
- Otwarcie pliku `.avi` w odtwarzaczu — mierzone tylko `ffprobe`.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B13g: Bez przedrostka `processed-`

### Co zmieniono (`app.js`)

- `buildProcessedFileName` zwraca końcową nazwę pliku bez przedrostka: nazwę oryginału z właściwym rozszerzeniem. Audio dostaje dokładnie nazwę pobranego pliku; wideo nazwę pobranego pliku z rozszerzeniem formatu (`mjpeg` → `.avi`, jak po B10).
- Nowa funkcja `buildTempFileName(nazwa)` — nazwa tymczasowa `tmp-<końcowa nazwa>`.
- Nowa funkcja `runFfmpegAndReplace`, wspólna dla obu miejsc, w których `processDownloadedFile` uruchamia ffmpeg (wideo trybu „osobno” i pozostałe):
  1. ffmpeg zapisuje wynik do pliku tymczasowego `tmp-<końcowa nazwa>` w `downloads`;
  2. gdy ffmpeg skończy się błędem (albo nie da się go uruchomić), plik tymczasowy jest usuwany, a błąd idzie dalej do odpowiedzi serwera jak dotąd;
  3. po sukcesie usuwany jest oryginał (`deleteOriginalFile`, bez zmian), a plik tymczasowy dostaje końcową nazwę (`fs.renameSync`);
  4. funkcja zwraca końcową nazwę — ta trafia do adresu `/downloads/...` w odpowiedzi.
- Nowa funkcja `deleteTempFile` — usuwa plik tymczasowy; gdy ffmpeg nie zdążył go utworzyć, nic nie wypisuje.
- `deleteOriginalFile` bez zmian.
- `processDownloadedFile` przyjmuje opcjonalne pole `dir` (domyślnie folder `downloads`). Program go nie podaje.
- `module.exports`: doszło `buildTempFileName` (potrzebne testom).
- Przykład: audio mp3 z normalizacją dawało `processed-tytuł [id].mp3`, teraz daje `tytuł [id].mp3`. Film mjpeg: `tytuł [id].avi`.

### Przyjęte założenia

- Przedrostek nazwy tymczasowej to `tmp-` (przykład z zadania).
- Gdy zmiana nazwy się nie uda (np. system nie pozwala nadpisać zablokowanego oryginału), funkcja nie zgłasza błędu: wynik zostaje pod nazwą `tmp-...`, ta nazwa jest zwracana i wpis trafia do konsoli. Plik jest poprawny, więc użytkownik dalej go dostaje, tylko pod brzydszą nazwą. Zadanie tego przypadku nie opisuje.
- Przy błędzie ffmpeg usuwany jest tylko plik tymczasowy (tak mówi zadanie). Oryginał zostaje w `downloads` i znika przy sprzątaniu po 30 minutach, jak przed zmianą.
- Pole `dir` w `processDownloadedFile` jest dodane dla testów, żeby pracowały na prawdziwych plikach w `os.tmpdir()`, a nie w `downloads` (tak samo jak parametr folderu w `cleanupOldDownloads` z B8).
- Plik tymczasowy leży w `downloads` obok oryginału. Jeśli serwer zostanie zabity w trakcie pracy ffmpeg, plik `tmp-...` zostaje i usuwa go zwykłe sprzątanie po 30 minutach.

### Zmiana w istniejących testach (zgłoszenie)

Testy B5, B7 i B10 porównywały dokładną nazwę pliku wynikowego z przedrostkiem `processed-`, a B13g ten przedrostek usuwa:

- `testy/rozszerzenie-mjpeg.test.js` (B10): oczekiwane nazwy z `buildProcessedFileName`, nazwy zwracane przez `processDownloadedFile` i adresy w odpowiedzi `/api/download` są teraz bez `processed-`; ostatni argument ffmpeg to `tmp-<końcowa nazwa>` (cztery asercje i jedna w teście z prawdziwym ffmpeg). Na górze pliku doszło podstawienie `fs.renameSync` dla folderu `downloads`: atrapa `spawn` w tych testach nie tworzy plików, więc prawdziwa zmiana nazwy by się nie udała i funkcja zwracałaby nazwę tymczasową.
- `testy/jakosc-audio.test.js` (B5) i `testy/mpeg-sample-rate.test.js` (B7): po jednej asercji ostatniego argumentu ffmpeg, `processed-...` → `tmp-...`.

Żaden test nie został usunięty ani poluzowany; porównania dalej są dokładne.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 332 testy (309 wcześniejszych + 23 nowe z przedrostkiem „B13g:”, plik `testy/nazwa-wyniku.test.js`), wszystkie przechodzą, żaden nie jest pomijany.
- Nowe testy pracują na prawdziwych plikach w folderze tymczasowym. Atrapa `spawn` udaje ffmpeg: zapisuje plik wynikowy albo zostawia niedokończony plik i kończy się błędem. Sprawdzane są: nazwa, do której pisze ffmpeg; to, że oryginał leży na miejscu w trakcie pracy ffmpeg; zawartość folderu po sukcesie (jeden plik, z treścią wyniku, nie oryginału) i po błędzie (sam oryginał); audio w czterech formatach z każdym efektem osobno, film (mp4, mpeg, mjpeg, zmiana rozszerzenia webm → mp4), wideo trybu „osobno”; inne pliki w folderze nietknięte; nieudana zmiana nazwy; cała droga przez `POST /api/download` (kolejność: usunięcie oryginału, potem zmiana nazwy). Dwa testy uruchamiają prawdziwy ffmpeg na próbce z generatora (2 s tonu w mp3): po normalizacji pod tą samą nazwą leży plik 48 kHz (próbka miała 44,1 kHz), a dla uszkodzonego pliku wejściowego nie zostaje plik tymczasowy.
- Prawdziwe pobranie filmu testowego przez `POST /api/download` (serwer `node app.js` na porcie 3431, folder `downloads` pusty przed startem):
  - audio mp3 „best” + normalizacja → `the #1 NO SCOPE player in rivals [1d95e64b].mp3`; w `downloads` jeden plik, bez `processed-` i bez `tmp-`; `ffprobe`: mp3, 48000 Hz (czyli plik po normalizacji, nie oryginał), ok. 219 kb/s, 33,15 s.
  - film mjpeg 360p (zmiana rozszerzenia mp4 → avi) → `the #1 NO SCOPE player in rivals [97234a8d].avi`; przybył jeden plik; `ffprobe`: avi, mjpeg + mp3, 33,25 s.
  - tryb „osobno” mp4 360p + normalizacja + mono → `... video [f3954350].mp4` (h264, 33,13 s) i `... audio [f3954350].mp3` (mp3, 33,15 s); przybyły dwa pliki.
  - Po trzech pobraniach w `downloads` leżały dokładnie cztery pliki, żaden z przedrostkiem. W konsoli serwera nie ma wpisów o nieudanym usuwaniu ani zmianie nazwy, nie ma nieobsłużonych wyjątków. Pliki próbne usunięte, serwer zatrzymany.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 19 sposobów (m.in. powrót `processed-`, brak usuwania pliku tymczasowego po błędzie, brak usuwania oryginału, brak zmiany nazwy, usuwanie oryginału zamiast pliku tymczasowego, zapis od razu pod końcową nazwę, połknięty błąd ffmpeg, zmiana nazwy przed usunięciem oryginału, oryginał usuwany przed startem ffmpeg, `.tmp` zamiast `tmp-`); testy wykryły wszystkie 19. Zmiany w starych testach uznał za wynikające z zadania i nieosłabiające ich.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): nie ma testu, w którym nie daje się usunąć zablokowanego oryginału (podstawiana jest tylko nieudana zmiana nazwy); stare testy B5, B6 i B7 wołają `processDownloadedFile` na nieistniejących plikach w `downloads` i przechodzą dzięki temu, że nieudana zmiana nazwy nie zgłasza błędu — gdyby to założenie zmienić, trzeba w nich podstawić `fs.renameSync` (tak jak w `testy/rozszerzenie-mjpeg.test.js`); te testy próbują usunąć i przemianować nieistniejący plik w `downloads` (nic nie znika i nic nie powstaje); test szukający napisu `processed-` w `app.js` padnie też od komentarza z tym słowem; brak przypadków: stary plik `tmp-...` po przerwanej pracy, przycięcie, znaki `%` i `?` w tytule.
- Po recenzji została kopia robocza recenzenta w folderze tymczasowym systemu (`tmp.uYpoPRoriB`), poza projektem — recenzent nie miał uprawnień, żeby ją usunąć. Można ją skasować.

### Niesprawdzone

- Błąd ffmpeg w prawdziwym pobraniu — usuwanie pliku tymczasowego sprawdzają tylko testy (atrapa i prawdziwy ffmpeg na uszkodzonym pliku).
- Nieudana zmiana nazwy na prawdziwym, zablokowanym pliku — tylko test z podstawionym `fs.renameSync`.
- Pobranie pliku spod adresu z odpowiedzi (`GET /downloads/...`) — tytuł filmu ma znak `#`, kodowanie adresów to zadanie B2.
- Strona w przeglądarce nie była używana — pobrania szły przez `POST /api/download` (curl).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B11: Przycinanie

### Który wariant został

**Został plan awaryjny z zadania: yt-dlp pobiera cały film, a tnie ffmpeg, z kodowaniem obrazu i dźwięku od nowa.** Wariant główny (pobranie samego wycinka przez `--download-sections`) został zrobiony, sprawdzony na prawdziwym filmie i wycofany, bo ciął audio niedokładnie.

Pomiary wariantu głównego (film testowy, przycięcie 5–12 s, yt-dlp 2026.03.17, argumenty dokładnie według zadania):

| Tryb | Wynik | Ocena |
|---|---|---|
| film mp4 720p (`--download-sections "*5-12" --force-keyframes-at-cuts`) | 7,000 s; dźwięk zaczyna się w 5,000 s filmu; pierwsza klatka to klatka z 5,00 s | dokładnie |
| wideo trybu „osobno” (to samo) | 7,000 s; pierwsza klatka z 5,00 s | dokładnie |
| audio mp3 (`--download-sections "*5-12"`, bez `--force-keyframes-at-cuts`, bo zadanie daje tę opcję tylko dla wideo) | **11,99 s zamiast 7 s; plik zawiera 0–12 s filmu** | **błąd: start jest ignorowany** |
| audio trybu „osobno” (to samo) | 11,99 s, 0–12 s filmu | błąd |

Przyczyna: bez `--force-keyframes-at-cuts` yt-dlp kopiuje strumień dźwięku (opus w webm) bez kodowania. ffmpeg, którym yt-dlp pobiera wycinek, skacze wtedy do początku pliku i zapisuje wszystko od zera do końca wycinka. Położenie dźwięku było mierzone przez dopasowanie pierwszych 3 s wyniku do dźwięku całego filmu (korelacja).

To jest warunek z linii „Plan awaryjny” („jeśli cięcie jest niedokładne”), więc zmiana została wycofana w całości, tak jak każe zadanie. W kodzie nie ma `buildSectionArgs`, a `needsTrim` w `shouldProcessMedia` zostaje.

**Do decyzji właściciela:** sprawdziłem też wariant, którego zadanie nie przewiduje — `--force-keyframes-at-cuts` także dla audio. Daje dokładny wynik (7,000 s, start w 4,999 s) i nie wymaga pobierania całego filmu, ale yt-dlp koduje wtedy dźwięk pośrednio do opus 96 kb/s, a dopiero potem do wybranego formatu, czyli jakość audio spada. Nie wprowadziłem go, bo zadanie na wypadek niedokładnego cięcia podaje wprost plan awaryjny. Jeśli pobieranie samego wycinka (bez ściągania całego filmu) jest ważniejsze od tej straty jakości, da się do niego wrócić: film i wideo „osobno” działały dokładnie.

### Co zmieniono (`app.js`)

- Nowa funkcja `buildTrimVideoArgs()` — argumenty kodowania obrazu przy przycinaniu: `-c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p`.
- `processDownloadedFile`: `-ss` i `-to` stoją przed `-i` (tak było już wcześniej; doszedł komentarz). Nowa zmienna `needsTrim` i dwie nowe gałęzie:
  - film (mp4, mkv) z przycięciem: obraz kodowany przez `buildTrimVideoArgs()`, dźwięk `-c:a aac -b:a 192k`. Wcześniej było `-c copy` (bez efektów) albo `-c:v copy` (z efektami), czyli cięcie tylko na klatkach kluczowych — początek wypadał do kilku sekund za wcześnie.
  - wideo trybu „osobno” (mp4, mkv) z przycięciem: obraz kodowany przez `buildTrimVideoArgs()`, `-an`. Wcześniej mkv miało `-c copy`, a mp4 kodowanie z `-crf 23`.
- Bez zmian: mpeg i mjpeg (kodują obraz od nowa swoimi kodekami, więc cięcie i tak jest dokładne), audio (ffmpeg zawsze koduje je od nowa, jakość z B5), wszystko, co dzieje się bez przycinania, wywołania yt-dlp, `shouldProcessMedia`, endpoint.
- `module.exports`: doszły `buildTrimVideoArgs` i `shouldProcessMedia` (potrzebne testom).

### Przyjęte założenia

- „Wycofaj tę zmianę” rozumiem jako wycofanie całego wariantu z `--download-sections`, we wszystkich trzech trybach, a nie tylko dla audio. Jeden sposób cięcia dla wszystkich trybów jest prostszy niż mieszany.
- Kodowanie `libx264 … crf 20` dotyczy tylko pobrań z przycięciem. Bez przycinania zostaje to, co było (kopiowanie; wideo „osobno” mp4 dalej z `-crf 23` — tym zajmuje się zadanie B12).
- Dla mpeg i mjpeg plan awaryjny nic nie zmienia: `libx264` i `aac` nie pasują do tych formatów, a ich własne kodowanie już tnie co do klatki.
- Dźwięk filmu przy przycinaniu ma zawsze `aac 192k`, także gdy są włączone efekty audio (tak było i przed zmianą).
- Skutek uboczny: przycięty film jest kodowany od nowa, więc trwa to dłużej niż samo kopiowanie, a film jest pobierany w całości.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 357 testów (332 wcześniejsze + 25 nowych z przedrostkiem „B11:”, plik `testy/przycinanie.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- Nowe testy na atrapie `spawn`: dokładne argumenty ffmpeg dla filmu (mp4, mkv), wideo „osobno” (mp4, mkv, źródło webm), mpeg i mjpeg, audio w czterech formatach; sam start, sam koniec, start równy 0; przycięcie razem z efektami; brak zmian bez przycinania; brak `--download-sections` i `--force-keyframes-at-cuts` w wywołaniach yt-dlp; czasy wpisane w formularzu (`0:05`, `1:02:03`) docierają do ffmpeg przez `POST /api/download` w trzech trybach.
- Nowe testy z prawdziwym ffmpeg: próbka 10 s z generatora, która ma jedną klatkę kluczową, obraz czarny do 3. sekundy i biały potem, ciszę do 3. sekundy i ton potem. Po przycięciu 2–6 s test mierzy liczbę klatek (120 ± 1), numer pierwszej białej klatki (30 ± 1), liczbę pakietów obrazu zapisanych w pliku (tyle co klatek — kopiowanie strumienia zostawia w pliku klatki sprzed wycinka, a mp4 ukrywa je przed odtwarzaczem), długość dźwięku (4 s ± 0,1), start tonu (1 s ± 0,05) i różnicę między startem tonu a zmianą obrazu. Tak samo dla samego startu i samego końca, dla wideo „osobno”, mpeg i audio (mp3, m4a, wav, flac).
- Prawdziwe pobrania filmu testowego przez `POST /api/download` (serwer `node app.js` na porcie 3441, `downloads` pusty przed startem). Start dźwięku mierzony dopasowaniem do dźwięku całego filmu, pierwsza klatka porównana (PSNR) z klatkami całego filmu:

| Pobranie | Długość | Początek |
|---|---|---|
| audio mp3, 5–12 | 7,000 s | dźwięk od 5,000 s |
| film mp4 720p, 5–12 | obraz 7,000 s (210 klatek), dźwięk 7,000 s | dźwięk od 5,000 s; pierwsza klatka = klatka z 5,000 s (PSNR 41,8 dB; sąsiednia wcześniejsza 34,5 dB) |
| „osobno” mp4 720p, 5–12: wideo | 7,000 s | pierwsza klatka = klatka z 5,000 s (41,8 dB) |
| „osobno” mp4 720p, 5–12: audio mp3 | 7,000 s | dźwięk od 5,000 s |
| film mp4, sam start 25 | obraz 8,13 s, dźwięk 8,19 s (do końca filmu 33,13/33,19 s) | dźwięk od 25,000 s; pierwsza klatka = klatka z 25,000 s (40,9 dB; sąsiednie 18 dB) |
| film mp4, sam koniec 8 | 8,000 s | dźwięk od 0,000 s |
| audio mp3, sam start 25 | 8,152 s (do końca) | dźwięk od 25,000 s |
| audio m4a, sam koniec 8 | 8,000 s | dźwięk od 0,000 s |
| film mkv 360p, 5–12 | 7,021 s | dźwięk od 5,03 s względem ścieżki aac z pliku mp4 (ta sama różnica 0,03 s jest między ścieżkami opus i aac całego filmu, nie pochodzi z cięcia) |

- Zgranie obrazu z dźwiękiem w filmie mp4 5–12: obraz zaczyna się na klatce z 5,000 s, a dźwięk w 5,000 s, obie ścieżki mają `start_time` 0 i 7,000 s — czyli są zgrane. `ffmpeg -v error -i <plik> -f null -` nie wypisał błędów dla żadnego pliku wideo. W konsoli serwera nie ma nieobsłużonych wyjątków.
- Po sprawdzeniu pliki próbne usunięte z `downloads`, serwer zatrzymany, foldery robocze w folderze tymczasowym usunięte.
- Recenzja testów przez agenta `recenzent-testow`: dwie rundy. W pierwszej recenzent zepsuł kod na kopii na 51 sposobów, testy wykryły 48, i zgłosił dwie poważne uwagi: (1) brak testu wideo „osobno” z samym startem albo samym końcem; (2) testy z prawdziwym ffmpeg nie odróżniały w mp4 kopiowania strumienia od kodowania, bo mp4 ukrywa nadmiarowe klatki listą edycji. Obie poprawione (nowe testy „osobno” dla samego startu i końca; liczenie pakietów obrazu w pliku). W drugiej rundzie testy zaakceptowane bez poważnych uwag; 8 powtórzonych zepsuć wykrytych, kopiowanie w mp4 łapią już same testy z prawdziwym ffmpeg.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): ffprobe jest brany z PATH po nazwie (gdy go brak, testy z prawdziwym ffmpeg są pomijane, tak jak w starszych plikach testów); mjpeg nie ma testu przycinania z prawdziwym ffmpeg.

### Niesprawdzone

- Zgranie obrazu z dźwiękiem „na oko i ucho” (odtworzenie pliku) — sprawdzone tylko pomiarem.
- Dla filmu mkv pierwsza klatka nie została jednoznacznie potwierdzona na prawdziwym pobraniu (plik 360p porównywany z wzorcem 720p dał zbliżony wynik dla trzech sąsiednich klatek); dokładność mkv potwierdza test z prawdziwym ffmpeg na próbce.
- Przycięte mpeg i mjpeg na prawdziwym pobraniu — tylko testy (mpeg z prawdziwym ffmpeg na próbce, mjpeg tylko argumenty).
- Długie filmy (czas kodowania, przycięcie daleko od początku) — film testowy ma 33 s.
- Strona w przeglądarce nie była używana — pobrania szły przez `POST /api/download` (curl).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B12: Tryb „osobno” + MP4 bez pełnego kodowania

### Kod sprzed zmiany (do przywrócenia)

Zapisane przed zmianą, zgodnie z zadaniem. Gałąź w `addVideoCodecArgs` (`app.js`), która dla wideo trybu „osobno” w mp4 kodowała cały obraz od nowa:

```js
function addVideoCodecArgs(ffmpegArgs, format, mediaType, sampleRate) {
    if (format === "mp4") {
        if (mediaType === "videoOnly") {
            ffmpegArgs.push("-c:v", "libx264","-preset", "veryfast","-crf", "23","-pix_fmt", "yuv420p","-an");

            return;
        }
```

Czyli argumenty ffmpeg: `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an`. Żeby wrócić do poprzedniego zachowania, wystarczy w tej gałęzi wstawić z powrotem powyższą linię `ffmpegArgs.push(...)` w miejsce nowej. Reszta (`needsSeparateMp4Encoding` w `shouldProcessMedia`, wywołanie w `processDownloadedFile`) nie była zmieniana.

### Co zmieniono (`app.js`)

- `addVideoCodecArgs`, gałąź mp4 + `videoOnly` (wideo trybu „osobno”): zamiast kodowania jest przepakowanie kontenera: `-c copy -an -movflags +faststart`. Obraz nie jest ruszany (te same dane co w pobranym pliku), ffmpeg tylko zapisuje go do nowego pliku mp4 z indeksem (`moov`) na początku.
- `shouldProcessMedia`: działanie bez zmian, doszedł komentarz. `needsSeparateMp4Encoding` zostaje, bo ffmpeg dalej ma ruszyć dla wideo „osobno” mp4 — teraz po to, żeby przepakować plik. Nazwa zmiennej została (zmiana punktowa).
- `processDownloadedFile`: bez zmian. Przycięcie wideo „osobno” dalej koduje obraz (`buildTrimVideoArgs`, zadanie B11) — kopiowanie tnie tylko na klatkach kluczowych.
- Bez zmian: mkv, mpeg, mjpeg, film w trybie łącznym, audio, wywołania yt-dlp, endpoint.

### Przyjęte założenia

- **`-an` zostało**, choć zadanie wymienia tylko `-c copy -movflags +faststart`. Stary kod miał `-an`, a bez niego plik „wideo” potrafi mieć dźwięk: na filmie testowym yt-dlp dla filtra `bv*…` wybrał format, który zawiera też ścieżkę aac (sprawdzone `ffprobe` na surowym pliku z yt-dlp: h264 + aac). Samo `-c copy` skopiowałoby ją do pliku wideo.
- **Przepakowanie dotyczy każdego pobranego pliku**, także gdy ma inne rozszerzenie niż mp4. Zadanie mówi „dla `videoOnly` + mp4” bez wyjątków, więc to najprostsza interpretacja.
- Zmiennej `needsSeparateMp4Encoding` nie usuwałem: bez niej ffmpeg nie ruszałby dla pliku mp4 i nie byłoby `+faststart`, którego zadanie wymaga.

### Uwaga dla właściciela (skutek założenia)

Stare kodowanie zawsze dawało H.264. Teraz kodek jest taki, jaki pobrał yt-dlp. Zwykle to H.264 (filtr z B13f najpierw szuka `avc1`). Jeśli film nie ma wersji H.264 i zadziała wariant zapasowy `/bv*`, w pliku mp4 znajdzie się VP9 albo AV1. Taki plik odtwarzają przeglądarki i VLC, ale starsze odtwarzacze i część programów do montażu mogą go nie otworzyć. Tego przypadku nie uruchamiałem (film testowy ma H.264). Jeśli mp4 ma zawsze znaczyć H.264, trzeba dla źródła innego niż H.264 zostawić kodowanie — to osobna decyzja.

### Zmiana w istniejących testach (zgłoszenie)

- `testy/przycinanie.test.js`, test „B11: bez przycinania…”: jedna asercja oczekiwała dla wideo „osobno” mp4 bez przycięcia starych argumentów `-c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -an`. B12 każe je zastąpić, więc oczekiwana lista to teraz `-c copy -an -movflags +faststart`. Porównanie dalej jest dokładne; nic nie usunięto.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 375 testów (357 wcześniejszych + 18 nowych z przedrostkiem „B12:”, plik `testy/przepakowanie-osobno.test.js`), wszystkie przechodzą, żaden nie jest pomijany.
- `npm run test:przegladarka`: 5 sprawdzeń (3 wcześniejsze + 2 nowe „B12:”), wszystkie przechodzą.
- Nowe testy z prawdziwym ffmpeg: próbka 10 s H.264 z generatora (czarna do 3. sekundy, potem biała) w czterech odmianach — zwykły mp4 (indeks na końcu), mp4 w kawałkach (`moof`, jak strumienie DASH), mp4 z dźwiękiem, mkv. Po przejściu przez `processDownloadedFile`: jeden strumień H.264, 10 s, 300 klatek, zmiana obrazu w tej samej klatce, suma kontrolna pakietów obrazu identyczna ze źródłem (czyli obraz nie był kodowany), `moov` przed `mdat`, pełne dekodowanie bez komunikatów, brak dźwięku. Test kontrolny potwierdza, że stare kodowanie zmienia sumę pakietów.
- **Trzy sprawdzenia z zadania na prawdziwym pobraniu** (film testowy, `POST /api/download`, tryb „osobno”, mp4, 720p, bez efektów; serwer `node app.js` na porcie 3451, `downloads` pusty przed startem). Wynik: `the #1 NO SCOPE player in rivals video [ede398c2].mp4` (1,68 MB) i plik audio mp3; całe żądanie trwało 9,3 s.
  1. `ffprobe`: jeden strumień, h264 (Constrained Baseline), 360×640, yuv420p, 30 kl./s, 994 klatki, 33,133 s; kontener mp4. Kolejność w pliku: `ftyp`, `moov`, `free`, `mdat`. **Przeszło.**
  2. `ffmpeg -v error -i <plik> -f null -`: nic nie wypisał, kod wyjścia 0. **Przeszło.**
  3. Przeglądarka (Edge bez okna, skrypt z `playwright-core`, strona otwarta z serwera programu, plik spod `/downloads/...` w elemencie `<video>`): długość 33,133 s, obraz 360×640, odtwarzanie od początku ruszyło, przewinięcia do 20 s, 5 s, 32 s i 12,5 s trafiły dokładnie w zadany czas i miały gotową klatkę (`readyState` 4), po ostatnim przewinięciu odtwarzanie poszło dalej, zakres przewijania do 33,133 s, brak błędu. **Przeszło.**
- Dodatkowo: surowy plik z yt-dlp (pobrany osobno tym samym filtrem) i wynik programu mają tę samą sumę kontrolną pakietów obrazu — program niczego nie przekodował. Na surowym pliku (33 s, 360×640) nowe polecenie ffmpeg trwało 0,07 s, stare kodowanie 0,58 s; film jest krótki i mały, przy długich filmach różnica będzie liczona w minutach.
- W konsoli serwera nie było nieobsłużonych wyjątków. Pliki próbne usunięte z `downloads`, serwer zatrzymany, pliki robocze usunięte.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 8 sposobów (powrót starego kodowania, brak `-an`, brak `+faststart`, inne `-movflags`, ffmpeg nie rusza dla mp4, przepakowanie zamiast kodowania przy przycięciu, przepakowanie także dla filmu łącznego, `-c:v copy` zamiast `-c copy`); testy wykryły wszystkie 8. Zmianę w starym teście uznał za wynikającą z zadania.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): test w przeglądarce nie sprawdza sam, że plik został przepakowany (robią to testy z prawdziwym ffmpeg) i używa tylko zwykłej próbki, nie tej w kawałkach; źródło webm ma test tylko na atrapie ffmpeg (patrz uwaga dla właściciela wyżej); dwie asercje powtarzają to, co sprawdzają inne.

### Niesprawdzone

- Film bez wersji H.264 (VP9/AV1 w mp4) — nie było takiego pobrania ani testu z prawdziwym ffmpeg.
- Odtwarzanie „na oko” w oknie przeglądarki i w innych odtwarzaczach (Windows Media Player, VLC, QuickTime) — sprawdzone tylko skryptem w Edge bez okna.
- Długie filmy i rozdzielczości powyżej 640 px wysokości — film testowy ma 33 s i 360×640.
- Wideo „osobno” mp4 razem z efektami audio na prawdziwym pobraniu — tylko testy (efekty nie dotyczą pliku wideo).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B2: Kodowanie nazw plików w adresach

### Co zmieniono (`app.js`)

- Nowa funkcja `buildDownloadUrl(nazwaPliku)`: zwraca `/downloads/` + `encodeURIComponent(nazwaPliku)`. Nazwa pliku zawiera tytuł filmu, a znaki `#`, `?` i `%` w surowym adresie go psuły (przeglądarka ucinała adres na `#` i `?`).
- Nowa funkcja `buildDownloadFiles(nazwy)`: zwraca tablicę obiektów `{ name, url }` — `name` to nazwa pliku bez kodowania, `url` to adres z `buildDownloadUrl`.
- Endpoint `/api/download`: wszystkie adresy w odpowiedzi (`downloadUrl` w trzech trybach, oba elementy `downloadUrls` w trybie „osobno”) powstają przez `buildDownloadUrl`. Doszło pole `files`: jeden element dla audio i filmu, dwa dla „osobno” (najpierw wideo, potem audio — ta sama kolejność co w `downloadUrls`). Pola `downloadUrl` i `downloadUrls` zostały.
- Obie funkcje są w `module.exports` (dla testów).
- Bez zmian: `public/script.js`. Strona dalej bierze `downloadUrl`/`downloadUrls` i wstawia je do `href`; zakodowany adres działa tam bez poprawek. Pole `files` wykorzysta dopiero zadanie U1.

### Przyjęte założenia

- Odpowiedź z błędem (400, 500) nie dostaje pola `files` — zadanie mówi o adresach plików, a przy błędzie ich nie ma.
- `files` wskazuje pliki końcowe (po ffmpeg), tak samo jak `downloadUrl`.
- Kodowana jest cała nazwa, także spacje i nawiasy kwadratowe (`%20`, `%5B`, `%5D`) — tak działa `encodeURIComponent`, którego wymaga zadanie.

### Zmiana w istniejących testach (zgłoszenie)

- `testy/rozszerzenie-mjpeg.test.js` (2 testy B10) i `testy/nazwa-wyniku.test.js` (2 testy B13g): asercje porównywały adres z odpowiedzi z wzorcem zawierającym spacje i nawiasy (np. `/downloads/tytul [abcd1234].avi`). Po B2 adres jest zakodowany, więc te asercje najpierw robią `decodeURIComponent` na adresie. Wzorce i reszta testów bez zmian, nic nie usunięto. Dokładną zakodowaną postać sprawdza nowy plik `testy/adresy-plikow.test.js`.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 391 testów (375 wcześniejszych + 16 nowych z przedrostkiem „B2:”), wszystkie przechodzą, żaden nie jest pomijany.
- Testy `GET` nie piszą do `downloads`: odczyt plików z tego folderu (`fs.stat`, `fs.createReadStream`, których używa `express.static`) jest w teście przekierowany do folderu w `os.tmpdir()`. Serwer to prawdziwa aplikacja z `app.js`.
- **Sprawdzenie z zadania na prawdziwym pobraniu** (film testowy z `#` w tytule, serwer `node app.js` na porcie 3452, `downloads` pusty przed startem):
  - audio mp3: odpowiedź 200, `downloadUrl` = `/downloads/the%20%231%20NO%20SCOPE%20player%20in%20rivals%20%5B573fb59e%5D.mp3`, `files` z jednym elementem (`name` = `the #1 NO SCOPE player in rivals [573fb59e].mp3`, `url` jak `downloadUrl`). `GET` pod ten adres: 200, `audio/mpeg`, 898 413 bajtów, plik identyczny bajt w bajt z plikiem w `downloads`; `ffprobe`: mp3, 33,15 s.
  - tryb „osobno” mp4 720p: odpowiedź 200, `downloadUrls` i `files` po dwa elementy (wideo, audio), `downloadUrl` = adres audio. `GET` pod oba adresy z `files`: 200; `ffprobe`: h264 33,13 s oraz mp3 33,15 s.
  - plik próbny `proba #1 100% %zz [b2b2b2b2].txt` utworzony ręcznie w `downloads`: `GET` pod adres zakodowany zwraca 200 i treść pliku; pod adres bez kodowania 404.
- W przeglądarce Edge (bez okna, skrypt z `playwright-core`, strona otwarta z serwera programu): odnośnik z adresem zakodowanym daje 200 dla obu plików (film z `#`, plik próbny z `#` i `%`); odnośnik z adresem bez kodowania — tak było przed zmianą — daje 404.
- W konsoli serwera nie było nieobsłużonych wyjątków. Serwer zatrzymany, cztery pliki próbne usunięte z `downloads`.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane. Recenzent zepsuł kod na kopii na 24 sposoby; testy wykryły 21. Trzy niewykryte były tego samego rodzaju (`files` zbudowane z nazwy pliku sprzed przetwarzania) — po recenzji doszły dwa testy (film mjpeg, „osobno” mjpeg z normalizacją), które to łapią (sprawdzone przez chwilowe zepsucie kodu). Zmianę w starych testach recenzent uznał za wynikającą z zadania.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): wariant ze znakiem `?` w nazwie prawdziwego pliku wykonuje się tylko poza Windowsem; test `GET` zakłada, że `express.static` czyta przez `fs.stat`/`fs.createReadStream` (po zmianie w Expressie test padnie, nie przejdzie fałszywie); funkcja `loadApp` jest powtórzona w kolejnym pliku testów.

### Uwaga dla właściciela (poza zakresem zadania)

Recenzent znalazł niestabilność niezwiązaną z B2: gdy nie ma folderu `downloads` (świeże sklonowanie, Mac, GitHub), `npm test` czasem pada z `EEXIST ... mkdir downloads`. `app.js` (linie 82-84) robi `existsSync` + `mkdirSync`, a `node --test` wczytuje `app.js` w kilku procesach naraz. U recenzenta padły 3 z 10 przebiegów na kopii bez tego folderu. Poprawka to jedna linia: `fs.mkdirSync(downloadsDir, { recursive: true })` bez wcześniejszego sprawdzania. Nie zrobiłem jej tutaj, bo to zmiana kodu poza zadaniem B2; będzie potrzebna najpóźniej przy G5 (testy na trzech systemach).

### Niesprawdzone

- Film ze znakiem `%` albo `?` w tytule na prawdziwym pobraniu — film testowy ma tylko `#`. `%` sprawdzony na pliku próbnym i w testach; `?` tylko w testach samego adresu (na Windowsie taki plik nie może istnieć).
- Automatyczne pobieranie po kliknięciu „Pobierz” na stronie — strona nie była zmieniana; sprawdzony jest tylko odnośnik z zakodowanym adresem w Edge.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## G3a: Konkretna przyczyna błędu

### Co zmieniono (`app.js`)

- `runProcess` trzyma w pamięci tylko końcówkę stderr: ostatnie 8000 znaków (stała `stderrTailLimit`). Stdout nie jest już zbierany w zmiennej; dalej trafia do konsoli i do logów na stronie, tak samo jak stderr.
- Nowa funkcja `buildProcessErrorMessage(etykieta, końcówkaStderr, kod)`: dzieli tekst na linie (`\n`, `\r\n`, `\r`), obcina spacje, pomija puste linie. Przyczyna to ostatnia linia zaczynająca się od `ERROR:` (yt-dlp), a gdy takiej nie ma — ostatnia niepusta linia (ffmpeg). Wynik: `<etykieta>: <przyczyna>`, np. `YT-DLP AUDIO: [youtube] aaaaaaaaaaa: This video is unavailable`.
- Nowa funkcja `buildMissingProgramMessage(etykieta, program)`: komunikat dla błędu `ENOENT`, np. `YT-DLP AUDIO: nie znaleziono programu "<ścieżka>". Zainstaluj go albo wrzuć do folderu bin (patrz README).`
- Przy kodzie wyjścia ≠ 0 `runProcess` odrzuca obietnicę z komunikatem z `buildProcessErrorMessage`; pole `error` niesie końcówkę stderr. Endpoint `/api/download` nie był zmieniany — komunikat trafia do pola `message` odpowiedzi 500 tak jak wcześniej.
- `runProcess`, obie nowe funkcje i `stderrTailLimit` są w `module.exports` (dla testów).

### Przyjęte założenia

- Samo słowo `ERROR:` jest ucinane z przyczyny (zostaje treść po nim), żeby komunikat nie miał postaci `YT-DLP AUDIO: ERROR: ...`.
- Gdy stderr jest pusty, przyczyna to „program zakończył pracę błędem (kod N).”.
- Gdy ostatnia linia `ERROR:` nie ma treści, brana jest ostatnia niepusta linia.
- Błąd uruchomienia inny niż `ENOENT` (np. brak uprawnień) zostaje przy starym komunikacie „Nie udało się uruchomić <etykieta>.”.
- W komunikacie o braku programu podana jest ścieżka albo nazwa, którą program próbował uruchomić (to, co wskazuje `YTDLP_PATH`/`FFMPEG_PATH`, plik z `bin` albo sama nazwa z PATH).
- Przy sukcesie `runProcess` zwraca `{ errorOutput }` (końcówka stderr) zamiast `{ output, errorOutput }`. Nikt w kodzie nie korzystał z tej wartości.
- README jeszcze nie istnieje (zadanie G2); komunikat już do niego odsyła, bo tak każe zadanie.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 417 testów (391 wcześniejszych + 26 nowych z przedrostkiem „G3a:”, plik `testy/przyczyna-bledu.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Sprawdzenia z zadania na prawdziwym serwerze** (`node app.js`, `POST /api/download`, audio mp3):
  - nieistniejący film (`watch?v=aaaaaaaaaaa`, port 3463): odpowiedź 500, `message` = `YT-DLP AUDIO: [youtube] aaaaaaaaaaa: This video is unavailable`. Pole `error` zawiera końcówkę stderr (ostrzeżenie o starej wersji yt-dlp i linię `ERROR:`).
  - `YTDLP_PATH` ustawione na nieistniejący plik w folderze tymczasowym (port 3464), link do filmu testowego: odpowiedź 500, `message` = `YT-DLP AUDIO: nie znaleziono programu "<ta ścieżka>". Zainstaluj go albo wrzuć do folderu bin (patrz README).`
  - W konsoli serwera nie było nieobsłużonych wyjątków, `downloads` zostało puste, serwery zatrzymane.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez poważnych uwag. Recenzent zepsuł kod na kopii na 30 sposobów; testy wykryły 27. Niewykryte: limit 7999 zamiast 8000 (test celowo dopuszcza „około 8000”), brak `return` po odrzuceniu w gałęzi `ENOENT` (zachowanie identyczne), a brak wysyłania stderr do logów strony zawieszał test zamiast go wywrócić — po recenzji ten test dostał limit czasu 15 s.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): brak testu przez `/api/download` dla drugiego wywołania trybu „osobno” (`YT-DLP AUDIO ONLY`) i dla błędu ffmpeg z dokładnym komunikatem (oba przypadki są sprawdzone na `runProcess`); utrwalony przypadek pustej linii `ERROR:` po wcześniejszej linii `ERROR:` (yt-dlp tak nie wypisuje); funkcja `loadApp` powtórzona w kolejnym pliku testów.

### Uwaga dla właściciela (poza zakresem zadania)

yt-dlp na tym komputerze (2026.03.17) wypisuje przy każdym uruchomieniu ostrzeżenie, że wersja ma ponad 90 dni. Nie wpływa to na komunikat błędu (brana jest linia `ERROR:`), ale warto zaktualizować program (`yt-dlp -U` albo `winget upgrade yt-dlp.yt-dlp`).

### Niesprawdzone

- Prawdziwy błąd ffmpeg w odpowiedzi serwera (np. uszkodzony plik) — tylko testy z atrapą i z procesem Node udającym ffmpeg.
- Inne prawdziwe przyczyny z yt-dlp (film prywatny, ograniczenie wieku, blokada regionalna) — sprawdzony tylko film nieistniejący.
- `FFMPEG_PATH` ustawione na nieistniejący plik na prawdziwym serwerze — ta sama gałąź kodu co dla yt-dlp, sprawdzona tylko dla yt-dlp.
- Wyświetlanie komunikatu na stronie — strona nie była zmieniana (pole statusu to zadanie U1).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## G3b + G4: Start programu

### Co zmieniono (`app.js`)

- Nowa stała `HOST = process.env.HOST || "127.0.0.1"`. Program nasłuchuje tylko na tym adresie, czyli domyślnie jest dostępny wyłącznie z tego komputera. `HOST=0.0.0.0` otwiera go na sieć domową.
- Nowa funkcja `startServer(port = PORT, host = HOST)`: woła `app.listen(port, host)` i zwraca serwer.
  - Po starcie wypisuje `Pobierak dziala. Otworz w przegladarce: http://localhost:<port>` (zamiast „slucham na porcie”), a potem sprawdza programy.
  - Błąd `EADDRINUSE`: wypisuje jedno zdanie (`buildPortInUseMessage`) — port jest zajęty, pewnie program już działa w innym oknie, zamknij je albo ustaw inny port zmienną `PORT`. Bez śladu stosu, kod wyjścia 1.
  - Inny błąd nasłuchu (np. zły adres w `HOST`): jedno zdanie z treścią błędu, kod wyjścia 1.
- Sprawdzenie programów przy starcie (`reportPrograms`): uruchamia `yt-dlp --version` i `ffmpeg -version` (te same ścieżki, których program używa do pobierania: `YTDLP_PATH`/`FFMPEG_PATH`, folder `bin`, PATH) i wypisuje:
  - `yt-dlp: wersja 2026.03.17`, `ffmpeg: wersja N-124279-...` — gdy program działa;
  - `BRAK PROGRAMU yt-dlp: nie znaleziono "<ścieżka>". Bez niego pobieranie nie zadziala.` i w następnej linii podpowiedź instalacji — gdy pliku nie ma;
  - `PROGRAM yt-dlp NIE DZIALA: nie udalo sie uruchomic "<ścieżka>" (<przyczyna>). ...` i podpowiedź — gdy plik jest, ale nie da się go uruchomić albo kończy się błędem.
  - Brak programu nie zatrzymuje serwera.
- Podpowiedź instalacji (`buildInstallHint`) zależy od `process.platform`: `win32` → `winget install yt-dlp.yt-dlp`, `darwin` → `brew install yt-dlp ffmpeg`, pozostałe → menedżer pakietów systemu (np. apt, dnf, pacman). Każda odsyła do README. To drugie (i ostatnie dozwolone) rozgałęzienie po systemie w `app.js`.
- Funkcje pomocnicze: `extractVersion` (pierwsza niepusta linia wyjścia; z linii `ffmpeg version <numer> Copyright ...` zostaje sam numer), `checkProgramVersion` (uruchamia program, nigdy nie rzuca błędu), `buildProgramReport` (linie do wypisania).
- Zegar sprzątania `downloads` dostał `.unref()`: działa jak dotąd, dopóki działa serwer, ale sam nie trzyma programu przy życiu. Dzięki temu przy zajętym porcie program kończy się sam, bez `process.exit` (które mogłoby uciąć niewypisany tekst).
- `HOST`, `PORT` i nowe funkcje są w `module.exports` (dla testów).

### Przyjęte założenia

- Komunikaty startowe są bez polskich znaków, tak jak dotychczasowe wpisy w konsoli („Usunieto stary plik”) — konsola Windowsa potrafi je zniekształcić.
- Zdanie o zajętym porcie nie podaje gotowej komendy, tylko nazwę zmiennej i przykład wartości (`PORT=3001`), bo składnia ustawiania zmiennej różni się między systemami, a zadanie pozwala na rozgałęzienie po systemie tylko w podpowiedzi instalacji. Dokładne komendy mają trafić do README (G2).
- Podpowiedź instalacji jest jedna na system (tak ją opisuje zadanie), nie osobna dla każdego programu. Na Windowsie jedna komenda wystarcza: pakiet `yt-dlp.yt-dlp` ma w zależnościach `yt-dlp.FFmpeg` i `DenoLand.Deno` (sprawdzone `winget show --id yt-dlp.yt-dlp -e`, wersja pakietu 2026.10.26), i podpowiedź to mówi.
- Programy są sprawdzane dopiero po udanym starcie nasłuchu. Drugi egzemplarz na zajętym porcie wypisuje tylko zdanie o porcie.
- Wypisywany adres to zawsze `http://localhost:<port>`, także przy `HOST=0.0.0.0` (zadanie każe wypisać ten adres).
- Program, który jest, ale kończy sprawdzenie wersji błędem, dostaje osobny komunikat („nie dziala”) z tą samą podpowiedzią.
- README jeszcze nie istnieje (zadanie G2); komunikaty już do niego odsyłają, bo tak każe zadanie.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 459 testów (417 wcześniejszych + 42 nowe z przedrostkiem „G3b+G4:”, plik `testy/start.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Sprawdzenia z zadania na prawdziwym programie** (`node app.js`, prawdziwe yt-dlp i ffmpeg z PATH):
  - normalny start (port 3471): w konsoli `Pobierak dziala. Otworz w przegladarce: http://localhost:3471`, `yt-dlp: wersja 2026.03.17`, `ffmpeg: wersja N-124279-g0f6ba39122-20260430`; `GET /` zwraca 200.
  - drugi egzemplarz na tym samym porcie: jedno zdanie `Port 3471 jest zajety - pewnie program juz dziala w innym oknie. Zamknij tamto okno albo ustaw inny port w zmiennej srodowiskowej PORT (np. PORT=3001) i uruchom program jeszcze raz. Szczegoly w README.`, bez śladu stosu, kod wyjścia 1, program kończy się sam; pierwszy egzemplarz działa dalej (200).
  - start z `YTDLP_PATH` wskazującym nieistniejący plik (port 3472): `BRAK PROGRAMU yt-dlp: nie znaleziono "<ta ścieżka>". Bez niego pobieranie nie zadziala.`, pod spodem `Jak zainstalowac: winget install yt-dlp.yt-dlp (ten pakiet doinstalowuje tez ffmpeg). Szczegoly w README.`, wersja ffmpeg wypisana normalnie; serwer działa (`GET /` → 200).
  - G4: przy domyślnym `HOST` połączenie przez adres komputera w sieci lokalnej jest odrzucane, przez `127.0.0.1` i `localhost` działa. Z `HOST=0.0.0.0` (port 3473) połączenie przez adres sieciowy zwraca 200.
  - Wszystkie serwery zatrzymane, porty wolne.
- Recenzja testów przez agenta `recenzent-testow`: dwie rundy, zaakceptowane w drugiej.
  - Runda 1: recenzent zepsuł kod na kopii na 26 sposobów, testy wykryły 24; błędnych oczekiwań nie znalazł. Jedna uwaga poważna: testy uruchamiały `node app.js` z folderu projektu, więc startowe sprzątanie kasowało stare pliki z prawdziwego `downloads`. Poprawione — testy uruchamiają kopię w folderze tymczasowym (opis w sekcji „Testy”). Przy okazji doszły dwa drobne uzupełnienia, które łapią oba niewykryte błędy (brak obu programów daje dwie informacje; tekst na stderr nie jest wersją).
  - Runda 2: plik próbny sprzed 3 godzin w prawdziwym `downloads` przeżył 6 uruchomień testów, w folderze tymczasowym nic nie zostaje; 7 z 7 celowych błędów w bloku startowym i `startServer` wykrytych (m.in. brak `.unref()`, brak `startServer()`, nasłuch na `0.0.0.0`).
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): wolny port jest wybierany chwilę przed startem programu (teoretycznie ktoś może go zająć); gałąź „inny błąd nasłuchu niż zajęty port” nie ma testu; test adresu sieciowego pomija się na komputerze bez sieci; gdyby kopiowanie `public` w teście się nie udało, folder tymczasowy by został.

### Niesprawdzone

- Inny błąd nasłuchu niż zajęty port (np. `HOST` z adresem, którego komputer nie ma) — kod jest, nie był uruchamiany.
- Komunikat „PROGRAM ... NIE DZIALA” na prawdziwym, uszkodzonym yt-dlp albo ffmpeg — tylko testy z atrapą i z Node podstawionym za program.
- Program z `HOST=0.0.0.0` otwierany z innego urządzenia w sieci (telefon) — sprawdzone tylko połączenie z tego samego komputera przez jego adres sieciowy.
- Sama komenda `winget install yt-dlp.yt-dlp` nie była uruchamiana (programy są już zainstalowane); sprawdzone tylko `winget show`.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane. Podpowiedzi `brew` i „menedżer pakietów” są sprawdzone tylko testami treści (start na Macu z błędnym `YTDLP_PATH` jest w zadaniu K2).

## B1: Przycisk nie blokuje się po błędzie walidacji

### Co zmieniono (`public/script.js`)

- W `handleDownloadSubmit` blok walidacji przycinania (`validateTrim()`, wpis błędu przez `addLog`, `return`) stoi teraz zaraz po `event.preventDefault()`, nad trzema liniami, które wyłączają przycisk, pokazują kółko ładowania i zmieniają napis na „Pobieram...”.
- Wcześniej przycisk był blokowany przed walidacją, a `return` po błędzie omijał blok `finally`, który go odblokowuje. Po kliknięciu z błędnym czasem (np. start `2:00`, koniec `1:00`) przycisk zostawał wyłączony z napisem „Pobieram...” aż do odświeżenia strony.
- Reszta funkcji bez zmian.

### Przyjęte założenia

- Brak. Zmiana jest dokładnie taka, jak w zadaniu.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 469 testów (459 wcześniejszych + 10 nowych z przedrostkiem „B1:”, plik `testy/przycisk.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Sprawdzenie z zadania w przeglądarce** (Edge przez `playwright-core`, `npm run test:przegladarka`: 7 sprawdzeń, wszystkie przechodzą, w tym 2 nowe z `testy/przegladarka/przycisk.przegladarka.js`): start `2:00`, koniec `1:00`, klik „Pobierz” → przycisk aktywny, napis „Pobierz”, kółko ładowania ukryte, przycisk nie zmienił stanu ani razu; pod polami i w tle strony komunikat „Początek musi być mniejszy niż koniec.”; żądanie do `/api/download` nie wyszło. Po poprawieniu końca na `3:00` drugi klik wysyła żądanie. Przy poprawnym czasie przycisk jest zablokowany z napisem „Pobieram...” do odpowiedzi serwera i potem wraca do „Pobierz”.
- Nowe testy uruchomione na kodzie sprzed zmiany: 7 z 10 testów w `testy/przycisk.test.js` i 1 z 2 sprawdzeń w przeglądarce nie przechodzi, czyli testy wykrywają naprawiany błąd.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez uwag poważnych. Recenzent zepsuł kod na kopii na 10 sposobów; `testy/przycisk.test.js` wykrył 10, sprawdzenie w przeglądarce 9 (niewykryty dotyczył `validateTrim`, nie kodu z tego zadania). Oczekiwane komunikaty przeliczył sam.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): atrapa `getExperimentalOptions` w teście zwraca czasy z chwili budowy strony (treść drugiego żądania sprawdza test w przeglądarce); wycinanie funkcji z `script.js` zakłada klamrę zamykającą na początku linii; stałe czekanie 300 ms w sprawdzeniu przeglądarkowym.

### Uwaga dla właściciela (poza zakresem zadania)

- Recenzent zgłosił, że pierwsze uruchomienie `npm test` w świeżej kopii projektu w folderze tymczasowym raz zakończyło się błędem w trzech plikach spoza tego zadania (`przycinanie.test.js`, `przyczyna-bledu.test.js`, `rozszerzenie-mjpeg.test.js`); dwa kolejne uruchomienia przeszły. Komunikatu nie zachował, przyczyna nieznana. W folderze projektu `npm test` przeszedł w każdym uruchomieniu tego zadania (3 razy).

### Niesprawdzone

- Kliknięcie ręką w zwykłym oknie przeglądarki — sprawdzenie zrobił skrypt w Edge bez okna (headless).
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B9: Logi przez `textContent`

### Co zmieniono (`public/script.js`)

- `addLog` nie używa już `innerHTML`. Tworzy `span`, wpisuje do niego `[typ]` przez `textContent`, dokłada go do wiersza `p`, a potem dopisuje węzeł tekstowy ze spacją i treścią (`document.createTextNode`).
- Wcześniej typ i treść były wklejane do wiersza jako HTML. Tekst z logów yt-dlp i ffmpeg albo z odpowiedzi serwera, który zawierał znaczniki (np. `<img src=x onerror=...>`), stawał się elementami strony i mógł wykonać kod.
- Budowa zwykłego wiersza jest taka sama jak przedtem (`<span>[typ]</span> treść`), więc reguły CSS tła (`.background-terminal-body p` i `span`) działają bez zmian. `trimLogs`, limit 42 wierszy i przewijanie na dół bez zmian.

### Przyjęte założenia

- Typ logu też jest wstawiany jako tekst (zadanie mówi o `span` „z tekstem `[typ]`”). Typ przychodzi z backendu razem z treścią.
- Jedyna różnica w tym, co widać: tekst, który wcześniej przeglądarka traktowała jak HTML, jest teraz pokazywany dosłownie. Dotyczy to też encji — log z tekstem `&amp;` pokazuje `&amp;`, a nie `&`. To jest cel zadania.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 484 testy (469 wcześniejszych + 15 nowych z przedrostkiem „B9:”, plik `testy/wpis-logu.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Sprawdzenie z zadania w przeglądarce** (Edge przez `playwright-core`, `npm run test:przegladarka`: 10 sprawdzeń, w tym 3 nowe z `testy/przegladarka/wpis-logu.przegladarka.js`): `addLog("test", "<b>x</b> & <img src=x>")` daje wiersz z tekstem `[test] <b>x</b> & <img src=x>`, w tle nie powstaje element `<b>` ani `<img>`, strona nie wysyła żądania po obrazek. Log wysłany z backendu ze `<script>` i `<img onerror>` w treści i znacznikiem w typie jest pokazany dosłownie, kod się nie wykonuje.
- **Wygląd pozostałych linii:** cztery zwykłe linie (krótka, postęp yt-dlp z wieloma spacjami, polskie znaki, bardzo długa łamiąca się na kilka wierszy) porównane na stronie z wierszem zbudowanym dawnym `innerHTML` — identyczny zapis HTML, szerokość, wysokość, położenie i rozmiar spana, kolory, marginesy i czcionka. Dwie linie dodawane przy starcie strony mają zapis HTML jak wcześniej.
- Nowe testy uruchomione na kodzie sprzed zmiany: 15 z 15 w `testy/wpis-logu.test.js` i 2 z 3 sprawdzeń w przeglądarce nie przechodzi (trzecie porównuje wygląd zwykłych linii, który się nie zmienił), czyli testy wykrywają naprawiany błąd.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez uwag poważnych. Recenzent zepsuł kod na kopii na 13 sposobów; oba pliki razem wykryły 13, sam `npm test` 11. Oczekiwane wartości przeliczył sam.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): atrapa w `testy/wpis-logu.test.js` nie widzi klasy ani stylu dopisanego do spana (łapie to tylko sprawdzenie w przeglądarce) i zna tylko `appendChild`/`createTextNode` (kod przepisany na `line.append(...)` wymaga rozszerzenia atrapy); serwer w sprawdzeniu przeglądarkowym startuje przed `try` (tak samo jak w starszych plikach); stałe czekanie 300 ms; brak próbki ze spacjami na początku treści w porównaniu wyglądu.
- **Po każdej zmianie `addLog` trzeba uruchomić także `npm run test:przegladarka`** — zmiany wyglądu spana (klasa, styl) wykrywa tylko ono.

### Uwaga dla właściciela (poza zakresem zadania)

- Istniejące sprawdzenie B12 w `testy/przegladarka/odtwarzanie.przegladarka.js` raz na pięć przebiegów `npm run test:przegladarka` nie przeszło: „odtwarzanie po przewinieciu przesunelo czas o 0.2999999999999998” przy progu 0,3 s. To wynik na samej granicy progu (zaokrąglenie liczby), nie błąd odtwarzania; cztery pozostałe przebiegi przeszły 10 z 10. Testu nie zmieniałem (zasada: bez zmian w istniejących testach bez zgłoszenia). Propozycja: obniżyć próg do 0,25 s.

### Niesprawdzone

- Wpisanie `addLog(...)` ręką w konsoli zwykłego okna przeglądarki — to samo wywołanie zrobił skrypt w Edge bez okna (headless).
- Wygląd „na oko”: nie robiłem zrzutu ekranu; porównanie jest liczbowe (wymiary i style wiersza nowego i dawnego).
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B13b: Usunięcie martwej walidacji długości

### Co zmieniono (`public/script.js`)

- Usunięta zmienna `videoDurationSeconds` (deklaracja `let videoDurationSeconds = null;` na górze pliku).
- Z `validateTrim` usunięty ostatni warunek, który z niej korzystał (komunikat „Koniec nie może być większy niż długość filmu.”).
- Zmienna nigdy nie dostawała wartości (strona nie pyta o długość filmu), więc warunek nigdy się nie wykonywał. Zachowanie strony jest takie samo jak przed zmianą. Pozostałe warunki `validateTrim` i ich komunikaty bez zmian.

### Przyjęte założenia

- Brak. Zmiana jest dokładnie taka, jak w zadaniu.
- Koniec przycięcia dalej nie ma górnego limitu po stronie strony (tak jak dotąd). Koniec dalszy niż długość filmu obsługuje dopiero pobieranie.

### Sprawdzone (Windows 11, 2026-11-14)

- **Sprawdzenie z zadania:** w `public/script.js` nie ma żadnego wystąpienia `videoDurationSeconds` (test oraz wyszukiwanie w pliku).
- `npm test`: 517 testów (484 wcześniejsze + 33 nowe z przedrostkiem „B13b:”, plik `testy/walidacja-przyciecia.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Walidacja działa jak wcześniej:** `validateTrim` uruchomione na atrapie strony, w której zmiennej `videoDurationSeconds` nie ma (zostawione odwołanie dałoby `ReferenceError`): 16 poprawnych ustawień przechodzi bez komunikatu (w tym bardzo dalekie końce, np. `99:59:59`), 12 błędnych daje te same komunikaty co dotąd, poprawne przycięcie kasuje wcześniejszy błąd.
- W przeglądarce (Edge przez `playwright-core`, `npm run test:przegladarka`: 13 sprawdzeń, w tym 3 nowe z `testy/przegladarka/walidacja-przyciecia.przegladarka.js`): strona wczytuje się bez błędów skryptu, zmiennej nie ma, pola „Przytnij” pokazują te same komunikaty, klik „Pobierz” z błędnym czasem nie wysyła żądania, a z poprawnym (koniec `99:59:59`) wysyła.
- Nowe testy uruchomione na kodzie sprzed zmiany: 20 z 33 w `testy/walidacja-przyciecia.test.js` i 1 z 3 sprawdzeń w przeglądarce nie przechodzi.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez uwag poważnych. Recenzent zepsuł kod na kopii na 15 sposobów; `npm test` wykrył 14 (niewykryte: usunięcie warunku „początek mniejszy od zera”, który jest nieosiągalny — patrz uwaga niżej), sprawdzenie w przeglądarce 5 z 5. Oczekiwane wyniki przeliczył sam.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): lista dozwolonych nazw w teście `validateTrim` wymaga dopisania nazwy przy każdej przyszłej zmianie tej funkcji; wycinanie funkcji zakłada klamrę zamykającą na początku linii; przy zepsutym kodzie sprawdzenie w przeglądarce czeka 30 s.

### Uwaga dla właściciela (poza zakresem zadania)

- W `testy/przycisk.test.js` (zadanie B1) atrapa strony ma nadal pole `videoDurationSeconds: null`. Jest teraz nieużywane i nieszkodliwe; nie usuwałem go, bo istniejących testów nie zmienia się bez zgłoszenia. Propozycja: usunąć tę jedną linię.
- W `validateTrim` zostały dwa warunki „Początek/Koniec nie może być mniejszy od zera.”. Od zadania B13c są nieosiągalne (`parseTimeToSeconds` odrzuca minus jako błąd formatu). Zadanie ich nie obejmuje, więc zostały.

### Niesprawdzone

- Wpisywanie czasów ręką w zwykłym oknie przeglądarki — sprawdzenie zrobił skrypt w Edge bez okna (headless).
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## B13d: Jeden komunikat o utracie połączenia

### Co zmieniono (`public/script.js`)

- Nowa zmienna `backendLogsLost` (flaga, na początku `false`) obok obsługi `backendLogs`.
- `backendLogs.onerror`: gdy flaga jest ustawiona, nic nie robi; w przeciwnym razie ustawia flagę i dodaje wpis `[error] Utracono połączenie z logami backendu.`.
- Nowe `backendLogs.onopen`: zeruje flagę. Wcześniej strona nie miała obsługi `onopen`.
- Przyczyna błędu: przeglądarka sama ponawia połączenie z `/api/logs` co ok. 3 sekundy i każda nieudana próba wywołuje `onerror`, więc przy wyłączonym serwerze ta sama linia dochodziła co kilka sekund i wypychała z tła wcześniejsze logi.
- Wygląd i działanie tła z logami bez zmian; zmienia się tylko liczba powtórzeń tej jednej linii.

### Przyjęte założenia

- Flagę zeruje tylko `onopen` (tak jak w zadaniu), nie odebrana wiadomość.
- Ponowne połączenie nie dostaje osobnego komunikatu ze strony: backend sam wysyła wtedy „Połączono z logami backendu.”, i ta linia pojawia się w tle.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 526 testów (517 wcześniejszych + 9 nowych z przedrostkiem „B13d:”, plik `testy/utrata-polaczenia.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- **Sprawdzenie z zadania**, w przeglądarce (Edge przez `playwright-core`, `npm run test:przegladarka`: 14 sprawdzeń, w tym 1 nowe z `testy/przegladarka/utrata-polaczenia.przegladarka.js`): po zatrzymaniu serwera przeglądarka ponowiła połączenie co najmniej 3 razy, a w tle była jedna linia `[error] Utracono połączenie z logami backendu.`; po starcie serwera na tym samym porcie strona sama połączyła się ponownie, pokazała drugie „Połączono z logami backendu.” i linię wysłaną przez backend; drugie zatrzymanie serwera dało dokładnie jedną nową linię o utracie.
- Nowe testy uruchomione na kodzie sprzed zmiany: 7 z 9 w `testy/utrata-polaczenia.test.js` i sprawdzenie w przeglądarce nie przechodzą (w przeglądarce: więcej niż jedna linia o utracie).
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez uwag poważnych. Recenzent zepsuł kod na kopii na 7 sposobów; `npm test` wykrył 6, sprawdzenie w przeglądarce wykryło siódmy (flaga zerowana zegarem po 4 s zamiast przez `onopen`). Oczekiwane wyniki przeliczył sam.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): atrapa w `npm test` nie ma zegara, więc błąd oparty na czasie łapie tylko sprawdzenie w przeglądarce; test „wiadomość nie zeruje flagi” pilnuje szczegółu, którego użytkownik nie widzi; atrapa zna tylko zapis `backendLogs.onopen = ...`, nie `addEventListener`; sprawdzenie w przeglądarce startuje serwer ponownie na tym samym porcie, więc padnie, jeśli w kilkanaście sekund przerwy inny program zajmie ten port.

### Niesprawdzone

- Zatrzymanie i start `node app.js` ręką przy zwykłym oknie przeglądarki — sprawdzenie zrobił skrypt w Edge bez okna (headless), zatrzymując i uruchamiając serwer programu w tym samym procesie co test.
- Dłuższa przerwa niż kilkanaście sekund (np. serwer wyłączony na godzinę).
- Inne przeglądarki niż Edge (Firefox, Safari); odstęp między ponowieniami połączenia zależy od przeglądarki.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## U1 + U3 + U4: Pole statusu pod przyciskiem

### Co zmieniono

- `public/index.html`: w formularzu, zaraz pod przyciskiem „Pobierz”, nowy `<div id="statusBox" class="status-box hidden" aria-live="polite">`. Jest pusty i ukryty (klasa `hidden`, ta sama co przy kółku ładowania).
- `public/script.js`, trzy nowe funkcje:
  - `clearStatus()` — usuwa treść pola, zdejmuje klasy `is-error` i `is-success`, chowa pole.
  - `showStatusError(message)` — czyści pole, wstawia komunikat (akapit `p`), dodaje `is-error`, pokazuje pole.
  - `showStatusSuccess(files)` — czyści pole, wstawia „Gotowe” i po jednym linku `a` dla każdego elementu `files` (tekst = `name`, `href` = `url`, atrybut `download`), dodaje `is-success`, pokazuje pole.
  - Wszystko jest wstawiane przez `textContent` i właściwości elementu, bez `innerHTML`.
- `public/script.js`, `handleDownloadSubmit`:
  - błąd walidacji przycinania trafia też do pola statusu (obok wpisu w tle i komunikatu pod polami „Przytnij”);
  - po udanej walidacji, przed zablokowaniem przycisku, pole jest czyszczone;
  - błąd serwera: `result.message` (albo „Backend zwrócił błąd.”) w polu i w tle;
  - sukces: „Gotowe” z linkami z `result.files`. Automatyczne pobieranie (klikanie tymczasowych linków, drugi plik po 700 ms) zostało bez zmian;
  - **U4:** `fetch` ma własny `try/catch` — tylko jego błąd daje „Nie udało się połączyć z backendem.”. Gdy `response.json()` rzuci wyjątek, komunikat to „Serwer zwrócił nieoczekiwaną odpowiedź (HTTP <kod>).”. Oba komunikaty idą do pola i do tła. Dawny wspólny `catch` wokół całej funkcji zniknął; `finally`, który odblokowuje przycisk, został.
- `public/style.css`: reguły `.status-box` (ciemne tło jak przyciski wyboru, zaokrąglenie 14 px, grubsza lewa krawędź, `overflow-wrap: anywhere`), `.status-box p`, `.status-box a` (każdy link w osobnym wierszu), `.status-box.is-error` (czerwona obwódka, jasnoczerwony tekst), `.status-box.is-success` (fioletowa obwódka z niebieską poświatą). Reguły tła z logami nie były ruszane.

### Przyjęte założenia

- Atrybut `download` linku ma wartość równą nazwie pliku (`name` z odpowiedzi), żeby plik zapisał się pod tą nazwą.
- Odpowiedź sukcesu bez tablicy `files` (albo z pustą) pokazuje samo „Gotowe”, bez linków.
- Poprawny JSON, który nie jest obiektem (`null`, napis, liczba), jest traktowany tak samo jak odpowiedź, której nie da się odczytać: „Serwer zwrócił nieoczekiwaną odpowiedź (HTTP <kod>).”. Bez tego strona kończyłaby się wyjątkiem bez żadnego komunikatu.
- Komunikaty błędów trafiają jednocześnie do pola i do tła z logami — tło działa jak dotąd.
- Pole jest ukrywane klasą `hidden` (`display: none`), zgodnie z „domyślnie ukryty”.
- Błąd w polu zostaje do następnego kliknięcia „Pobierz”; samo poprawienie czasu w polach „Przytnij” go nie zdejmuje.

### Zmiana w istniejących testach (zgłoszenie)

- `testy/przycisk.test.js` (zadanie B1): do atrapy strony dopisane trzy puste funkcje `clearStatus`, `showStatusError`, `showStatusSuccess`. `handleDownloadSubmit` teraz je woła, więc bez nich test kończyłby się błędem „funkcja nie istnieje”. Żadna asercja nie została zmieniona ani usunięta. Recenzent ocenił zmianę jako uzasadnioną i nieosłabiającą testu.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 556 testów (526 wcześniejszych + 30 nowych z przedrostkami „U1:”, „U3:”, „U4:”, plik `testy/pole-statusu.test.js`), wszystkie przechodzą, żaden nie jest pomijany.
- W przeglądarce (Edge przez `playwright-core`, `npm run test:przegladarka`: 24 sprawdzenia, w tym 10 nowych z `testy/przegladarka/pole-statusu.przegladarka.js`), z podstawionymi odpowiedziami serwera: zły link → błąd pod przyciskiem; udane pobranie → „Gotowe” z linkiem, który zwraca plik i po kliknięciu go pobiera; tryb „osobno” → dwa linki; długa nazwa się łamie, karta ma tę samą szerokość; odpowiedź HTML z kodem 502 → „Serwer zwrócił nieoczekiwaną odpowiedź (HTTP 502).”; zerwane połączenie → „Nie udało się połączyć z backendem.”; tło z logami ma to samo położenie, kolory i czcionkę przy ukrytym polu, przy błędzie i przy sukcesie.
- **Sprawdzenie z zadania na prawdziwym serwerze i prawdziwym yt-dlp** (jednorazowy skrypt w Edge, film z `ZADANIA.md`):
  - nieistniejący film → w polu `YT-DLP AUDIO: [youtube] aaaaaaaaaaa: This video is unavailable`, klasa `is-error`, bez linków;
  - audio mp3 → „Gotowe”, jeden link `the #1 NO SCOPE player in rivals [...].mp3`, adres z linku zwraca 200 i 898 413 bajtów, automatyczne pobranie ruszyło;
  - tryb „osobno”, mp4, rozdzielczość „best” → „Gotowe”, dwa linki (wideo 21 143 303 bajty, audio 898 413 bajtów), oba adresy zwracają 200, oba automatyczne pobrania ruszyły.
  - Pobrane pliki zostały po sprawdzeniu usunięte z `downloads`.
- Nowe testy uruchomione na kodzie sprzed zmiany (pierwsza wersja, 24 testy): 23 z 24 w `testy/pole-statusu.test.js` i 10 z 10 sprawdzeń w przeglądarce nie przechodzi.
- Recenzja testów przez agenta `recenzent-testow`: dwie rundy.
  - Runda 1: nie zaakceptowane, jedna uwaga poważna — brak testu dla błędu walidacji przycinania w chwili, gdy pole już pokazuje wynik poprzedniego pobrania. Recenzent zepsuł kod na kopii na 12 sposobów, testy wykryły 9.
  - Poprawki: dwa testy „błąd walidacji po udanym pobraniu / po błędzie serwera” i krok w sprawdzeniu przeglądarkowym; przy okazji trzy testy JSON-u niebędącego obiektem, test pustej tablicy `files` i porównanie wartości atrybutu `download` z nazwą pliku.
  - Runda 2: zaakceptowane bez uwag poważnych, 8 z 8 zepsuć wykrytych.
- Drobne uwagi recenzenta zostały bez poprawek (zasada 2a): odpowiedź serwera będąca tablicą (`[]`) pokaże „Gotowe” bez linków; element `files` bez `name` albo `url` nie ma testu (serwer takich nie wysyła); styl w `npm test` jest sprawdzany tylko wzorcem tekstu, prawdziwe kolory i łamanie nazw sprawdza przeglądarka; długi komunikat błędu bez spacji nie ma osobnego sprawdzenia (jest długa nazwa pliku).
- **Po każdej zmianie `.status-box` w `style.css` trzeba uruchomić także `npm run test:przegladarka`.**

### Do obejrzenia przez właściciela

Zrzuty ekranu w `F:\Claude\PobierakRemaster\logi-petli\zrzuty\` (strona 1280×900, Edge):

- `U1-blad.png`, `U1-prawdziwy-zly-link.png` — błąd pod przyciskiem (czerwona obwódka).
- `U1-gotowe.png` — „Gotowe” z jednym linkiem.
- `U3-osobno-dwa-linki.png`, `U3-prawdziwe-osobno.png` — dwa linki w trybie „osobno”.
- `U1-dluga-nazwa.png` — długa nazwa pliku złamana na kilka wierszy.
- `U4-nie-json.png` — komunikat z kodem HTTP.

Do oceny „na oko”: czy kolory i wielkość pola pasują do karty.

### Uwaga dla właściciela (poza zakresem zadania)

- Lista „Rozdzielczość” ma domyślnie zaznaczone 144p. Dla pionowego filmu z `ZADANIA.md` (shorts) tryb „osobno” przy 144p kończy się błędem yt-dlp „Requested format is not available” (filtr `height<=144` nie pasuje do żadnego formatu tego filmu). Przy „best” działa. Pole statusu pokazuje ten błąd poprawnie. Zwykłego filmu z dźwiękiem przy 144p nie sprawdzałem. Propozycja na osobne zadanie: domyślnie „Best” albo zapasowy wybór formatu bez limitu wysokości.
- Sprawdzenie B12 w `testy/przegladarka/odtwarzanie.przegladarka.js` raz nie przeszło (1 przebieg na 4 w tym zadaniu), pozostałe przeszły. Komunikatu z tego przebiegu nie zapisałem; taka sama niestabilność (próg 0,3 s) jest opisana przy zadaniu B9. Testu nie zmieniałem.

### Niesprawdzone

- Klikanie ręką w zwykłym oknie przeglądarki — wszystko zrobił skrypt w Edge bez okna (headless).
- Zachowanie przeglądarki, która wstrzymuje drugie automatyczne pobranie (pytanie o zgodę na kilka plików) — w Edge bez okna oba pobrania ruszyły same. Linki w polu działają niezależnie od tego.
- Czytnik ekranu: czy komunikat z pola `aria-live` jest odczytywany, gdy pole jest jednocześnie odkrywane i wypełniane.
- Wąski ekran (telefon) — sprawdzane tylko okno 1280×900.
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## U2: Postęp na przycisku

### Co zmieniono (`public/script.js`)

- Nowa zmienna `isDownloading` (flaga, na początku `false`) obok obsługi `backendLogs`.
- Nowa funkcja `updateButtonProgress(type, line)`. Gdy flaga nie jest ustawiona, nic nie robi. Gdy typ logu zaczyna się od `FFMPEG` (`FFMPEG`, `FFMPEG VIDEO ONLY`), ustawia napis „Przetwarzam...”. W przeciwnym razie szuka w linii `\[download\]\s+([\d.]+)%` i ustawia „Pobieram... NN%”, z liczbą zaokrągloną w dół.
- `backendLogs.onmessage` woła tę funkcję dla każdej linii, zaraz po `addLog`. Linie trafiają do tła tak jak dotąd.
- `handleDownloadSubmit` ustawia flagę zaraz po zablokowaniu przycisku (czyli po udanej walidacji przycinania) i zeruje ją w `finally`, tuż przed przywróceniem napisu „Pobierz”. Linie, które dojdą po zakończeniu, napisu już nie zmieniają.
- Wygląd przycisku i tła z logami bez zmian; zmienia się tylko tekst na przycisku.

### Przyjęte założenia

- Typ logu jest sprawdzany przed procentem: linia ffmpeg nigdy nie daje procentu.
- Procent bierze się z każdej linii z `[download] NN%`, niezależnie od etykiety yt-dlp. Przy filmie yt-dlp pobiera osobno obraz i dźwięk, a w trybie „osobno” program uruchamia go dwa razy, więc procent dochodzi do 100, wraca do 0 i rośnie drugi raz. Zadanie nie każe tego łączyć w jeden pasek, więc zostało tak.
- Zapis, który nie jest liczbą (np. `1.2.3%`), jest pomijany.
- Gdyby po linii ffmpeg przyszła jeszcze linia z procentem, napis wróci do „Pobieram... NN%”. Program najpierw kończy pobieranie, potem przetwarza, więc w praktyce to się nie zdarza.

### Rozbieżność z linią „Sprawdzenie” (przycinanie)

Zadanie oczekuje, że przy przycinaniu zostanie samo „Pobieram...”, bo yt-dlp przy pobieraniu wycinka nie podaje procentów. To założenie pochodzi z głównego wariantu B11 (`--download-sections`). W B11 został jednak plan awaryjny: yt-dlp pobiera cały film, a tnie ffmpeg. Dlatego **przy przycinaniu procent rośnie normalnie, a potem pojawia się „Przetwarzam...”** — tak jak przy efektach. To zachowanie jest zgodne z częścią „Zrób” i z tym, co program naprawdę robi. Sama reguła „brak linii z procentem = zostaje »Pobieram...«” działa i ma testy.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 577 testów (556 wcześniejszych + 21 nowych z przedrostkiem „U2:”, plik `testy/postep-przycisku.test.js`), wszystkie przechodzą, żaden nie jest pomijany. Istniejące testy bez zmian.
- W przeglądarce (Edge przez `playwright-core`, `npm run test:przegladarka`: 27 sprawdzeń, w tym 3 nowe z `testy/przegladarka/postep-przycisku.przegladarka.js`): linie wysyłane przez prawdziwy serwer programu zmieniają napis przycisku w kolejności „Pobieram...” → procent → „Przetwarzam...” → „Pobierz”.
- **Sprawdzenie z zadania na prawdziwym serwerze i prawdziwym yt-dlp** (jednorazowy skrypt w Edge, film z `ZADANIA.md`; zapisany każdy napis, jaki pojawił się na przycisku):
  - film mp4 „best”, bez przycinania i efektów: „Pobieram...”, 0%, 1%, 2%, 5%, 9%, 19%, 39%, … 100% (obraz), potem 0%, 1%, … 100% (dźwięk), „Pobierz”;
  - audio mp3, bez przycinania i efektów: „Pobieram...”, 0%, 1%, 2%, 5%, 11%, 23%, 47%, 95%, 100%, „Pobierz”;
  - audio mp3 + normalizacja: jak wyżej, po 100% „Przetwarzam...”, potem „Pobierz”;
  - audio mp3 + przycięcie 5–12 oraz film mp4 + przycięcie 5–12: procent rośnie, potem „Przetwarzam...”, potem „Pobierz” (patrz rozbieżność wyżej).
  - Wszystkie pięć pobrań skończyło się „Gotowe”. Pobrane pliki zostały po sprawdzeniu usunięte z `downloads`.
- Nowe testy uruchomione na kodzie sprzed zmiany (pierwsza wersja, 20 testów): 11 z 20 nie przechodzi.
- Recenzja testów przez agenta `recenzent-testow`: jedna runda, zaakceptowane bez uwag poważnych. Recenzent zepsuł kod na kopii na 23 sposoby; `npm test` wykrył 20. Oczekiwane wyniki przeliczył sam.
- Z drobnych uwag recenzenta poprawione: test dla błędnego zapisu procentu (`1.2.3%`) i braku odstępu po `[download]`; nazwy i komentarze testów „przy przycinaniu” zmienione na „brak linii z procentem”, bo program nie pobiera już wycinków przez yt-dlp. Bez poprawek (zasada 2a): brak testu dla procentu po linii ffmpeg w tym samym pobraniu; sprawdzenie w Edge ma w czasie pobierania tylko typ `FFMPEG` (drugi typ jest w `npm test`).

### Niesprawdzone

- Tryb „osobno” na prawdziwym pobieraniu (jest tylko w testach na atrapie).
- Duży, długo pobierany film — film testowy ma 33 sekundy i pobiera się w kilka sekund.
- Klikanie ręką w zwykłym oknie przeglądarki — wszystko zrobił skrypt w Edge bez okna (headless).
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## WIZ B13j: Porządki w CSS

### Co zmieniono (`public/style.css`)

- Usunięte nieużywane reguły `.terminal-body`, `.terminal-body::-webkit-scrollbar` i `.note`. Żadnej z tych klas nie ma w `index.html` ani w `script.js`. Reguły `.background-terminal-body` i `#terminalLogs` (tło z logami) zostały bez zmian.
- Dwie definicje `button[type="submit"]` połączone w jedną. Właściwości z drugiej (`display: flex`, `justify-content: center`, `align-items: center`, `gap: 10px`) trafiły na początek pierwszej; druga definicja z końca pliku została usunięta.
- Plik jest krótszy o 36 linii. Innych zmian nie ma.

### Przyjęte założenia

- Reguła `button[type="submit"]:disabled` została tam, gdzie była (koniec pliku). Musi stać po `:hover`, żeby wyłączony przycisk nie unosił się po najechaniu, a zadanie mówi tylko o dwóch definicjach samego `button[type="submit"]`.
- Zadanie jest wizualne, więc nie ma nowych testów ani recenzji testów (zasada 2a).

### Sprawdzone (Windows 11, 2026-11-14)

- Porównanie wyglądu przed i po zmianie jednorazowym skryptem w Edge (`playwright-core`, strona z prawdziwego serwera programu, 60 linii logów w tle). Szerokości okna 1400, 900 i 500 px, w każdej pięć ujęć: strona zwykła, przycisk najechany, przycisk wyłączony z kółkiem i napisem „Pobieram... 42%”, przycisk wyłączony i najechany, otwarty panel EXPERIMENTAL.
  - 1400 i 900 px: wszystkie zrzuty przed i po są identyczne piksel po pikselu.
  - 500 px: część zrzutów różni się o 1 na 255 w pojedynczych pikselach. Taka sama różnica wychodzi między dwoma zrzutami tego samego kodu, więc to szum rysowania, nie skutek zmiany.
  - Wyliczone style (30 właściwości, m.in. `display`, `gap`, `padding`, `transform`, `opacity`) i położenie każdego elementu strony: bez różnic. Jedyna różnica to kąt obrotu kółka na przycisku, które się kręci.
- `npm test`: 577 testów, wszystkie przechodzą. Testy bez zmian.
- `npm run test:przegladarka`: 27 sprawdzeń w Edge, wszystkie przechodzą.
- Brak wystąpień `.terminal-body {`, `.note` i drugiej definicji `button[type="submit"]` w pliku.

### Do obejrzenia przez właściciela

Zrzuty w `logi-petli\zrzuty\`, parami `B13j-przed-<nazwa>.png` i `B13j-po-<nazwa>.png`: `1400-zwykly`, `1400-najechany`, `1400-wylaczony`, `500-zwykly`. Przycisk, karta i tło z logami mają wyglądać tak samo w obu plikach z pary.

Na zrzutach napisy są w foncie Arial zamiast Space Grotesk: skrypt odcina połączenia poza `127.0.0.1`, a font jest na razie pobierany z Google (zmieni to zadanie D2). Dotyczy to tak samo zrzutów przed i po.

### Niesprawdzone

- Wygląd z fontem Space Grotesk (patrz wyżej).
- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## D3: Obsługa z klawiatury

### Co zmieniono

- `public/style.css`:
  - `.choice input` i `.channel-switch input`: zamiast `display: none` pole jest ukryte wizualnie (`position: absolute`, `width: 1px`, `height: 1px`, `margin: 0`, `opacity: 0`, `pointer-events: none`). Dzięki temu Tab, strzałki i spacja do niego docierają.
  - `.choice` i `.channel-switch` dostały `position: relative`, żeby ukryte pole trzymało się swojej etykiety i nie przewijało strony przy fokusie.
  - Nowa wspólna reguła obwódki fokusu (`outline: 3px solid #c4b5fd; outline-offset: 3px`) dla `.choice input:focus-visible + span`, `.channel-switch input:focus-visible + .switch-track` i `.knob-dial:focus-within`.
- `public/index.html`: `#trimStart` ma `aria-label="Początek przycięcia"`, `#trimEnd` ma `aria-label="Koniec przycięcia"`, etykieta „Przytnij” ma `for="trimStart"`.
- `public/script.js` bez zmian. Pokrętła już wcześniej reagowały na strzałki (zdarzenie `input`), brakowało tylko widocznego fokusu.

### Przyjęte założenia

- Kolor i grubość obwódki nie są podane w zadaniu. Wybrany jasny fiolet `#c4b5fd`, 3 px z odstępem 3 px: pasuje do fioletu strony i jest widoczny także na zaznaczonym (fioletowo-niebieskim) przycisku trybu.
- Pokrętła mają `:focus-within`, tak jak każe zadanie. Skutek: kliknięcie myszą w napis „Bitcrush” albo „Sample rate” (etykieta pola) też pokazuje obwódkę. Kliknięcie w samą tarczę jej nie pokazuje. Tryb i przełącznik mają `:focus-visible`, więc po kliknięciu myszą obwódki nie ma.
- Formularz wysyła się Enterem z pola adresu albo Enterem/spacją na przycisku „Pobierz”. Panel EXPERIMENTAL otwiera się Enterem na przycisku EXPERIMENTAL.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test`: 589 testów, wszystkie przechodzą (12 nowych w `testy/klawiatura.test.js`: reguły ukrycia, trzy reguły obwódki, `aria-label`, `for`).
- `npm run test:przegladarka`: 33 sprawdzenia w Edge, wszystkie przechodzą (6 nowych w `testy/przegladarka/klawiatura.przegladarka.js`):
  - samą klawiaturą: Tab do pola adresu, wpisanie linku, Tab do trybu, strzałki zmieniają tryb (opcje formularza przestawiają się), Enter otwiera panel, strzałki ruszają oba pokrętła (wartość, napis i wskaźnik), spacja przełącza mono/stereo, Enter na „Pobierz” wysyła żądanie z wybranymi ustawieniami;
  - na każdym elemencie po drodze (Tab i Shift+Tab) jest znak fokusu: obwódka albo, dla pola adresu i list wyboru, istniejący cień;
  - wygląd bez fokusu: położenie i style wszystkich elementów oraz zrzuty karty i panelu są identyczne jak przy wstrzykniętym dawnym `display: none`, dla okna 1400 i 500 px;
  - kliknięcie myszą w tryb, przełącznik i tarczę pokrętła działa jak wcześniej i nie pokazuje obwódki;
  - pola przycinania są widoczne w drzewie dostępności pod nowymi nazwami, klik w „Przytnij” przenosi fokus na pole start.
- Recenzent testów: zaakceptowane w pierwszej rundzie. Wykrył 16 z 18 celowo wprowadzonych błędów; dwa niewykryte to obwódka w kolorze tła albo przezroczysta (testy sprawdzają, że obwódka jest i ma 3 px, nie jej kolor). Uwagi drobne, bez poprawek.

### Do obejrzenia przez właściciela

Zrzuty w `logi-petli\zrzuty\`: `D3-fokus-tryb-zaznaczony.png`, `D3-fokus-tryb-po-strzalce.png`, `D3-fokus-pokretlo.png`, `D3-fokus-przelacznik.png`, `D3-bez-fokusu.png`. Do oceny: czy kolor i grubość obwódki pasują.

### Uwaga dla właściciela (poza zakresem zadania)

- Przy zamkniętym panelu EXPERIMENTAL Tab przechodzi przez jego niewidoczne pola (pokrętła, przełącznik, normalizacja, przycinanie), więc fokus na chwilę „znika”. Dla pokręteł i pól przycinania tak było już przed zadaniem; teraz dotyczy to też przełącznika. Naprawa wymaga ukrywania zamkniętego panelu (`visibility: hidden`), czego zadanie nie obejmuje i co wymagałoby zmiany istniejących sprawdzeń, które wypełniają pola przycinania przy zamkniętym panelu. Po otwarciu panelu fokus jest zawsze widoczny.
- Porównanie zrzutów w sprawdzeniu wyglądu jest powtarzane do 4 razy, bo dwa zrzuty tego samego stanu czasem różnią się pojedynczymi pikselami (ten sam szum co przy B13j).

### Niesprawdzone

- Prawdziwy czytnik ekranu (sprawdzone tylko drzewo dostępności Edge).
- Inne przeglądarki niż Edge (Firefox, Safari); w Safari Tab domyślnie pomija część pól, zależnie od ustawień systemu.
- Obwódka fokusu z klawiatury przy wąskim oknie (500 px) nie ma osobnego sprawdzenia w testach; recenzent zmierzył jednorazowo, że jest rysowana.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane.

## D2: Font lokalnie

### Co zmieniono

- `public/fonts/` (nowy folder):
  - `space-grotesk-latin.woff2` (22 288 bajtów) i `space-grotesk-latin-ext.woff2` (18 940 bajtów): Space Grotesk w wersji zmiennej, jeden plik na zestaw znaków obejmuje wagi 300–700 (więc także używane na stronie 400, 600 i 700). Polskie litery są w zestawie `latin-ext`, poza „ó” i „Ó”, które są w `latin`.
  - `OFL.txt`: licencja SIL Open Font License 1.1 tego fontu.
- `public/style.css`: pierwsza linia `@import url('https://fonts.googleapis.com/...')` zastąpiona dwiema regułami `@font-face` (`font-family: 'Space Grotesk'`, `font-weight: 300 700`, `font-display: swap`, `src: url('fonts/...woff2') format('woff2')`, `unicode-range`). Reszta pliku bez zmian.
- `app.js`, `index.html`, `script.js` bez zmian: folder `public` jest już wydawany przez `express.static`.

### Skąd są pliki

- Pliki woff2 to dokładnie te, które do tej pory strona pobierała z Google (wersja v22), pobrane 2026-11-14 z adresów podanych w arkuszu `fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700`. Zakresy `unicode-range` przepisane z tego arkusza.
- `OFL.txt` pochodzi z repozytorium `google/fonts` (`ofl/spacegrotesk/OFL.txt`).
- Sumy SHA-256: latin `0640890476fc1198ab4de571fb658de443c4d85b66466ec09534a8737ab1ce9d`, latin-ext `952dddb45d2f96f71cbf3b7f510b24379afc3c89ea02fcf89d377b45d62c0166`.

### Przyjęte założenia

- Zadanie pozwala na „wagi 400, 600, 700 albo plik zmienny”. Wybrany plik zmienny: to ten sam plik, który Google podawał dla każdej z trzech wag, więc wygląd się nie zmienia, a plików jest dwa zamiast sześciu.
- Zestaw `vietnamese` z arkusza Google pominięty (zadanie wymienia tylko `latin` i `latin-ext`). Znaki spoza obu zestawów są rysowane fontem zapasowym (Arial).
- Nazwy plików własne (`space-grotesk-<zestaw>.woff2`) zamiast losowych nazw z Google.

### Sprawdzone (Windows 11, 2026-11-14)

- Przed zmianą strona otwarta w Edge wysyłała trzy żądania do Google (arkusz z `fonts.googleapis.com` i dwa pliki z `fonts.gstatic.com`); po zmianie nie wysyła żadnego żądania poza własny serwer.
- `npm test`: 606 testów, wszystkie przechodzą (17 nowych w `testy/font.test.js`).
- `npm run test:przegladarka`: 40 sprawdzeń w Edge, wszystkie przechodzą (7 nowych w `testy/przegladarka/font.przegladarka.js`, licząc test nadrzędny):
  - brak żądań do `fonts.googleapis.com`, `fonts.gstatic.com` i dokądkolwiek poza `127.0.0.1`;
  - oba pliki fontu przychodzą z `/fonts/` z kodem 200 i wczytują się bez błędu;
  - nagłówek „Pobierak”, etykieta „Co chcesz pobrać?” i przyciski trybu („Film z dźwiękiem”, „Dźwięk i obraz osobno”) są rysowane fontem Space Grotesk z pliku strony, nie systemowym (odczyt przez protokół DevTools, `CSS.getPlatformFontsForNode`);
  - próbka „ąćęłńóśźż ĄĆĘŁŃÓŚŹŻ Zażółć gęślą jaźń 0123456789” w wagach 400, 600 i 700: każdy znak narysowany Space Grotesk;
  - wagi 400, 600 i 700 mają rosnącą szerokość tekstu (prawdziwe wagi, nie sztuczne pogrubienie) i inną niż Arial.
- Recenzent testów: zaakceptowane w pierwszej rundzie, bez uwag poważnych. Wykrył 15 z 15 celowo wprowadzonych błędów (każdy złapany przez `npm test` albo przez sprawdzenie w Edge). Uwagi drobne zostawione bez poprawek; najważniejsza: `npm test` nie zagląda do środka plików woff2, więc zamianę plików `latin` i `latin-ext` miejscami łapie tylko sprawdzenie w Edge.

### Do obejrzenia przez właściciela

Zrzut `logi-petli\zrzuty\D2-font-lokalny.png`: strona z próbką „Zażółć gęślą jaźń ąęłż ĄĘŁŻ” w lewym górnym rogu (próbkę dokleja test, na stronie jej nie ma). Nagłówek, etykiety i polskie znaki mają być w Space Grotesk.

### Uwaga dla właściciela (poza zakresem zadania)

- Przycisk „Pobierz”, pole adresu i listy wyboru są rysowane Arialem, bo elementy formularza nie dziedziczą fontu strony. Tak było też przy foncie z Google; zadanie tego nie obejmuje, więc zostało bez zmian. Naprawa to jedna reguła (`button, input, select { font-family: inherit; }`), ale zmienia wygląd.
- W plikach fontu odmiana wyjściowa to waga 300, dlatego narzędzia przeglądarki pokazują nazwę „Space Grotesk Light”. To ten sam font; wagę ustawia CSS.
- Uwagi w sekcji „WIZ B13j” o napisach w Arialu na zrzutach opisują stan sprzed tego zadania.

### Niesprawdzone

- Inne przeglądarki niż Edge (Firefox, Safari).
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane, także `testy/font.test.js`.
- Zgodność `OFL.txt` z oryginałem znak po znaku (plik pobrany wprost z repozytorium `google/fonts`; test sprawdza cztery charakterystyczne fragmenty).

## B13i + D4: package.json i licencja

### Co zmieniono

- `package.json`:
  - `"main"`: `index.js` → `app.js` (pliku `index.js` nigdy nie było);
  - `"description"`: „Lokalna strona do pobierania filmów i dźwięku przez yt-dlp, z przycinaniem i efektami audio (ffmpeg).”;
  - nowe pole `"engines": { "node": ">=18" }`;
  - `"license"`: `ISC` → `MIT`.
- `package-lock.json`: wpis główny (`packages[""]`) dostał tę samą licencję i `engines`, żeby zgadzał się z `package.json`. Reszta pliku bez zmian.
- `LICENSE` (nowy plik): standardowy tekst licencji MIT po angielsku, linia praw: `Copyright (c) 2026 agawa98`.
- `app.js` i `public/` bez zmian.

### Przyjęte założenia

- Treść opisu w `description` wybrana samodzielnie (zadanie mówi tylko „krótki opis”), po polsku jak reszta projektu. Opis nie wymienia YouTube, bo program przyjmuje każdy adres obsługiwany przez yt-dlp.
- `package-lock.json` nie jest wymieniony w zadaniu, ale npm trzyma w nim kopię pól `license` i `engines`; bez poprawki pierwszy `npm install` zmieniłby ten plik sam. Poprawka zrobiona ręcznie; `npm install --package-lock-only --offline` uruchomiony potem nie zmienia pliku ani o bajt.
- Pola `author` i `keywords` zostają puste: zadanie ich nie obejmuje.
- Tekst licencji po angielsku, w brzmieniu wzorcowym (nietłumaczony).

### Sprawdzone (Windows 11, 2026-11-14, Node 24.16.0, npm 11.13.0)

- `npm start` (z `PORT=3977`): npm uruchamia `node app.js`, program wypisuje adres oraz wersje yt-dlp i ffmpeg, strona główna odpowiada kodem 200. Serwer po sprawdzeniu zatrzymany.
- `package.json` jest poprawnym JSON-em (czyta go test i sam npm).
- `npm test`: 626 testów, wszystkie przechodzą (20 nowych pozycji w `testy/pliki-projektu.test.js`).
- Recenzent testów: zaakceptowane w pierwszej rundzie, bez uwag poważnych. Wykrył 22 z 22 celowo wprowadzonych błędów (m.in. zły `main`, `engines` `>=16`, licencja ISC, pusty opis, zły rok i właściciel w `LICENSE`, brakujące słowo w tekście licencji, plik nazwany `LICENSE.txt`). Uwagi drobne zostawione bez poprawek; najważniejsza: test „pozostałe pola bez zmian” przypina wersję `1.0.0` i listę zależności, więc trzeba go będzie poprawić przy podbiciu wersji albo dodaniu zależności.

### Uwaga dla właściciela

- Przy sprawdzaniu `npm start` program, jak przy każdym starcie, usunął z `downloads` plik starszy niż 30 minut: `the #1 NO SCOPE player in rivals [f356b422].mp3` (pozostałość po sprawdzeniach wcześniejszych zadań).

### Niesprawdzone

- Czy program faktycznie działa na Node 18: `>=18` jest wpisane według zadania, a testy i start były uruchamiane tylko na Node 24.
- macOS i Linux: zadanie nie przewiduje tam sprawdzenia; nic nie było uruchamiane, także `testy/pliki-projektu.test.js`.
- `npm test` nie uruchamia samego polecenia `npm start`; sprawdza, że skrypt `start` to `node app.js`, a start `node app.js` pokrywa `testy/start.test.js`. Samo `npm start` było uruchomione ręcznie (wyżej).

## D1: Uruchamianie dwuklikiem

### Co zmieniono

Cztery nowe pliki w folderze programu. `app.js`, `public/` i `package.json` bez zmian.

- `start.bat` (Windows, końce linii CRLF, same znaki ASCII):
  1. `cd /d "%~dp0"` — przejście do własnego folderu.
  2. Sprawdzenie programów poleceniem `where`: `node`, `yt-dlp`, `ffmpeg`, `deno`. `yt-dlp` i `ffmpeg` liczą się też jako obecne, gdy istnieje `bin\yt-dlp.exe` / `bin\ffmpeg.exe`. Gdy niczego nie brakuje, skrypt nic o tym nie wypisuje.
  3. Gdy czegoś brakuje: `Brakuje programow: <lista>`. Jeśli jest `winget`, pytanie `Zainstalowac? [T/N]` (polecenie `choice`). Po `T`: dla każdego brakującego `winget install --id <ID> -e`, potem komunikat „Zamknij to okno i uruchom start.bat jeszcze raz”, `pause`, koniec (kod 0). Po `N` albo bez `winget`: „Nic nie zostalo zainstalowane. Brakuje: …”, odesłanie do README, `pause`, koniec (kod 1).
  4. Gdy nie ma `node_modules`: `npm install` (przy błędzie komunikat, `pause`, koniec).
  5. Otwarcie strony poleceniem `start` i `node app.js`. Gdy program skończy się błędem (np. zajęty port), okno czeka na klawisz.
- `start.command` (macOS) i `start.sh` (Linux): zaczynają się od `#!/bin/sh`, końce linii LF, treść identyczna poza jedną linią — `open "$ADRES"` w pierwszym, `xdg-open "$ADRES"` w drugim. Kolejność:
  1. `cd "$(dirname "$0")"`.
  2. Gdy `uname -s` to `Darwin`: dołożenie do PATH `/opt/homebrew/bin` i `/usr/local/bin`, jeśli istnieją i jeszcze ich tam nie ma.
  3. Sprawdzenie programów przez `command -v`; `yt-dlp` i `ffmpeg` także jako pliki `bin/yt-dlp`, `bin/ffmpeg`.
  4. Gdy czegoś brakuje na macOS: jest `brew` → pytanie `Zainstalowac? [T/N]`, po `T`/`t` jedno `brew install <brakujące>`, ponowne sprawdzenie i dalszy start bez ponownego uruchamiania (gdy po instalacji dalej czegoś brakuje — komunikat i koniec); inna odpowiedź → koniec bez instalacji. Nie ma `brew` → informacja, że potrzebny jest Homebrew, adres `https://brew.sh`, komenda instalacyjna stamtąd, prośba o ponowne uruchomienie, koniec. Skrypt sam Homebrew nie instaluje.
  5. Gdy czegoś brakuje na Linuksie: lista braków, przykładowe komendy dla `apt`, `dnf`, `pacman`, uwaga o yt-dlp (oficjalny plik albo `pipx`), odesłanie do README, koniec. Nic nie jest instalowane.
  6. `npm install`, gdy nie ma `node_modules`; otwarcie strony; `exec node app.js`.
- `.gitattributes`: `*.sh text eol=lf`, `*.command text eol=lf`, `*.bat text eol=crlf`.
- W repozytorium `start.command` i `start.sh` mają tryb `100755` (`git update-index --chmod=+x`).

Identyfikatory pakietów winget w `start.bat` (każdy potwierdzony przez `winget show --id <ID> -e` 2026-11-14):

| Program | Identyfikator | Wersja pokazana przez `winget show` |
|---|---|---|
| Node LTS | `OpenJS.NodeJS.LTS` | 26.13.1 |
| yt-dlp | `yt-dlp.yt-dlp` | 2026.10.26 |
| ffmpeg | `yt-dlp.FFmpeg` | N-127043-g5a54fcf75e-20260930 |
| Deno | `DenoLand.Deno` | 2.9.8 |

Pakiet `yt-dlp.yt-dlp` sam dociąga ffmpeg: `winget show` wypisuje w jego zależnościach `yt-dlp.FFmpeg` i `DenoLand.Deno`. Dlatego dla ffmpeg wybrany jest ten sam pakiet `yt-dlp.FFmpeg` (a nie np. `Gyan.FFmpeg`, który też istnieje), żeby na komputerze nie lądowały dwa różne ffmpeg. Skutek uboczny: gdy brakuje naraz yt-dlp i ffmpeg, drugie polecenie `winget install --id yt-dlp.FFmpeg -e` trafi na pakiet zainstalowany chwilę wcześniej jako zależność i winget wypisze, że nie ma nic do zrobienia. To nie jest błąd.

### Przyjęte założenia

- **Jedna treść dla macOS i Linuksa.** Zadanie każe, żeby `start.command` i `start.sh` różniły się tylko poleceniem otwierającym przeglądarkę, a jednocześnie opisuje inne zachowanie przy brakach (macOS: `brew`, Linux: tylko podpowiedzi). Pogodzone tak: oba pliki zawierają obie gałęzie, a wybiera `uname -s` (`Darwin` → gałąź macOS, wszystko inne → gałąź Linuksa).
- **Przeglądarka otwiera się z opóźnieniem ok. 2 s, w tle.** Zadanie wymienia kolejność „otwiera stronę, uruchamia `node app.js`”. Otwarcie strony przed startem serwera dawałoby w przeglądarce błąd połączenia, więc polecenie otwierające rusza w tle i czeka (`sleep 2` w sh; `ping -n 3 127.0.0.1` w bat), a `node app.js` startuje od razu. W `start.bat` zapis to `ping ... && start http://localhost:%PORT%`.
- **Port ze zmiennej `PORT`.** Adres to `http://localhost:3000`, ale gdy ustawiona jest zmienna `PORT` (z której korzysta `app.js`), skrypty otwierają stronę na tym porcie.
- **Pytanie w `start.bat` zadaje `choice`** (jeden klawisz, bez Entera). Każda odpowiedź inna niż `T`/`t`, a także brak wejścia, oznacza „nie instaluj”.
- **W skryptach sh zgodą jest odpowiedź zaczynająca się od `T` lub `t`**; sam Enter, `N` i każdy inny tekst oznaczają „nie instaluj”.
- **`winget install` i `node` są w `start.bat` wołane przez `call`.** Dla plików `.exe` niczego to nie zmienia, a pozwala testom podstawić atrapy `.cmd`.
- **Teksty skryptów bez polskich liter** (jak komunikaty w `app.js`), bo okno `cmd` potrafi je zepsuć zależnie od strony kodowej.
- **`brew install` dostaje tylko brakujące programy.** Homebrew przy instalacji może sam odświeżyć swoją listę pakietów i zaktualizować biblioteki, od których zależy instalowany program; skrypt tego nie wyłącza. Programów z listy (node, yt-dlp, ffmpeg, deno), które już są, nie rusza.
- Na Linuksie przykładowe komendy nie instalują Deno przez `apt`/`dnf` (skrypt odsyła po nie do `https://deno.com`). Te komendy nie były nigdzie uruchamiane.

### Testy (`testy/skrypty-startowe.test.js`)

- **Treść plików:** istnienie czterech plików; trzy linie `.gitattributes`; brak `\r` i `#!/bin/sh` w obu skryptach sh; pierwsze polecenie to `cd` do własnego folderu; brak poleceń aktualizujących i brak samodzielnej instalacji Homebrew; dokładanie folderów Homebrew do PATH; dokładnie jedna różniąca się linia między `start.command` i `start.sh`; `start.bat` z końcami CRLF i samym ASCII; cztery wywołania `winget install` z identyfikatorami; `pause` przed każdym zakończeniem z komunikatem; tryb `100755` w indeksie git (pomijane, gdy folder nie jest repozytorium); `sh -n`.
- **`start.command` i `start.sh` uruchomione przez `sh`** na kopii w `os.tmpdir()` (folder z odstępem w nazwie, start z innego katalogu). Wszystkie programy są atrapami zapisującymi wywołania do pliku: `node`, `npm`, `yt-dlp`, `ffmpeg`, `deno`, `brew`, `uname`, `sleep`, `open`, `xdg-open`. PATH zawiera tylko folder atrap i folder z `dirname`/`chmod`. System wybiera atrapa `uname`, więc gałąź macOS i gałąź Linuksa są uruchamiane na każdym systemie. Foldery Homebrew są w kopii skryptu podmienione na foldery tymczasowe, żeby na komputerze z Homebrew test nie sięgnął po prawdziwe programy. Przypadki: wszystko jest (bez pytań, bez `npm install`, `node app.js` w folderze programu, właściwe polecenie przeglądarki z adresem); brak `node_modules`; nieudany `npm install`; `PORT`; pliki w `bin` (oba, tylko jeden, `node`/`deno` w `bin` się nie liczą); macOS: odpowiedź `T`/`t` → jedno `brew install` tylko z brakującymi i start, odpowiedzi `N`, Enter, brak wejścia, inny tekst → nic, nieudany `brew install`, brak Homebrew, `brew` i programy tylko w folderze Homebrew spoza PATH; Linux: lista, `apt`/`dnf`/`pacman`, `pipx`, README, `brew` nieużyty mimo że jest, folder Homebrew niedokładany.
- **`start.bat` uruchomiony przez `cmd`** (tylko Windows) na kopii w `os.tmpdir()`, z atrapami `*.cmd`; PATH to folder atrap i `System32`. Atrapa `ping.cmd` kończy się błędem, więc `ping ... && start http://...` nie otwiera przeglądarki. Przypadki: wszystko jest; brak `node_modules`; nieudany `npm install`; pliki w `bin`; brak deno + `N`; brak wejścia; `T`/`t` → `winget install` tylko dla brakujących, bez startu programu; brak `winget`.
- Na Windowsie `sh` jest brane z Git for Windows (szukane przez PATH i obok `git.exe`). Gdy go nie ma, testy z `sh` są pomijane. Testy `start.bat` są pomijane poza Windowsem.

### Sprawdzone (Windows 11, 2026-11-14, Node 24.16.0)

- **`start.bat` przy usuniętym `node_modules`** (uruchomiony przez `cmd /c` z innego katalogu, prawdziwe programy, port 3000): wypisał „Instaluje zaleznosci (npm install)...”, npm dodał 68 pakietów, program wystartował („Pobierak dziala. Otworz w przegladarce: http://localhost:3000”, wersje yt-dlp i ffmpeg), `http://localhost:3000/` odpowiada kodem 200, w Chrome (domyślna przeglądarka) pojawiło się okno o tytule „Pobierak”. O brakujących programach skrypt nic nie wypisał. `package-lock.json` po tej instalacji bez zmian. Serwer po sprawdzeniu zatrzymany.
- **PATH bez `deno`, odpowiedź `N`:** skrypt wypisał `Brakuje programow: deno`, `Zainstalowac? [T/N] N`, „Nic nie zostalo zainstalowane. Brakuje: deno”, odesłanie do README, kod wyjścia 1. Niczego nie zainstalował; Deno na komputerze nietknięte.
- **`winget show`** przechodzi dla wszystkich czterech identyfikatorów (tabela wyżej).
- `git ls-files -s start.command start.sh` pokazuje `100755` dla obu.
- `start.command` i `start.sh` nie zawierają znaku `\r` (test). `start.bat` ma w kopii roboczej CRLF; w repozytorium git trzyma wszystkie trzy z LF (`git ls-files --eol`), a `.gitattributes` odtwarza CRLF dla `.bat` przy pobraniu.
- `sh -n start.sh` i `sh -n start.command` w Git Bash: bez błędów.
- Oba skrypty sh uruchomione w `sh` z Git for Windows z atrapami programów (testy wyżej), w tym cała gałąź macOS wybrana atrapą `uname`.
- `npm test`: 708 testów, wszystkie przechodzą, żaden nie jest pominięty (82 nowe pozycje w `testy/skrypty-startowe.test.js`).
- Recenzent testów: zaakceptowane w drugiej rundzie. W pierwszej rundzie wykrył 6 z 13 celowo wprowadzonych błędów i zgłosił trzy uwagi poważne: (1) testy gałęzi macOS na komputerze z Homebrew wyszłyby poza atrapy, bo skrypt dokłada prawdziwe `/opt/homebrew/bin` na początek PATH — test mógłby uruchomić prawdziwe `brew install`; (2) dokładanie Homebrew do PATH było sprawdzane tylko jako tekst; (3) brak testu na `pause` w `start.bat`. Poprawione w testach (skrypty bez zmian): foldery Homebrew podmieniane w kopii skryptu na foldery tymczasowe, cztery nowe testy z uruchomieniem, test `pause`, do tego osobne przypadki plików w `bin` i odpowiedzi `x`/`Y`. W drugiej rundzie wykrył 12 z 12 błędów. Uwagi drobne zostawione: kolejność folderu Homebrew w PATH pilnuje tylko test treści; po nieudanym teście sh może zostać folder `pobierak-start-*` w katalogu tymczasowym; gdyby ktoś zmienił w `start.bat` `&&` na `&`, testy z uruchomieniem otworzyłyby prawdziwą przeglądarkę (test treści tę zmianę łapie).

### Uwaga dla właściciela

- Przy sprawdzaniu `start.bat` w Chrome została otwarta karta „Pobierak” (`http://localhost:3000`); serwer jest już zatrzymany, kartę można zamknąć.
- Sprawdzenia na Macu czekają na zalogowanie Tailscale na tym komputerze (`ssh spliffzilla@mac` zwraca „Could not resolve hostname mac”). Lista do zrobienia jest niżej.

### Niesprawdzone

- **macOS — nic nie zostało uruchomione.** `ssh spliffzilla@mac` nie znajduje hosta `mac` (2026-11-14, tak samo jak przy P1). Nie wykonano więc: odinstalowania Deno i jego powrotu przez `start.command` z odpowiedzią `T`; drugiego uruchomienia bez pytań; `sh ./start.command` z innego katalogu przy usuniętym `node_modules` i odpowiedzi serwera na `http://localhost:3000`. Gałąź macOS była uruchamiana tylko w testach, w `sh` z Git for Windows, z atrapami `uname`, `brew` i `open` — nie na prawdziwym macOS i nie z prawdziwym Homebrew.
- **Gałąź „brak Homebrew”** na prawdziwym Macu nie była uruchamiana (zgodnie z zadaniem). Kod przeczytany: gdy `command -v brew` nic nie znajduje, skrypt wypisuje adres `https://brew.sh`, komendę instalacyjną, prośbę o ponowne uruchomienie i kończy kodem 1, bez pytania i bez instalowania. W testach ta gałąź przechodzi na atrapach.
- **Dwuklik `start.command` w Finderze i otwarcie przeglądarki na macOS** — sprawdza właściciel.
- **Instalacja przez `winget` z `start.bat`** (odpowiedź `T` z prawdziwym winget): niesprawdzona, bo wymagałaby odinstalowania programów z tego komputera. Sprawdzone są tylko identyfikatory (`winget show`) i to, że skrypt woła `winget install` dla właściwych pakietów (atrapa).
- **Prawdziwy dwuklik `start.bat` w Eksploratorze:** skrypt był uruchamiany przez `cmd /c`, nie myszką.
- **Linux:** `start.sh` nie był uruchamiany na Linuksie. Sprawdzona jest tylko składnia (`sh -n` w Git Bash) i przebieg w `sh` z Git for Windows na atrapach. Komendy `apt`/`dnf`/`pacman`/`pipx` z podpowiedzi oraz `xdg-open` nie były uruchamiane.
- **`testy/skrypty-startowe.test.js` na macOS i Linuksie** nie był uruchamiany (tam `sh` to inna powłoka niż w Git for Windows: bash w trybie sh / dash).

## G5: Testy na trzech systemach

### Co zmienione

- **Nowy plik `.github/workflows/testy.yml`.** Uruchamia się przy `push` i `pull_request` (bez ograniczenia do gałęzi). Jedno zadanie z macierzą `windows-latest`, `macos-latest`, `ubuntu-latest`, `fail-fast: false` (błąd na jednym systemie nie przerywa pozostałych). Kroki: `actions/checkout@v4`, `actions/setup-node@v4` z Node 20, instalacja ffmpeg zależna od systemu (`choco install ffmpeg -y --no-progress` / `brew install ffmpeg` / `sudo apt-get update && sudo apt-get install -y ffmpeg`), krok „Sprawdzenie ffmpeg” (`ffmpeg -version`, `ffprobe -version` w bash), `npm ci`, `npm test`.
- **`app.js` — tworzenie folderu `downloads`.** Zamiast `existsSync` + `mkdirSync` jest jedno `fs.mkdirSync(downloadsDir, { recursive: true })`. Przyczyna: na świeżej kopii repozytorium (bez folderu `downloads`, czyli tak jak na GitHubie) `node --test` wczytuje `app.js` w kilku procesach naraz i jeden z nich padał z `EEXIST ... mkdir downloads`. Błąd był opisany w sekcji B2 jako do zrobienia przy G5. Odtworzony tutaj: świeży klon, `npm test` → jeden plik testów nie przeszedł (`adresy-plikow.test.js`); po poprawce trzy przebiegi z rzędu na klonie z usuwanym `downloads` przechodzą.
- **Przegląd testów w `testy/` i skryptu `test`.** W istniejących testach nic nie wymagało poprawy (żaden nie został zmieniony). Skrypt `test` to `node --test`. Pliki robocze testów powstają w `os.tmpdir()`, ścieżki są składane przez `path.join`, nazwy z `.exe` występują tylko tam, gdzie test sam podaje system (`platform: "win32"`) albo w części `start.bat`, która poza Windowsem jest pomijana (`skip`). Wielkość liter w nazwach plików, do których odwołują się testy i `app.js`, zgadza się z nazwami w repozytorium (ważne na Linuksie).

### Dlaczego workflow wygląda tak

- **yt-dlp nie jest instalowany.** Sprawdzone: `npm test` z PATH bez yt-dlp i bez Deno przechodzi w całości (708 z 708, nic pominięte). Żaden test nie uruchamia yt-dlp.
- **ffmpeg jest instalowany i sprawdzany osobnym krokiem.** Bez ffmpeg/ffprobe testy nie padają, tylko po cichu pomijają 43 pozycje (sprawdzone: PATH bez ffmpeg → 665 przechodzi, 43 pominięte). Gdyby instalacja na GitHubie się nie udała, przebieg byłby zielony przy okrojonych testach — dlatego krok „Sprawdzenie ffmpeg” zatrzymuje przebieg, gdy któregoś programu nie ma.
- **Końce linii.** Na Windowsie GitHub pobiera pliki z CRLF (`core.autocrlf=true`). Sprawdzone na świeżym klonie z tym ustawieniem (53 pliki z CRLF): wszystkie testy przechodzą, więc workflow nie zmienia ustawień gita.

### Założenia

- Wersje akcji `@v4` (checkout, setup-node) wybrane samodzielnie; zadanie ich nie podaje.
- `fail-fast: false` dodane samodzielnie, żeby było widać wynik każdego systemu osobno.
- Poprawka `mkdirSync` w `app.js` dotyczy pliku spoza listy „Pliki” zadania; bez niej testy na GitHubie padałyby losowo, więc zaliczona do „Popraw to, co zależy”.
- Recenzent testów nie był wołany (zasada 2b): zmiana logiki programu to jedna linia, reszta to plik workflow i testy.

### Testy

`testy/workflow.test.js` (13 nowych pozycji):

- workflow: plik istnieje i nie ma tabulatorów; `on:` ma dokładnie `push` i `pull_request`; jedno zadanie, `runs-on: ${{ matrix.os }}`, macierz z dokładnie trzema systemami; `fail-fast: false`; kroki checkout → Node 20 → trzy instalacje ffmpeg → sprawdzenie ffmpeg → `npm ci` → `npm test` (ostatni), kroki wspólne bez warunku `if`; każda instalacja ffmpeg ma właściwy warunek `runner.os` i właściwy menedżer pakietów; krok sprawdzenia woła `ffmpeg -version` i `ffprobe -version` w bash; brak yt-dlp, `git push` i `npm publish`.
- `package.json`: skrypt `test` to dokładnie `node --test`.
- pliki `*.test.js`: brak folderów tymczasowych wpisanych na sztywno, każde `mkdtempSync` zaczyna od `os.tmpdir()`.
- `app.js`: 12 procesów naraz wczytuje kopię `app.js` z folderu tymczasowego bez `downloads` (trzy podejścia) — wszystkie kończą się kodem 0, folder powstaje; przy istniejącym folderze jego pliki zostają; w kodzie nie ma `existsSync(downloadsDir)`.

Plik workflow jest czytany jako tekst (własny prosty podział na linie i wcięcia), żeby nie dokładać biblioteki YAML do zależności. Test zna więc tylko obecny układ pliku; przy większej przebudowie workflow trzeba go będzie dopasować.

Sprawdzenie, czy testy łapią błędy (każda zmiana wprowadzona osobno i cofnięta): powrót do `existsSync` + `mkdirSync`, brak `pull_request`, brak `ubuntu-latest`, Node 24, `brew install` bez ffmpeg, `npm install` zamiast `npm ci`, `runs-on` wpisane na sztywno, `apt-get` z warunkiem macOS, brak `ffprobe -version`, `fail-fast: true`, `npm test` tylko na Windowsie — przy każdej z 11 zmian co najmniej jeden test nie przechodzi.

### Sprawdzone (Windows 11, 2026-11-14)

- `npm test` na Node 24.16.0: 721 testów, wszystkie przechodzą, żaden pominięty.
- Testy na Node 20.20.2 (wersja z workflow; uruchomione przez `npx node@20 --test`): 721 z 721.
- Świeży klon repozytorium z `core.autocrlf=true`, bez folderu `downloads`: 721 z 721.
- `npm ci --dry-run` nie zgłasza rozjazdu `package.json` z `package-lock.json`.
- Plik workflow jest poprawnym YAML-em: wczytany przez PyYAML 6.0.3 (`yaml.safe_load`), struktura zgodna z opisem wyżej.
- Przybliżenie Linuksa dla skryptów startowych: `testy/skrypty-startowe.test.js` uruchomiony z `dash` z Git for Windows w miejscu `sh` (Ubuntu ma `dash` jako `/bin/sh`) — 82 z 82; `dash -n start.sh` i `dash -n start.command` bez błędów. To nadal Windows, nie Linux.

### Niesprawdzone

- **macOS — `npm install` i `npm test` na Macu nie zostały uruchomione.** `ssh spliffzilla@mac` zwraca „Could not resolve hostname mac” (2026-11-14, trzy próby; Tailscale na tym komputerze zgłasza „Tailscale is starting” / `NoState`, tak samo jak przy P1 i D1). Do zrobienia, gdy Mac będzie osiągalny: skopiować kod (polecenie z sekcji TRZY SYSTEMY w `ZADANIA.md`), `npm install`, `npm test`. Zadanie K2 to powtarza.
- **Workflow na GitHubie nie był uruchomiony na żadnym z trzech systemów** — ruszy dopiero po wrzuceniu repozytorium (repozytorium nie zostało wypchnięte, zgodnie z zadaniem). Niesprawdzone są więc: instalacja ffmpeg przez `choco`, `brew` i `apt-get` na maszynach GitHuba, to, czy ffmpeg z `apt-get` i z `choco` ma wszystkie kodeki używane w testach (m.in. libx264, libmp3lame, mjpeg, kodeki MPEG), oraz czas trwania przebiegu.
- **Linux — testy nie były uruchomione ani razu.** Do pierwszego przebiegu workflow na `ubuntu-latest` nic o Linuksie nie jest sprawdzone.
- **`testy/skrypty-startowe.test.js` na prawdziwym macOS i Linuksie** — jak w sekcji D1; to najbardziej prawdopodobne miejsce pierwszego błędu na GitHubie (prawdziwy `sh`, prawdziwe `/opt/homebrew/bin` na maszynie macOS).

## G2: README

### Co zmieniono

- **Nowy plik `README.md`** (po polsku): co program robi, zrzut ekranu, wymagania, instalacja od zera w numerowanych krokach osobno dla Windowsa, macOS i Linuksa (z instalacją ręczną dla każdego), uruchamianie (`start.bat` / `start.command` / `start.sh` / `npm start`), blokada `start.command` na macOS, dwuklik na Linuksie, tabela „Na czym sprawdzono”, aktualizacja yt-dlp, zmienne `PORT`, `HOST`, `YTDLP_PATH`, `FFMPEG_PATH`, folder `bin`, panel EXPERIMENTAL, usuwanie plików z `downloads` po 30 minutach, testy, licencja.
- **Nowy plik `docs/zrzut-ekranu.png`** (1280×800): strona z wklejonym linkiem, otwartym panelem EXPERIMENTAL, wpisanym przycięciem i liniami logów w tle.
- **Nowy plik `testy/przegladarka/zrzut-readme.js`** — skrypt, który robi ten zrzut (Edge przez `playwright-core`, `node testy/przegladarka/zrzut-readme.js`). Nie ma końcówki `.przegladarka.js`, więc `npm run test:przegladarka` go nie uruchamia. Linie w tle wysyła sam skrypt (`sendLogToClients`); nic nie jest pobierane z internetu.
- **Nowy plik `testy/readme.test.js`** (18 testów).
- `app.js`, `public/`, skrypty startowe i istniejące testy bez zmian.

### Przyjęte założenia

- **Adres repozytorium `https://github.com/agawa98/Pobierak.git` jest zgadywany.** Repozytorium lokalne nie ma ustawionego adresu zdalnego (`git remote -v` jest puste). Adres złożony z nazwy właściciela z pliku `LICENSE` (`agawa98`) i nazwy folderu `Pobierak-main` (tak GitHub nazywa folder w ZIP-ie repozytorium `Pobierak`, gałąź `main`). Nie był sprawdzany w sieci. **Do poprawienia przez właściciela, jeśli repozytorium nazywa się inaczej** (trzy wystąpienia `git clone` w README).
- **Tabela „Na czym sprawdzono” podaje macOS jako niesprawdzony.** Zadanie zakładało wpis „pobieranie sprawdzone ręcznie” dla Windowsa i macOS, ale tabela ma być zgodna z prawdą, a na Macu program nie był uruchomiony ani razu (host `mac` nieosiągalny przy P1, D1, G5 i teraz). Po K2 wiersz macOS trzeba zaktualizować (wersja systemu i wynik); test dopuszcza obie postaci wiersza.
- Zrzut ekranu leży w `docs/` (nie w `public/`, żeby serwer go nie wydawał).
- Instalacja Deno na Linuksie: oficjalny skrypt `curl -fsSL https://deno.land/install.sh | sh` (skrypt `start.sh` odsyła tylko na `https://deno.com`). Uwaga o RPM Fusion dla ffmpeg na Fedorze dodana samodzielnie.
- Komenda instalacji yt-dlp z oficjalnego pliku (`curl -L .../releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp` + `chmod a+rx`) pochodzi z instrukcji yt-dlp.
- Opis blokady `start.command` zawiera, poza wymaganym „prawy przycisk → Otwórz” i `sh start.command`, także drogę przez Ustawienia systemowe → Prywatność i ochrona → „Otwórz mimo to” (w macOS 15 samo „Otwórz” z menu może nie wystarczyć).
- W sekcji o folderze `bin` jest rada, żeby obok ffmpeg położyć `ffprobe` (yt-dlp szuka go w tym samym folderze). Program sam `ffprobe` nie woła.
- Recenzent testów nie był wołany (zasada 2b): zadanie nie zmienia kodu programu.

### Testy (`testy/readme.test.js`)

- plik istnieje, UTF-8 bez BOM, polskie znaki; wszystkie wymagane sekcje, sekcje systemów wewnątrz „Instalacja”;
- zrzut ekranu: odnośnik lokalny, plik istnieje, sygnatura PNG, wymiary z nagłówka co najmniej 800×500;
- każdy odnośnik do pliku wskazuje istniejący plik, każdy odnośnik `#...` istniejący nagłówek;
- wymagania: Node w wersji z `engines` w `package.json`, yt-dlp, ffmpeg, Deno;
- Windows: cztery komendy `winget install` z dokładnie tymi identyfikatorami, które ma `start.bat`; kroki z `start.bat`, pytaniem `Zainstalowac? [T/N]` i ponownym uruchomieniem; instalacja ręczna;
- macOS: komenda instalacji Homebrew identyczna z tą w `start.command`, `https://brew.sh`, `start.command`, blokada pliku, `sh start.command`, `brew install` z czterema programami;
- Linux: zdanie, że program nie był uruchamiany, prośba o zgłoszenia, `apt`/`dnf`/`pacman`, oficjalny plik yt-dlp i `pipx`, `./start.sh`, uwaga o dwukliku;
- uruchamianie: trzy skrypty (istnieją w repozytorium) i `npm start`;
- tabela „Na czym sprawdzono”: Linux „Niesprawdzony”, macOS niesprawdzony albo z wersją systemu;
- aktualizacja yt-dlp: `winget upgrade` (identyfikator ze `start.bat`), `brew upgrade`, `yt-dlp -U`, `pipx upgrade`;
- zmienne: dokładnie cztery, te same, które czyta `app.js`, z tymi samymi wartościami domyślnymi; przykład dla cmd, PowerShell i sh;
- folder `bin`: nazwy plików i kolejność szukania;
- panel EXPERIMENTAL: pięć ustawień, każde ma pole w `index.html`; zapisy czasu z README przyjmuje `parseTimeToSeconds`;
- formaty audio i wideo w README to dokładnie listy `allowedAudioFormats` / `allowedVideoFormats` z `app.js`;
- 30 minut i 10 minut zgodne z `fileMaxAgeMinutes` i `cleanupIntervalMinutes`;
- licencja MIT z odnośnikiem do `LICENSE`; komendy `npm` z README istnieją w `package.json`.

Sprawdzenie, czy testy łapią błędy (12 zmian w README, każda osobno i cofnięta): 60 zamiast 30 minut, inny identyfikator winget, usunięte zdanie o Linuksie, Linux „Sprawdzony” w tabeli, inna domyślna wartość `HOST`, zły plik zrzutu, `brew install` bez deno, format OGG, `start.sh` w krokach macOS, inna komenda aktualizacji, zła nazwa zmiennej, inna licencja — wszystkie 12 wykryte.

### Sprawdzone (Windows 11 Home 10.0.26200, 2026-11-14, Node 24.16.0, npm 11.13.0)

- `npm test`: 739 testów, wszystkie przechodzą, żaden pominięty (18 nowych).
- `winget show --id <ID> -e` dla czterech identyfikatorów z README: wszystkie znalezione (Node LTS 26.13.1, yt-dlp 2026.10.26, FFmpeg for yt-dlp N-127043, Deno 2.9.8).
- Wiersz polecenia: `set PORT=3001`, `set HOST=0.0.0.0`, `set YTDLP_PATH=<plik yt-dlp.exe>`, `set FFMPEG_PATH=<plik ffmpeg.exe>`, `npm start` → „Pobierak dziala. Otworz w przegladarce: http://localhost:3001”, wersje obu programów, nasłuch na `0.0.0.0:3001`, `GET /` 200, pobranie audio mp3 filmu testowego przez `POST /api/download` udane (plik `the #1 NO SCOPE player in rivals [91b25c40].mp3`). Serwer zatrzymany, plik usunięty.
- PowerShell: `$env:PORT = "3002"`, `npm start` → start na porcie 3002, nasłuch na `127.0.0.1` (domyślny `HOST`), `GET /` 200. Serwer zatrzymany.
- Zrzut ekranu obejrzany: karta z linkiem, trzy tryby, bitrate, format, panel EXPERIMENTAL z pokrętłami, przełącznikiem, normalizacją i przycięciem 0:05–0:12, logi w tle.
- Opis porównany z kodem: formaty, zakresy bitrate i rozdzielczości (`app.js`, `index.html`), kolejność szukania programów (`resolveBinary`), efekty w trybach (`shouldProcessMedia`), przycinanie po pobraniu z kodowaniem obrazu (sekcja B11), sprzątanie co 10 minut plików starszych niż 30 minut, komunikaty startowe, zachowanie skryptów startowych (sekcja D1).
- `start.bat` (bez instalacji przez winget) i `npm install` były uruchamiane w zadaniu D1; w tym zadaniu nie były powtarzane.

### Niesprawdzone

- **Wszystkie komendy dla macOS** — `ssh spliffzilla@mac` zwraca „Could not resolve hostname mac” (2026-11-14). Nie uruchomiono: komendy instalacji Homebrew, `brew install node yt-dlp ffmpeg deno` (ani `brew list`), `brew upgrade yt-dlp`, `sh start.command`, `npm install`, `npm start`, `PORT=3001 npm start`. Opis blokady `start.command` (prawy przycisk → Otwórz, Ustawienia → „Otwórz mimo to”) jest z wiedzy ogólnej, nie z próby.
- **Wszystkie komendy dla Linuksa** (`apt`, `dnf`, `pacman`, skrypt instalacyjny Deno, `curl` + `chmod` dla yt-dlp, `pipx install`, `pipx upgrade`, `./start.sh`, `sh start.sh`) — brak maszyny. README mówi to wprost.
- **Windows:** cztery komendy `winget install` (sprawdzone tylko identyfikatory przez `winget show`; instalacja wymagałaby odinstalowania programów); `winget upgrade --id yt-dlp.yt-dlp -e` i `yt-dlp -U` (zmieniłyby program zainstalowany na tym komputerze: jest 2026.03.17, winget ma 2026.10.26); `git clone` (adres zgadywany, patrz założenia); pobranie i rozpakowanie ZIP-a z GitHuba; dwuklik `start.bat` myszką; folder `bin` z prawdziwymi programami (tylko testy automatyczne z P1).
- Wygląd README na stronie GitHuba (tabele, obrazek, kotwica `#panel-experimental`) — plik nie był tam wyświetlany; kotwicę sprawdza tylko test, według reguł GitHuba odtworzonych w teście.

### Uwaga dla właściciela

- Sprawdź adres repozytorium w README (`https://github.com/agawa98/Pobierak.git`).
- Po zalogowaniu Tailscale i wykonaniu K2 popraw wiersz macOS w tabeli „Na czym sprawdzono”.

---

## K1: Pełny przegląd (Windows)

### Co zrobiono

- Kod programu bez zmian. Doszedł jeden plik: `testy/przeglad/przeglad-koncowy.js` — skrypt, który wykonuje cały przegląd i da się go powtórzyć jednym poleceniem (także w K2 na Macu).
- Uruchamianie: `node testy/przeglad/przeglad-koncowy.js`. Opcje: `--wyczysc` (usuwa pliki z `downloads` przed startem; bez niej skrypt wymaga pustego folderu i kończy z kodem 2, gdy coś tam leży), `--bez-przegladarki` (pomija część w Edge).
- Skrypt nie jest częścią `npm test` ani `npm run test:przegladarka`, bo pobiera film z YouTube (wymaga internetu, yt-dlp, ffmpeg i ffprobe; trwa kilka minut). `node --test` go nie znajduje (nazwa bez `.test.js`).
- Co robi: startuje prawdziwy `node app.js` na wolnym porcie i zbiera jego konsolę; wykonuje sześć pobrań filmu testowego przez `POST /api/download`; każdy plik mierzy przez `ffprobe`, dekoduje w całości (`ffmpeg -v error -i <plik> -f null -`) i pobiera spod adresu z odpowiedzi; potem przechodzi stronę w Edge od wklejenia linku do pobrania pliku (dwa pobrania); na koniec sprawdza zawartość `downloads` i konsolę serwera. Kod wyjścia 0 = wszystko przeszło. Konsola serwera trafia do pliku `pobierak-przeglad-konsola.log` w folderze tymczasowym.

### Przyjęte założenia

- „Po jednym z efektami i z przycięciem” = w każdym trybie jedno pobranie, które ma naraz efekty (normalizacja + mono + bitcrush 8 + sample rate 22050) i przycięcie 5–12 s. Razem sześć pobrań przez API: trzy bez efektów, trzy z efektami i przycięciem.
- Formaty: audio mp3, film i „osobno” mp4 720p (domyślne i najczęstsze). Pozostałe formaty mają własne sprawdzenia w zadaniach B5–B12.
- Na stronie dwa pobrania: tryb domyślny (audio mp3) oraz „Film z dźwiękiem” z panelem EXPERIMENTAL (normalizacja, przycięcie `5`–`0:12`).
- Bez recenzenta (zasada 2b: przegląd końcowy, kod programu bez zmian).
- Brak nieobsłużonych wyjątków w konsoli serwera skrypt sprawdza tak: w wyjściu programu nie ma słów `unhandled`/`uncaught`, nazw błędów JavaScriptu, linii śladu stosu ani śladu stosu Pythona (yt-dlp); program działa do końca; każde wywołanie yt-dlp i ffmpeg kończy się kodem 0.

### Sprawdzone (Windows 11, 2026-11-14; Node 24.16.0, yt-dlp 2026.03.17, ffmpeg N-124279 z 2026-04-30, Edge)

- Przegląd: 142 sprawdzenia, 0 błędów. `downloads` pusty przed startem.

| Pobranie | Wynik (`ffprobe`) |
|---|---|
| audio mp3 „best”, bez efektów | mp3, 33,152 s, bez obrazu |
| film mp4 720p, bez efektów | h264 360x640 + aac, obraz 33,133 s, dźwięk 33,195 s |
| „osobno” mp4 720p, bez efektów | wideo: h264 360x640, bez dźwięku, 33,133 s; audio: mp3, 33,152 s |
| audio mp3 256, efekty + przycięcie 5–12 | mp3, 22050 Hz, mono, 7,000 s |
| film mp4 720p, efekty + przycięcie 5–12 | h264 360x640 + aac 22050 Hz mono, obraz 7,000 s, dźwięk 7,000 s |
| „osobno” mp4 720p, efekty + przycięcie 5–12 | wideo: h264, bez dźwięku, 7,000 s; audio: mp3, 22050 Hz, mono, 7,000 s |
| strona: audio mp3 (ustawienia domyślne) | mp3, 33,152 s |
| strona: film mp4 720p, normalizacja + przycięcie | h264 + aac, 7,000 s |

- Każdy plik: nazwa bez `tmp-` i `processed-`, z 8-znakowym identyfikatorem; ffmpeg dekoduje cały plik bez błędów; `GET` pod adres z odpowiedzi (nazwa z `#`) zwraca 200 i cały plik.
- Pobrania z efektami: w poleceniu ffmpeg wypisanym przez serwer są filtry `loudnorm`, `acrusher` i `aresample=22050` (bitcrusha nie widać w `ffprobe`, więc potwierdza go tylko obecność filtra).
- Strona w Edge (prawdziwy serwer, prawdziwe pobranie): po wklejeniu linku i kliknięciu „Pobierz” na przycisku rośnie procent („Pobieram... 0%”, „1%”, „2%”, „5%”…), pole statusu pokazuje „Gotowe” z jednym linkiem, przeglądarka sama zapisuje plik pod nazwą z pola statusu, a zapisany plik jest bajt w bajt taki sam jak w `downloads`; przycisk wraca do „Pobierz”. W trybie filmu z panelem EXPERIMENTAL na przycisku pojawia się „Przetwarzam...”. Brak błędów skryptu strony, w tle nie ma linii `[error]`.
- Po wszystkich pobraniach w `downloads` jest dokładnie 10 plików wynikowych (bez oryginałów, plików tymczasowych i `.part`).
- Konsola serwera: brak nieobsłużonych wyjątków i śladów stosu; 16 wywołań yt-dlp i ffmpeg, wszystkie z kodem 0; program działał do końca.
- `npm test`: 739 testów, wszystkie przechodzą, żaden pomijany. `npm run test:przegladarka`: 40 testów, wszystkie przechodzą.
- Lista w `ZADANIA.md`: każde zadanie przed K1 ma tag `[ZROBIONE]` albo `[DO_OBEJRZENIA]` (WIZ B13j); żadne nie jest zablokowane. Bez tagu zostaje tylko K2.
- Po sprawdzeniu pliki próbne usunięte z `downloads`, serwer zatrzymany.

### Uwaga dla właściciela (poza zakresem zadania)

- Film testowy jest pionowy (najlepsza wersja 720x1280). Ustawienie „720p” daje plik 360x640, bo filtr formatu ogranicza wysokość obrazu (`height<=720`), a wysokość pionowego filmu 720p to 1280. Tak program działał od początku i żadne zadanie tego nie zmieniało; dla filmów poziomych 720p znaczy 1280x720. Jeśli pionowe filmy mają być pobierane w pełnej jakości, trzeba by ograniczać krótszy bok — to osobna decyzja.

### Niesprawdzone

- Ocena „na oko i ucho”: pliki nie były odtwarzane przez człowieka, tylko mierzone i dekodowane. Brzmienie bitcrusha i normalizacji nie było oceniane.
- Na stronie nie były klikane: tryb „osobno”, pokrętła bitcrush i sample rate, przełącznik mono/stereo (te ustawienia poszły przez API; ich obsługę na stronie pokrywają testy D3, U1 i U2 z podstawioną odpowiedzią serwera).
- Formaty inne niż mp3 i mp4 oraz rozdzielczości inne niż 720p w tym przeglądzie (sprawdzane w zadaniach B5–B12).
- Długie filmy i filmy poziome — film testowy ma 33 s i jest pionowy.
- Przeglądarki inne niż Edge.
- macOS (zadanie K2) i Linux: nic nie było uruchamiane.

## K2: Pełny przegląd (macOS) — ZABLOKOWANE

### Stan

- Zadanie nie zostało wykonane. Na Macu nic nie było uruchamiane: ani `npm install`, ani `npm test`, ani żadne pobranie, ani start z błędnym `YTDLP_PATH`.
- Kod programu, testy i README bez zmian. W tabeli „Na czym sprawdzono” w README macOS dalej figuruje jako niesprawdzony — zgodnie z prawdą.

### Powód

- 2026-11-14: `ssh spliffzilla@mac` kończy się błędem `Could not resolve hostname mac`. `ping mac` i `ping mac.local` też nie znajdują hosta. W `~/.ssh/config` i w pliku `hosts` nie ma wpisu `mac`.
- Usługa Tailscale na tym komputerze działa (wersja 1.94.2), ale `tailscale status` przez ponad minutę zwracał `unexpected state: NoState` z komunikatami „Tailscale is starting” i „Unable to connect to the Tailscale coordination server”. Internet działa (YouTube odpowiada). Przypuszczenie, nie fakt: nazwa `mac` pochodzi z Tailscale i dlatego się nie rozwiązuje.
- Usługi Tailscale nie restartowałem ani nie logowałem ponownie — to zmiana ustawień systemu poza zakresem zadania.
- Ten sam host był nieosiągalny przy P1, D1, G5 i G2, więc na macOS program nie był dotąd uruchomiony ani razu.

### Co zrobić, gdy Mac będzie dostępny

1. Sprawdzić połączenie: `ssh spliffzilla@mac "sw_vers"`.
2. Skopiować kod poleceniem z sekcji TRZY SYSTEMY w `ZADANIA.md`.
3. Na Macu (każde polecenie po `export PATH=/opt/homebrew/bin:$PATH;`), w `~/pobierak-test`: `npm install`, `npm test`.
4. Przegląd pobrań: `node testy/przeglad/przeglad-koncowy.js --wyczysc --bez-przegladarki` — te same sześć pobrań co w K1, pomiar `ffprobe`, dekodowanie, kontrola konsoli serwera. Opcja `--bez-przegladarki` jest potrzebna, bo część w przeglądarce wymaga Edge. Skrypt nie był uruchamiany na macOS, więc może sam wymagać poprawek.
5. Start z błędnym programem: `YTDLP_PATH=/nie/ma/yt-dlp PORT=3111 node app.js` — w konsoli ma być informacja o braku yt-dlp z podpowiedzią `brew install yt-dlp ffmpeg`, a serwer ma działać dalej. Zatrzymać serwer.
6. Wyniki porównać z tabelą w sekcji K1, różnice opisać tutaj, zaktualizować wiersz macOS w tabeli README (wersja systemu i wynik) i zmienić tag zadania.
7. Zaległe sprawdzenia na macOS z wcześniejszych zadań: P1 (audio mp3 i film mp4), D1 (`start.command` przy usuniętym `node_modules` i po `brew uninstall deno`), G5 (`npm test`), komendy macOS z README (G2).

### Lista dla właściciela (rzeczy, których nie da się sprawdzić przez SSH)

Dwuklik w `start.command`:

1. Pobrać ZIP z kodem, rozpakować, w Finderze kliknąć dwa razy `start.command`.
2. Jeśli macOS zablokuje plik: prawy przycisk → Otwórz (albo `sh start.command` w Terminalu).
3. Otwiera się okno Terminala; gdy czegoś brakuje, pada pytanie `Zainstalowac? [T/N]`; po chwili w domyślnej przeglądarce otwiera się `http://localhost:3000`.
4. Drugi dwuklik, gdy wszystko jest zainstalowane: skrypt o nic nie pyta.

Strona w Safari:

1. Nagłówek i polskie znaki (ą, ę, ł, ż) są w foncie Space Grotesk; karta, przycisk i tło z logami wyglądają jak w Edge na Windowsie.
2. Wkleić `https://www.youtube.com/shorts/jBoKCUKJkiY`, kliknąć „Pobierz”: na przycisku rośnie procent, pod przyciskiem pojawia się „Gotowe” z linkiem, plik mp3 sam się zapisuje i daje się odtworzyć.
3. Tryb „Film z dźwiękiem”, mp4: pobrany plik odtwarza się w QuickTime, obraz zgrany z dźwiękiem.
4. Tryb „osobno”: pod przyciskiem dwa linki, oba pliki się zapisują (Safari może zapytać o zgodę na pobranie kilku plików).
5. Panel EXPERIMENTAL: normalizacja + przycięcie `5`–`0:12` → na przycisku „Przetwarzam...”, plik ma 7 sekund.
6. Błędne przycięcie (start `2:00`, koniec `1:00`): czerwony komunikat pod przyciskiem, przycisk zostaje aktywny.
7. Sama klawiatura (Tab, strzałki, spacja): da się zmienić tryb, przełączyć mono/stereo, ruszyć pokrętła; fokus jest widoczny. W Safari Tab domyślnie pomija część elementów — w razie czego włączyć „Naciśnięcie Tab podświetla każdą rzecz na stronie” w ustawieniach Safari (zakładka Zaawansowane).

### Niesprawdzone

- Wszystko, co dotyczy macOS (cała treść zadania K2 oraz zaległe sprawdzenia z P1, D1, G5, G2).
- Linux: bez zmian, nic nie było uruchamiane.
