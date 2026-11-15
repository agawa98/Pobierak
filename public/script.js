const typeInputs = document.querySelectorAll('input[name="type"]');

const workspace = document.querySelector("#workspace");
const experimentalToggle = document.querySelector("#experimentalToggle");

const optionsRow = document.querySelector("#optionsRow");
const resolutionSelect = document.querySelector("#resolution");
const formatSelect = document.querySelector("#format");

const leftOptionLabel = document.querySelector("#leftOptionLabel");
const formatLabel = document.querySelector("#formatLabel");

const bitrateBox = document.querySelector("#bitrateBox");
const bitrateSlider = document.querySelector("#bitrate");

const terminalLogs = document.querySelector("#terminalLogs");
const downloadForm = document.querySelector("#downloadForm");

const bitcrushKnob = document.querySelector("#bitcrushKnob");
const bitcrushDial = document.querySelector("#bitcrushDial");
const bitcrushValue = document.querySelector("#bitcrushValue");

const sampleRateKnob = document.querySelector("#sampleRateKnob");
const sampleRateDial = document.querySelector("#sampleRateDial");
const sampleRateValue = document.querySelector("#sampleRateValue");

const downloadButton = document.querySelector("#downloadButton");
const buttonLoader = document.querySelector(".button-loader");
const buttonText = document.querySelector(".button-text");
const statusBox = document.querySelector("#statusBox");

const channelsSwitch = document.querySelector("#channelsSwitch");
const normalizeCheckbox = document.querySelector("#normalize");
const trimStartInput = document.querySelector("#trimStart");
const trimEndInput = document.querySelector("#trimEnd");
const trimValidation = document.querySelector("#trimValidation");
const urlInput = document.querySelector("#url");
const urlValidation = document.querySelector("#urlValidation");

const folderBlock = document.querySelector("#folderBlock");
const folderPath = document.querySelector("#folderPath");
const chooseFolderButton = document.querySelector("#chooseFolderButton");
const folderManual = document.querySelector("#folderManual");
const folderManualInput = document.querySelector("#folderManualInput");
const folderManualSave = document.querySelector("#folderManualSave");
const folderMessage = document.querySelector("#folderMessage");

const audioFormats = ["mp3", "wav", "m4a", "flac"];
const videoFormats = ["mp4", "mpeg", "mjpeg", "mkv"];
const bitrateValues = ["16", "32", "64", "128", "256", "320", "best"];

const sampleRateValues = [
  "8000",
  "11025",
  "12000",
  "16000",
  "22050",
  "24000",
  "32000",
  "44100",
  "48000",
  "default"
];

let currentMode = null;


const backendLogs = new EventSource("/api/logs");

// dzieli wiadomosc z backendu na osobne linie. yt-dlp i ffmpeg koncza linie przez \n, \r\n albo samo \r (postep)
function splitLogLines(message) {
  return String(message)
    .split(/\r\n|\n|\r/)
    .map(line => line.trim())
    .filter(line => line !== "");
}

// flaga: trwa pobieranie. ustawia ją handleDownloadSubmit, a logi z backendu zmieniają wtedy napis na przycisku
let isDownloading = false;

// postęp na przycisku: linia "[download] NN%" z yt-dlp daje "Pobieram... NN%", a log z ffmpeg daje "Przetwarzam..."
function updateButtonProgress(type, line) {
  if (!isDownloading) {
    return;
  }

  if (String(type).startsWith("FFMPEG")) {
    buttonText.textContent = "Przetwarzam...";
    return;
  }

  const match = line.match(/\[download\]\s+([\d.]+)%/);

  if (!match) {
    return;
  }

  const percent = Math.floor(Number(match[1]));

  if (Number.isNaN(percent)) {
    return;
  }

  buttonText.textContent = `Pobieram... ${percent}%`;
}

backendLogs.onmessage = (event) => {
  const log = JSON.parse(event.data);

  const lines = splitLogLines(log.message);

  lines.forEach(line => {
    addLog(log.type, line);
    updateButtonProgress(log.type, line);
  });
};

// przeglądarka ponawia połączenie co kilka sekund i za każdym razem zgłasza błąd,
// więc komunikat o utracie połączenia jest dodawany tylko raz, do czasu ponownego połączenia
let backendLogsLost = false;

