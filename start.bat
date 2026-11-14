@echo off
rem Pobierak - uruchamianie dwuklikiem (Windows).
setlocal EnableExtensions

rem po dwukliku katalog biezacy bywa inny, wiec najpierw przejscie do folderu programu
cd /d "%~dp0"

rem ---- wymagane programy ----
rem yt-dlp i ffmpeg licza sie tez jako obecne, gdy leza w folderze bin obok skryptu
set "BRAK="
where node >nul 2>nul
if errorlevel 1 set "BRAK=%BRAK% node"
where yt-dlp >nul 2>nul
if errorlevel 1 if not exist "bin\yt-dlp.exe" set "BRAK=%BRAK% yt-dlp"
where ffmpeg >nul 2>nul
if errorlevel 1 if not exist "bin\ffmpeg.exe" set "BRAK=%BRAK% ffmpeg"
where deno >nul 2>nul
if errorlevel 1 set "BRAK=%BRAK% deno"

if not defined BRAK goto uruchom

echo Brakuje programow:%BRAK%

where winget >nul 2>nul
if errorlevel 1 goto brak_winget

rem instalacja tylko po wyraznej zgodzie i tylko tego, czego brakuje
choice /c TN /n /m "Zainstalowac? [T/N] "
if not "%errorlevel%"=="1" goto odmowa

for %%P in (%BRAK%) do call :instaluj %%P

echo.
echo Instalacja zakonczona. Zamknij to okno i uruchom start.bat jeszcze raz -
echo nowe programy sa widoczne dopiero w nowym oknie.
echo Jesli po ponownym uruchomieniu nadal czegos brakuje, zajrzyj do README.
pause
exit /b 0

:instaluj
rem pakiet yt-dlp.yt-dlp sam dociaga yt-dlp.FFmpeg i DenoLand.Deno jako zaleznosci
if /i "%~1"=="node" call winget install --id OpenJS.NodeJS.LTS -e
if /i "%~1"=="yt-dlp" call winget install --id yt-dlp.yt-dlp -e
if /i "%~1"=="ffmpeg" call winget install --id yt-dlp.FFmpeg -e
if /i "%~1"=="deno" call winget install --id DenoLand.Deno -e
exit /b 0

:brak_winget
echo Nie znaleziono programu winget, wiec skrypt niczego nie zainstaluje.

:odmowa
echo Nic nie zostalo zainstalowane. Brakuje:%BRAK%
echo Instalacja reczna jest opisana w README.
pause
exit /b 1

:uruchom
rem pierwsze uruchomienie: zaleznosci programu
if exist "node_modules" goto start_programu
echo Instaluje zaleznosci (npm install)...
call npm install
if not errorlevel 1 goto start_programu
echo npm install sie nie powiodl.
pause
exit /b 1

:start_programu
if not defined PORT set "PORT=3000"

rem przegladarka otwiera sie po chwili (ping jako opoznienie), zeby serwer zdazyl wystartowac
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul && start http://localhost:%PORT%"

call node app.js
if errorlevel 1 pause
