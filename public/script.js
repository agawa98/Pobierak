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

const channelsSwitch = document.querySelector("#channelsSwitch");
const normalizeCheckbox = document.querySelector("#normalize");
const trimStartInput = document.querySelector("#trimStart");
const trimEndInput = document.querySelector("#trimEnd");
const trimValidation = document.querySelector("#trimValidation");

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
let videoDurationSeconds = null;


const backendLogs = new EventSource("/api/logs");

backendLogs.onmessage = (event) => {
  const log = JSON.parse(event.data);

  const lines = log.message
    .split("\\n")
    .map(line => line.trim())
    .filter(line => line !== "");

  lines.forEach(line => {
    addLog(log.type, line);
  });
};

backendLogs.onerror = () => {
  addLog("error", "Utracono połączenie z logami backendu.");
};

function trimLogs() {
  while (terminalLogs.children.length > 42) {
    terminalLogs.removeChild(terminalLogs.firstElementChild);
  }
}

function addLog(type, message) {
  const line = document.createElement("p");
  line.innerHTML = `<span>[${type}]</span> ${message}`;

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

  const parts = cleanValue.split(":").map(Number);

  if (parts.some(Number.isNaN)) {
    return NaN;
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  return NaN;
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

  if (videoDurationSeconds !== null && end !== null && end > videoDurationSeconds) {
    trimValidation.textContent = "Koniec nie może być większy niż długość filmu.";
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

async function handleDownloadSubmit(event) {
  event.preventDefault();

  downloadButton.disabled = true;
  buttonLoader.classList.remove("hidden");
  buttonText.textContent = "Pobieram...";

  if (!validateTrim()) {
    addLog("error", trimValidation.textContent);
    return;
  }

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
    const response = await fetch("/api/download", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(formData)
    });

    const result = await response.json();

    if (!response.ok) {
      addLog("error", result.message || "Backend zwrócił błąd.");
      return;
    }

    addLog("success", result.message);

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

  } catch (error) {
    addLog("error", "Nie udało się połączyć z backendem.");
    console.error(error);
  } finally {
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

trimStartInput.addEventListener("input", validateTrim);
trimEndInput.addEventListener("input", validateTrim);

experimentalToggle.addEventListener("click", toggleExperimentalPanel);
downloadForm.addEventListener("submit", handleDownloadSubmit);

addLog("system", "Pobierak uruchomiony.");
addLog("info", "Czekam na link do filmu...");

setupRotaryKnob(bitcrushKnob, bitcrushDial, bitcrushValue);
setupRotaryKnob(sampleRateKnob, sampleRateDial, sampleRateValue, sampleRateValues);
updateOptions();