backendLogs.onopen = () => {
  backendLogsLost = false;
};

backendLogs.onerror = () => {
  if (backendLogsLost) {
    return;
  }

  backendLogsLost = true;
  addLog("error", "Utracono połączenie z logami backendu.");
};

function trimLogs() {
  while (terminalLogs.children.length > 42) {
    terminalLogs.removeChild(terminalLogs.firstElementChild);
  }
}

function addLog(type, message) {
  const line = document.createElement("p");

  // UL-4: ostrzeżenie (np. o starym yt-dlp) ma własną klasę - czerwone, pełnym kolorem
  if (type === "warning") {
    line.className = "log-warning";
  }

  // typ i treść jako zwykły tekst, żeby znaczniki z logów nie były wykonywane jako HTML
  const typeLabel = document.createElement("span");
  typeLabel.textContent = `[${type}]`;

  line.appendChild(typeLabel);
  line.appendChild(document.createTextNode(` ${message}`));

  terminalLogs.appendChild(line);
  trimLogs();

  terminalLogs.scrollTop = terminalLogs.scrollHeight;
}

function fillFormatSelect(formats) {
  formatSelect.innerHTML = "";

  formats.forEach((format) => {
    const option = document.createElement("option");
    option.value = format;
    option.textContent = format.toUpperCase();
    formatSelect.appendChild(option);
  });
}

// UL-1: 1440p i 2160p sa tylko dla MKV - przy innym formacie wyszarzone, a wybrane wraca do 1080p
function updateResolutionAvailability() {
  const isMkv = formatSelect.value === "mkv";

  resolutionSelect.querySelectorAll("option[data-mkv-only]").forEach((option) => {
    option.disabled = !isMkv;
  });

  const selectedOption = resolutionSelect.selectedOptions[0];

  if (!isMkv && selectedOption && selectedOption.hasAttribute("data-mkv-only")) {
    resolutionSelect.value = "1080";
    addLog("ui", `Rozdzielczość ${selectedOption.textContent} jest tylko dla MKV. Ustawiam 1080p.`);
  }
}

function getSelectedType() {
  return document.querySelector('input[name="type"]:checked').value;
}

function getSelectedBitrate() {
  const sliderIndex = Number(bitrateSlider.value);
  return bitrateValues[sliderIndex];
}

function updateOptions() {
  const selectedType = getSelectedType();
  const isAudioOnly = selectedType === "audio";
  const newMode = isAudioOnly ? "audio" : "video";

  if (newMode === currentMode) {
    return;
  }

  if (isAudioOnly) {
    optionsRow.classList.remove("video-mode");
    optionsRow.classList.add("audio-mode");

    leftOptionLabel.textContent = "Bitrate";
    formatLabel.textContent = "Format audio";

    bitrateBox.classList.remove("is-hidden");
    resolutionSelect.classList.add("is-hidden");

    bitrateSlider.disabled = false;
    resolutionSelect.disabled = true;

    fillFormatSelect(audioFormats);
    addLog("ui", "Wybrano tylko audio. Pokazuję bitrate i format audio.");
  } else {
    optionsRow.classList.remove("audio-mode");
    optionsRow.classList.add("video-mode");

    leftOptionLabel.textContent = "Rozdzielczość";
    formatLabel.textContent = "Format wideo";

    bitrateBox.classList.add("is-hidden");
    resolutionSelect.classList.remove("is-hidden");

    bitrateSlider.disabled = true;
    resolutionSelect.disabled = false;

    fillFormatSelect(videoFormats);
    updateResolutionAvailability();
    addLog("ui", "Wybrano tryb wideo. Pokazuję rozdzielczość i format wideo.");
  }

  currentMode = newMode;
}

function formatSampleRateLabel(value) {
  if (value === "default") {
    return "default";
  }

  const numberValue = Number(value);

  if (numberValue >= 1000) {
    return `${numberValue / 1000}k`;
  }

  return value;
}

function updateKnobVisual(knob, dial, output, values = null) {
  const min = Number(knob.min);
  const max = Number(knob.max);
  const value = Number(knob.value);
  const percent = (value - min) / (max - min);
  const angle = -135 + percent * 270;

  dial.style.setProperty("--knob-angle", `${angle}deg`);

  if (values) {
    output.textContent = formatSampleRateLabel(values[value]);
    return;
  }

  output.textContent = value === 0 ? "off" : value;
}

