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

// funkcja sprawdzajaca link YouTube przed pobieraniem: null = link przyjety, tekst = komunikat bledu.
// przyjmuje tylko link do jednego filmu, odrzuca playlisty, kanaly i inne strony YouTube.
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

  let parsedUrl;

  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }

  if (!youtubeHosts.includes(parsedUrl.hostname)) {
    return null;
  }

  // czesci sciezki bez pustych (ukosnik na koncu i podwojne ukosniki nie maja znaczenia)
  const parts = parsedUrl.pathname.split("/").filter(part => part !== "");
  const first = parts.length > 0 ? parts[0] : "";
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

  if (start !== null && start < 0) {
    trimValidation.textContent = "Początek nie może być mniejszy od zera.";
    trimValidation.classList.add("is-error");
    return false;
  }

  if (end !== null && end < 0) {
    trimValidation.textContent = "Koniec nie może być mniejszy od zera.";
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

// pokazuje "Gotowe" i link do każdego pliku z odpowiedzi serwera ({ name, url })
function showStatusSuccess(files) {
  clearStatus();

  const title = document.createElement("p");
  title.textContent = "Gotowe";
  statusBox.appendChild(title);

  if (Array.isArray(files)) {
    files.forEach((file) => {
      const link = document.createElement("a");
      link.textContent = file.name;
      link.href = file.url;
      link.download = file.name;
      statusBox.appendChild(link);
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
      return;
    }

    addLog("success", result.message);
    showStatusSuccess(result.files);

    if (result.downloadUrls && Array.isArray(result.downloadUrls)) {
        addLog("file", "Rozpoczynam automatyczne pobieranie kilku plików...");

        result.downloadUrls.forEach((url, index) => {
            setTimeout(() => {
                const downloadAnchor = document.createElement("a");
                downloadAnchor.href = url;
                downloadAnchor.download = "";
                document.body.appendChild(downloadAnchor);
                downloadAnchor.click();
                document.body.removeChild(downloadAnchor);
            }, index * 700);
        });
    } else if (result.downloadUrl) {
        addLog("file", "Rozpoczynam automatyczne pobieranie pliku...");

        const downloadAnchor = document.createElement("a");
        downloadAnchor.href = result.downloadUrl;
        downloadAnchor.download = "";
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        document.body.removeChild(downloadAnchor);
    }
    addLog("data", JSON.stringify(result.receivedData));

  } finally {
    isDownloading = false;
    downloadButton.disabled = false;
    buttonLoader.classList.add("hidden");
    buttonText.textContent = "Pobierz";
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

typeInputs.forEach((input) => {
  input.addEventListener("change", updateOptions);
});

urlInput.addEventListener("input", validateUrl);
trimStartInput.addEventListener("input", validateTrim);
trimEndInput.addEventListener("input", validateTrim);

experimentalToggle.addEventListener("click", toggleExperimentalPanel);
downloadForm.addEventListener("submit", handleDownloadSubmit);

addLog("system", "Pobierak uruchomiony.");
addLog("info", "Czekam na link do filmu...");

setupRotaryKnob(bitcrushKnob, bitcrushDial, bitcrushValue);
setupRotaryKnob(sampleRateKnob, sampleRateDial, sampleRateValue, sampleRateValues);
updateOptions();