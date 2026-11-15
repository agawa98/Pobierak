#!/bin/sh
# Pobierak - uruchamianie dwuklikiem.
# MACOS-start.command (macOS) i LINUX-start.sh (Linux) maja te sama tresc poza poleceniem otwierajacym przegladarke.

# po dwukliku katalogiem biezacym jest zwykle folder domowy, wiec najpierw przejscie do folderu programu
cd "$(dirname "$0")" || exit 1

SYSTEM="$(uname -s)"

# macOS: Homebrew bywa poza PATH (dwuklik, SSH), wiec jego foldery sa dokladane, jesli istnieja
if [ "$SYSTEM" = "Darwin" ]; then
    for FOLDER in /opt/homebrew/bin /usr/local/bin; do
        if [ -d "$FOLDER" ]; then
            case ":$PATH:" in
                *":$FOLDER:"*) ;;
                *) PATH="$FOLDER:$PATH" ;;
            esac
        fi
    done
    export PATH
fi

jest_program() {
    command -v "$1" >/dev/null 2>&1
}

# yt-dlp i ffmpeg licza sie tez jako obecne, gdy leza w folderze bin obok skryptu
szukaj_brakow() {
    BRAK=""
    jest_program node || BRAK="$BRAK node"
    jest_program yt-dlp || [ -f "bin/yt-dlp" ] || BRAK="$BRAK yt-dlp"
    jest_program ffmpeg || [ -f "bin/ffmpeg" ] || BRAK="$BRAK ffmpeg"
    jest_program deno || BRAK="$BRAK deno"
}

szukaj_brakow

if [ -n "$BRAK" ]; then
    echo "Brakuje programow:$BRAK"

    if [ "$SYSTEM" = "Darwin" ]; then
        if ! jest_program brew; then
            echo "Do instalacji potrzebny jest Homebrew: https://brew.sh"
            echo "Zainstaluj go ta komenda (wklej w Terminalu):"
            echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
            echo "Po instalacji uruchom ten skrypt jeszcze raz."
            exit 1
        fi

        # instalacja tylko po wyraznej zgodzie i tylko tego, czego brakuje
        printf "Zainstalowac? [T/N] "
        read -r ODP
        case "$ODP" in
            [Tt]*) ;;
            *)
                echo "Nic nie zostalo zainstalowane. Brakuje:$BRAK"
                echo "Instalacja reczna jest opisana w README."
                exit 1
                ;;
        esac

        # shellcheck disable=SC2086
        brew install $BRAK

        szukaj_brakow
        if [ -n "$BRAK" ]; then
            echo "Nadal brakuje:$BRAK"
            echo "Instalacja sie nie powiodla. Instalacja reczna jest opisana w README."
            exit 1
        fi
    else
        # Linux: skrypt niczego nie instaluje
        echo "Ten skrypt niczego nie instaluje. Zainstaluj brakujace programy menedzerem pakietow, np.:"
        echo "  Debian/Ubuntu:  sudo apt install nodejs npm ffmpeg"
        echo "  Fedora:         sudo dnf install nodejs npm ffmpeg"
        echo "  Arch:           sudo pacman -S nodejs npm ffmpeg deno"
        echo "Deno (gdy nie ma go w repozytorium systemu): https://deno.com"
        echo "yt-dlp lepiej wziac z oficjalnego pliku (https://github.com/yt-dlp/yt-dlp/releases)"
        echo "albo przez pipx (pipx install yt-dlp) - wersje z repozytoriow bywaja za stare."
        echo "Szczegoly sa w README. Potem uruchom ten skrypt jeszcze raz."
        exit 1
    fi
fi

# pierwsze uruchomienie: zaleznosci programu
if [ ! -d "node_modules" ]; then
    echo "Instaluje zaleznosci (npm install)..."
    if ! npm install; then
        echo "npm install sie nie powiodl."
        exit 1
    fi
fi

ADRES="http://localhost:${PORT:-3000}"

# przegladarka otwiera sie po chwili, zeby serwer zdazyl wystartowac
(sleep 2; xdg-open "$ADRES") >/dev/null 2>&1 &

exec node app.js