function setupRotaryKnob(knob, dial, output, values = null) {
  function setFromPointer(event) {
    const rect = dial.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = event.clientX - centerX;
    const dy = event.clientY - centerY;

    let angle = Math.atan2(dx, -dy) * (180 / Math.PI);

    if (angle < -135) {
      angle = -135;
    }

    if (angle > 135) {
      angle = 135;
    }

    const min = Number(knob.min);
    const max = Number(knob.max);
    const percent = (angle + 135) / 270;
    const newValue = Math.round(min + percent * (max - min));

    knob.value = String(newValue);
    updateKnobVisual(knob, dial, output, values);
  }

  dial.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    dial.setPointerCapture(event.pointerId);
    setFromPointer(event);
  });

  dial.addEventListener("pointermove", (event) => {
    if (event.buttons !== 1) {
      return;
    }

    setFromPointer(event);
  });

  knob.addEventListener("input", () => {
    updateKnobVisual(knob, dial, output, values);
  });

  updateKnobVisual(knob, dial, output, values);
}

function parseTimeToSeconds(value) {
  const cleanValue = value.trim();

  if (cleanValue === "") {
    return null;
  }

  // tylko cyfry i najwyzej dwa dwukropki (SS, MM:SS, GG:MM:SS). odpada np. 1::2, 0x10, 1e3, -5, 1.5
  // to samo sprawdzenie jest w app.js - obie funkcje maja dawac identyczne wyniki
  if (!/^\d+(:\d+){0,2}$/.test(cleanValue)) {
    return NaN;
  }

  const parts = cleanValue.split(":").map(Number);

  if (parts.some(Number.isNaN)) {
    return NaN;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    if (parts[1] > 59) {
      return NaN;
    }

    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    if (parts[1] > 59 || parts[2] > 59) {
      return NaN;
    }

    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return NaN;
}

// funkcja sprawdzajaca link YouTube i Pinterest przed pobieraniem: null = link przyjety, tekst = komunikat bledu.
// YouTube: przyjmuje tylko link do jednego filmu, odrzuca playlisty, kanaly i inne strony YouTube.
// Pinterest (UL-8b): przyjmuje /pin/<id> i krotki link pin.it/<kod>, odrzuca tablice, profile, wyszukiwanie i strone glowna.
// pin.it nie da sie ocenic po adresie (moze prowadzic do tablicy) - zabezpieczeniem jest --playlist-items 1 z BUG-1b.
// linki z innych serwisow (i takie, ktorych nie da sie odczytac) przepuszcza bez oceny - ocenia je yt-dlp albo reszta walidacji.
// ta sama funkcja jest w app.js - obie kopie maja dawac identyczne wyniki
function sprawdzLinkYoutube(url) {
  const youtubeHosts = [
    "youtube.com",
    "www.youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtube-nocookie.com",
    "www.youtube-nocookie.com",
    "youtu.be"
  ];
  const playlistMessage = "To link do playlisty. Wklej link do jednego filmu.";
  const channelMessage = "To link do kanału. Wklej link do jednego filmu.";
  const notVideoMessage = "To nie jest link do filmu.";
  const notPinMessage = "To nie jest link do pina. Wklej link do jednego pina z filmem.";
  // pinterest.com i wersje krajowe (lista koncowek jak w yt-dlp), z jedna poddomena (www, pl, uk...) albo bez
  const pinterestHost = /^(?:[a-z0-9-]+\.)?pinterest\.(?:com|co\.uk|uk|de|fr|ch|jp|cl|ca|it|nz|ru|com\.au|at|pt|co\.kr|kr|es|com\.mx|mx|dk|ph|th|com\.uy|co|nl|info|ie|vn|com\.vn|ec|com\.ec|in|co\.in|pe|com\.pe|co\.at|hu|id|com\.py|tw|be|com\.bo|co\.nz|se|no|fi|pl|com\.br|cz|gr|sk|ro)$/;

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  // czesci sciezki bez pustych (ukosnik na koncu i podwojne ukosniki nie maja znaczenia)
  const parts = parsedUrl.pathname.split("/").filter(part => part !== "");
  const first = parts.length > 0 ? parts[0] : "";

  if (parsedUrl.hostname === "pin.it") {
    return parts.length === 1 ? null : notPinMessage;
  }

  if (pinterestHost.test(parsedUrl.hostname)) {
    // /pin/<id> takze z koncowka, np. /pin/<id>/sent/?invite_code=... z przycisku Udostepnij
    return first === "pin" && parts.length >= 2 ? null : notPinMessage;
  }

  if (!youtubeHosts.includes(parsedUrl.hostname)) {
    return null;
  }

  const videoId = parsedUrl.searchParams.get("v");
  const listId = parsedUrl.searchParams.get("list");

  if (parsedUrl.hostname === "youtu.be") {
    return parts.length === 1 ? null : notVideoMessage;
  }

  if (parts.length === 1 && first === "watch") {
    if (videoId) {
      return null;
    }

    return listId ? playlistMessage : notVideoMessage;
  }

  if (parts.length === 1 && first === "playlist" && listId) {
    return playlistMessage;
  }

  if (parts.length === 2 && ["shorts", "live", "embed"].includes(first)) {
    return null;
  }

  // kanal z dowolna podstrona (np. /videos, /shorts, /streams, /live)
  if ((first.startsWith("@") && first.length > 1) || (["channel", "c", "user"].includes(first) && parts.length >= 2)) {
    return channelMessage;
  }

  return notVideoMessage;
}

// pokazuje błąd linku pod polem linku; zwraca true, gdy link jest przyjęty
function validateUrl() {
  const error = sprawdzLinkYoutube(urlInput.value);

  urlValidation.textContent = error || "";
  urlValidation.classList.toggle("is-error", Boolean(error));

  return !error;
}

function validateTrim() {
  const start = parseTimeToSeconds(trimStartInput.value);
  const end = parseTimeToSeconds(trimEndInput.value);

  trimValidation.textContent = "";
  trimValidation.classList.remove("is-error");

  if (Number.isNaN(start) || Number.isNaN(end)) {
    trimValidation.textContent = "Użyj formatu GG:MM:SS";
    trimValidation.classList.add("is-error");
    return false;
  }

  if (start !== null && end !== null && start >= end) {
    trimValidation.textContent = "Początek musi być mniejszy niż koniec.";
    trimValidation.classList.add("is-error");
    return false;
  }

  return true;
}

function getExperimentalOptions() {
  return {
    bitcrush: Number(bitcrushKnob.value),
    sampleRate: sampleRateValues[Number(sampleRateKnob.value)],
    channels: channelsSwitch.checked ? "stereo" : "mono",
    normalize: normalizeCheckbox.checked,
    trimStart: trimStartInput.value.trim(),
    trimEnd: trimEndInput.value.trim()
  };
}

// czyści i chowa pole statusu pod przyciskiem
function clearStatus() {
  statusBox.textContent = "";
  statusBox.classList.remove("is-error");
  statusBox.classList.remove("is-success");
  statusBox.classList.add("hidden");
}

// pokazuje błąd w polu statusu. treść idzie przez textContent, nie innerHTML
function showStatusError(message) {
  clearStatus();

  const title = document.createElement("p");
  title.textContent = message;
  statusBox.appendChild(title);

  statusBox.classList.add("is-error");
  statusBox.classList.remove("hidden");
}

// pokazuje "Gotowe — zapisano:" i pełną ścieżkę każdego pliku z odpowiedzi serwera ({ name, path }).
// pliki są już w folderze docelowym, więc w polu nie ma linków - sam tekst
function showStatusSuccess(files) {
  clearStatus();

  const title = document.createElement("p");
  title.textContent = "Gotowe — zapisano:";
  statusBox.appendChild(title);

  if (Array.isArray(files)) {
    files.forEach((file) => {
      if (!file || typeof file !== "object") {
        return;
      }

      const line = document.createElement("p");
      line.className = "status-file";
      line.textContent = String(file.path || file.name || "");
      statusBox.appendChild(line);
    });
  }

  statusBox.classList.add("is-success");
  statusBox.classList.remove("hidden");
}

async function handleDownloadSubmit(event) {
  event.preventDefault();

  // walidacja przed wylaczeniem przycisku: przy blednym czasie przycisk w ogole nie zmienia stanu
  if (!validateUrl()) {
    addLog("error", urlValidation.textContent);
    showStatusError(urlValidation.textContent);
    return;
  }

  if (!validateTrim()) {
    addLog("error", trimValidation.textContent);
    showStatusError(trimValidation.textContent);
    return;
  }

  // bez folderu przycisk jest wyłączony; to sprawdzenie zostaje na wypadek wysłania formularza inną drogą
  const folder = getTargetFolder();

  if (!folder) {
    addLog("error", noFolderMessage);
    showStatusError(noFolderMessage);
    return;
  }

  clearStatus();

  downloadButton.disabled = true;
  buttonLoader.classList.remove("hidden");
  buttonText.textContent = "Pobieram...";
  isDownloading = true;

  const selectedType = getSelectedType();

  const formData = {
    url: document.querySelector("#url").value,
    type: selectedType,
    bitrate: selectedType === "audio" ? getSelectedBitrate() : null,
    resolution: selectedType === "audio" ? null : resolutionSelect.value,
    format: formatSelect.value,
    folder,
    experimental: getExperimentalOptions()
  };

  addLog("request", "Wysyłam dane do backendu...");

  try {
    let response;

    // ten komunikat jest tylko dla błędu samego fetch (serwer nie odpowiedział)
    try {
      response = await fetch("/api/download", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(formData)
      });
    } catch (error) {
      addLog("error", "Nie udało się połączyć z backendem.");
      showStatusError("Nie udało się połączyć z backendem.");
      console.error(error);
      return;
    }

    let result = null;

    // serwer odpowiedział, ale nie JSON-em (np. strona błędu z innego programu na tym porcie)
    try {
      result = await response.json();
    } catch (error) {
      console.error(error);
    }

    if (result === null || typeof result !== "object") {
      const unexpectedMessage = `Serwer zwrócił nieoczekiwaną odpowiedź (HTTP ${response.status}).`;

      addLog("error", unexpectedMessage);
      showStatusError(unexpectedMessage);
      return;
    }

    if (!response.ok) {
      const errorMessage = result.message || "Backend zwrócił błąd.";

      addLog("error", errorMessage);
      showStatusError(errorMessage);

      // serwer odrzucił folder (nie istnieje, nie da się w nim zapisać...): wiersz folderu prosi o wybór od nowa
      if (isFolderError(response.status, errorMessage)) {
        markFolderError();
      }

      return;
    }

    addLog("success", result.message);
    showStatusSuccess(result.files);

    if (Array.isArray(result.files)) {
      result.files.forEach((file) => {
        if (file && file.path) {
          addLog("file", `Zapisano: ${file.path}`);
        }
      });
    }

    // lista zapisanych plików dla handleFormSubmit (przycisk "Pokaż w folderze", zadanie UL-2d)
    return result.files;

  } finally {
    isDownloading = false;
    downloadButton.disabled = false;
    buttonLoader.classList.add("hidden");
    buttonText.textContent = "Pobierz";
 }
}

// ---------- folder docelowy (zadanie UL-2c) ----------

// klucz w localStorage, pod którym strona pamięta wybrany folder
const folderStorageKey = "pobierak.folderDocelowy";
const noFolderMessage = "Najpierw wybierz folder docelowy";

// wybrany folder docelowy (pełna ścieżka) albo "" - folder nie jest ustawiony
let targetFolder = "";

function getTargetFolder() {
  return targetFolder;
}

// odczyt zapamiętanego folderu. localStorage może być niedostępny (np. zablokowany w przeglądarce) - wtedy ""
function readSavedFolder() {
  try {
    const saved = localStorage.getItem(folderStorageKey);

    return typeof saved === "string" ? saved.trim() : "";
  } catch (error) {
    console.error(error);
    return "";
  }
}

function saveFolder(folder) {
  try {
    localStorage.setItem(folderStorageKey, folder);
  } catch (error) {
    console.error(error);
  }
}

// komunikat pod wierszem folderu; isError = czerwony
function setFolderMessage(message, isError) {
  folderMessage.textContent = message;
  folderMessage.classList.toggle("is-error", Boolean(isError));
}

// pokazuje wybrany folder i włącza albo wyłącza przycisk "Pobierz" (w trakcie pobierania przycisk zostaje wyłączony)
function updateFolderView() {
  folderPath.textContent = targetFolder || "nie wybrano";
  folderPath.classList.toggle("is-empty", !targetFolder);

  if (targetFolder) {
    downloadButton.removeAttribute("title");

    // podpowiedź "najpierw wybierz" (np. ta z index.html przy starcie strony) znika, inne komunikaty zostają
    if (folderMessage.textContent === noFolderMessage) {
      setFolderMessage("", false);
    }
  } else {
    downloadButton.setAttribute("title", noFolderMessage);
    setFolderMessage(noFolderMessage, false);
  }

  if (!isDownloading) {
    downloadButton.disabled = !targetFolder;
  }
}

// ustawia i zapamiętuje folder docelowy
function setTargetFolder(folder) {
  targetFolder = folder;
  saveFolder(folder);

  folderBlock.classList.remove("is-error");
  folderManual.classList.add("hidden");
  setFolderMessage("", false);
  updateFolderView();

  addLog("ui", `Folder docelowy: ${folder}`);
}

// pokazuje pole do ręcznego wklejenia ścieżki (gdy serwer nie umie otworzyć okna wyboru folderu)
function showManualFolder(message) {
  folderManual.classList.remove("hidden");
  folderManualInput.value = targetFolder;
  setFolderMessage(message, true);
  folderManualInput.focus();
}

// zapis ścieżki z pola ręcznego. czy to istniejący folder, sprawdza serwer przy pobieraniu
function handleManualFolderSave() {
  const folder = folderManualInput.value.trim();

  if (!folder) {
    setFolderMessage("Wklej pełną ścieżkę folderu.", true);
    return;
  }

  setTargetFolder(folder);
}

// czy błąd z /api/download dotyczy folderu: wszystkie komunikaty serwera o folderze docelowym zawierają słowo "folder"
function isFolderError(status, message) {
  return status === 400 && /folder/i.test(String(message));
}

// po odrzuceniu folderu przez serwer: wiersz folderu na czerwono i prośba o wybór od nowa
function markFolderError() {
  folderBlock.classList.add("is-error");
  setFolderMessage("Wybierz folder docelowy od nowa.", true);
}

// "Wybierz folder…": serwer otwiera systemowe okno (POST /api/folder/wybierz, zadanie UL-2a).
// odpowiedź: result "selected" (z folder), "cancelled" albo "unavailable" (z message)
async function handleChooseFolder() {
  chooseFolderButton.disabled = true;
  addLog("ui", "Otwieram okno wyboru folderu...");

  try {
    let response;

    try {
      response = await fetch("/api/folder/wybierz", { method: "POST" });
    } catch (error) {
      console.error(error);
      addLog("error", "Nie udało się połączyć z backendem.");
      setFolderMessage("Nie udało się połączyć z backendem.", true);
      return;
    }

    let result = null;

    try {
      result = await response.json();
    } catch (error) {
      console.error(error);
    }

    if (!response.ok || result === null || typeof result !== "object") {
      const message = result !== null && typeof result === "object" && result.message
        ? String(result.message)
        : `Serwer zwrócił nieoczekiwaną odpowiedź (HTTP ${response.status}).`;

      addLog("error", message);
      setFolderMessage(message, true);
      return;
    }

    if (result.result === "selected" && typeof result.folder === "string" && result.folder.trim() !== "") {
      setTargetFolder(result.folder.trim());
      return;
    }

    if (result.result === "cancelled") {
      addLog("ui", "Okno wyboru folderu zamknięte bez wyboru.");
      return;
    }

    // "unavailable" (i każda inna odpowiedź): okna nie da się otworzyć, zostaje ręczne wklejenie ścieżki
    const reason = result.message ? String(result.message) : "Nie da się otworzyć okna wyboru folderu.";

    addLog("error", reason);
    showManualFolder(`${reason} Wklej ścieżkę folderu ręcznie.`);
  } finally {
    chooseFolderButton.disabled = false;
  }
}

function toggleExperimentalPanel() {
  const isOpen = workspace.classList.toggle("is-experimental-open");

  experimentalToggle.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    addLog("ui", "Otworzono experimental options.");
  } else {
    addLog("ui", "Zamknięto experimental options.");
  }
}

// ---------- "Pokaż w folderze" (zadanie UL-2d) ----------

const showInFolderText = "Pokaż w folderze";

// pełna ścieżka pliku, który pokaże kliknięcie przycisku; "" = przycisk jest zwykłym "Pobierz"
let fileToShow = "";

// plik do pokazania z odpowiedzi serwera: pierwszy z pełną ścieżką. w trybie "osobno" serwer podaje najpierw wideo, potem dźwięk
function pickFileToShow(files) {
  if (!Array.isArray(files)) {
    return "";
  }

  const file = files.find(item => item && typeof item.path === "string" && item.path !== "");

  return file ? file.path : "";
}

// zamienia przycisk w "Pokaż w folderze" (z podaną ścieżką) albo z powrotem w "Pobierz" (pusta ścieżka)
function setFileToShow(filePath) {
  fileToShow = filePath;
  buttonText.textContent = filePath ? showInFolderText : "Pobierz";
  downloadButton.classList.toggle("is-show-folder", Boolean(filePath));
}

// przycisk wraca do "Pobierz" (wpisanie czegoś w pole linku, kliknięcie "Pokaż w folderze")
function resetFileToShow() {
  if (fileToShow) {
    setFileToShow("");
  }
}

// "Pokaż w folderze": serwer otwiera folder docelowy z zaznaczonym plikiem (POST /api/folder/pokaz).
// przycisk od razu wraca do "Pobierz", nie czekając na odpowiedź
async function handleShowInFolder() {
  const filePath = fileToShow;

  setFileToShow("");
  addLog("ui", `Pokazuję w folderze: ${filePath}`);

  let response;

  try {
    response = await fetch("/api/folder/pokaz", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: filePath })
    });
  } catch (error) {
    console.error(error);
    addLog("error", "Nie udało się połączyć z backendem.");
    showStatusError("Nie udało się połączyć z backendem.");
    return;
  }

  if (response.ok) {
    return;
  }

  let result = null;

  try {
    result = await response.json();
  } catch (error) {
    console.error(error);
  }

  const message = result !== null && typeof result === "object" && result.message
    ? String(result.message)
    : `Nie udało się otworzyć folderu (HTTP ${response.status}).`;

  addLog("error", message);
  showStatusError(message);
}

// wysłanie formularza: przycisk "Pokaż w folderze" pokazuje plik, zwykły "Pobierz" pobiera.
// po udanym pobraniu przycisk zamienia się w "Pokaż w folderze" - chyba że w trakcie zmienił się link
async function handleFormSubmit(event) {
  if (fileToShow) {
    event.preventDefault();
    await handleShowInFolder();
    return;
  }

  const urlBefore = urlInput.value;
  const files = await handleDownloadSubmit(event);
  const filePath = pickFileToShow(files);

  if (filePath && urlInput.value === urlBefore) {
    setFileToShow(filePath);
  }
}

typeInputs.forEach((input) => {
  input.addEventListener("change", updateOptions);
});

formatSelect.addEventListener("change", updateResolutionAvailability);

urlInput.addEventListener("input", validateUrl);
urlInput.addEventListener("input", resetFileToShow);
trimStartInput.addEventListener("input", validateTrim);
trimEndInput.addEventListener("input", validateTrim);

experimentalToggle.addEventListener("click", toggleExperimentalPanel);
downloadForm.addEventListener("submit", handleFormSubmit);

chooseFolderButton.addEventListener("click", handleChooseFolder);
folderManualSave.addEventListener("click", handleManualFolderSave);

// Enter w polu ścieżki zapisuje ścieżkę zamiast wysyłać formularz pobierania
folderManualInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    handleManualFolderSave();
  }
});

addLog("system", "Pobierak uruchomiony.");
addLog("info", "Czekam na link do filmu...");

setupRotaryKnob(bitcrushKnob, bitcrushDial, bitcrushValue);
setupRotaryKnob(sampleRateKnob, sampleRateDial, sampleRateValue, sampleRateValues);
updateOptions();

targetFolder = readSavedFolder();
updateFolderView();