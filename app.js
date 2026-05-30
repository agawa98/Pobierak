const express = require("express");
const path = require("path");
const fs = require("fs");

const { spawn } = require("child_process");
const { randomUUID } = require("crypto");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;


// tu deklarujemy dozwolone wartosci zmiennych w formularzu, uzywane w walidacji
const allowedTypes = ["audio", "video", "separate"];
const allowedAudioFormats = ["mp3", "wav", "m4a", "flac"];
const allowedVideoFormats = ["mp4", "mpeg", "mjpeg", "mkv"];
const allowedBitrates = ["16", "32", "64", "128", "256", "320", "best"];
const allowedResolutions = ["144", "360", "480", "720", "1080", "best"];
const allowedSampleRates = ["8000", "11025", "12000", "16000", "22050", "24000", "32000", "44100", "48000", "default"];
const allowedChannels = ["mono", "stereo"];

//ustawiamy sciezki do programow

// const binDir = path.join(__dirname, "bin");
// const ytDlpPath = path.join(binDir, "yt-dlp.exe");                   ODKOMENTTUJ JESLI KORZYSTASZ LOKALNIE NA KOMPIE
// const ffmpegPath = path.join(binDir, "ffmpeg.exe");

const isWindows = process.platform === "win32";

const binDir = isWindows ? path.join(__dirname, "bin") : "/usr/bin";                        //SCIEZKI NA DOCKERA
const ytDlpPath = isWindows ? path.join(__dirname, "bin", "yt-dlp.exe") : "yt-dlp";
const ffmpegPath = isWindows ? path.join(__dirname, "bin", "ffmpeg.exe") : "ffmpeg";

//

const downloadsDir = path.join(__dirname, "downloads");


// ustawienia auto czyszczenia plików
const fileMaxAgeMinutes = 30;
const cleanupIntervalMinutes = 10;

//jesli nie ma folderu pobierania, stworz go
if (!fs.existsSync(downloadsDir)) {
    fs.mkdirSync(downloadsDir);
}

app.use(express.static(path.join(__dirname, "public")));
app.use("/downloads", express.static(downloadsDir));

//funckja wywolywana w razie bledu
function badRequest(res, message) {
    return res.status(400).json({
        success: false,
        message
    });
}

//funkcja usuwajaca stare pliki z folderu downloads
function cleanupOldDownloads() {
    const maxAgeMs = fileMaxAgeMinutes * 60 * 1000;
    const now = Date.now();

    const files = fs.readdirSync(downloadsDir);

    files.forEach((fileName) => {
        const filePath = path.join(downloadsDir, fileName);
        const fileStats = fs.statSync(filePath);

        if (!fileStats.isFile()) {
            return;
        }

        const fileAgeMs = now - fileStats.mtimeMs;

        if (fileAgeMs > maxAgeMs) {
            try {
                fs.unlinkSync(filePath);
                console.log("Usunieto stary plik:", fileName);
            } catch (error) {
                console.log("Nie udalo sie usunac starego pliku:", error.message);
            }
        }
    });
}

cleanupOldDownloads();

setInterval(() => {
    cleanupOldDownloads();
}, cleanupIntervalMinutes * 60 * 1000);


//funkcja parsujaca czas wpisywany w "przytnij", z formatu GG:MM:SS do sekund
function parseTimeToSeconds(value) {
    const trimmedValue = value.trim();

    if (trimmedValue === "") {
        return null;
    }

    const parts = trimmedValue.split(":").map(Number);

    if (parts.some(Number.isNaN)) {
        return NaN;
    }

    if (parts.some(part => part < 0)) {
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

// ta funkcja uruchamia komendy w ffmpeg albo ytdlp. command - sciezka do programu, args - argumenty, label - jak ma widniec w logach
function runProcess(command, args, label) {
    return new Promise((resolve, reject) => {       // resolve sie odpala gdy sukces, reject gdy etrror
        console.log(`${label} ARGS:`, args);

        const childProcess = spawn(command, args);

        let output = "";
        let errorOutput = "";

        childProcess.stdout.on("data", (data) => {
            output += data.toString();
            console.log(data.toString());
        });

        childProcess.stderr.on("data", (data) => {
            errorOutput += data.toString();
            console.error(data.toString());
        });

        childProcess.on("error", (error) => {
            reject({
                message: `Nie udało się uruchomić ${label}.`,
                error: error.message
            });
        });

        childProcess.on("close", (code) => {
            console.log(`${label} CLOSE CODE:`, code);

            if (code !== 0) {
                reject({
                    message: `${label} zakończył pracę błędem.`,
                    error: errorOutput
                });
                return;
            }

            resolve({
                output,
                errorOutput
            });
        });
    });
}

//generowanie randomowego ID do nazwy filmu
function getJobId() {
    return randomUUID().slice(0, 4);
}

//funkcja zwracająca bitrate
function getAudioQuality(bitrate) {
    if (bitrate === "best") {
        return "0";
    }

    return `${bitrate}K`;
}

//funkcja szukajaca pliku w folderze z pobranymi plikami, aby go wyslac nastepnie do frontendu
function findGeneratedFile(jobId, extraText = "") {
    return fs
        .readdirSync(downloadsDir)
        .find(fileName => {
            const hasJobId = fileName.includes(`[${jobId}]`);                           //szuka wedlug ID oraz dodatkowego tekstu(w przypadku pobierania oddzielnego)
            const hasExtraText = extraText === "" || fileName.includes(extraText);

            return hasJobId && hasExtraText;
        });
}

// funkcja tworząca nazwę pliku.  wykorzyustuje id oraz nazwe czy to jest wideo czy audio
function buildOutputTemplate(jobId, label = "") {
    const cleanLabel = label ? `${label} ` : "";
    return path.join(downloadsDir, `%(title).150B ${cleanLabel}[${jobId}].%(ext)s`);
}

// usuwa oryginalny plik po przetworzeniu
function deleteOriginalFile(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        console.log("Nie udało się usunąć oryginału:", error.message);
    }
}

//funkcja budujaca arugment do ffmpega zawieraajaaca resolution
function buildVideoFormat(resolution, format) {                             //pobieranie filmu z dzwiekiem (razem)
    if (format === "mp4" || format === "mpeg" || format === "mjpeg") {
        if (resolution === "best") {
            return "bv*[ext=mp4][vcodec^=avc1]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4]";
        }

        return `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]+ba[ext=m4a][acodec^=mp4a]/b[ext=mp4][height<=${resolution}]`;
    }

    if (resolution === "best") {
        return "bv*+ba/b";
    }   //best video(bv) + best audio(ba)

    return `bv*[height<=${resolution}]+ba/b[height<=${resolution}]`;
}

//jak wyzej tylko do innego trybu
function buildVideoOnlyFormat(resolution, format) {
    if (format === "mp4" || format === "mpeg" || format === "mjpeg") {
        if (resolution === "best") {                                    //pobieranie filmu i audio osobno
            return "bv*[ext=mp4][vcodec^=avc1]";
        }

        return `bv*[ext=mp4][vcodec^=avc1][height<=${resolution}]`;
    }

    if (resolution === "best") {                                    //pobieranie filmu i audio osobno
        return "bv*";
    }       //best video ONLY

    return `bv*[height<=${resolution}]`;
}

// yt-dlp nie umie sensownie mergowac prosto do mpeg/mjpeg, wiec najpierw pobieramy do bezpiecznego mp4, a potem ffmpeg konwertuje do mpeg/mjpeg
function getYtDlpMergeFormat(format) {
    if (format === "mpeg" || format === "mjpeg") {
        return "mp4";
    }

    return format;
}

//funckja budujaca nazwe przeprocesowanego pliku
function buildProcessedFileName(generatedFile, format, mediaType) {
    const parsedFile = path.parse(generatedFile);

    if (mediaType === "video" || mediaType === "videoOnly") {
        return `processed-${parsedFile.name}.${format}`;
    }
    return `processed-${generatedFile}`;
}

// funkcja budujaca argumenty do ffmpega, opisujace zastosowane filtry
function buildAudioFilters(experimental) {
    const { bitcrush, sampleRate, normalize } = experimental;

    const audioFilters = [];        // filtry budujemy w postaci tablicy, do której dodajemy potrzebne argumenty

    if (bitcrush > 0) {
        const crusherBits = Math.max(1, 16 - bitcrush);
        const crusherSamples = Math.min(30, 1 + bitcrush * 2);

        audioFilters.push(`volume=3,acrusher=bits=${crusherBits}:samples=${crusherSamples}:mix=1:mode=lin:aa=0,volume=0.5`);
    }

    if (normalize) {
        audioFilters.push("loudnorm");
    }

    if (sampleRate !== "default") {
        audioFilters.push(`aresample=${sampleRate}`);
    }

    if (bitcrush > 0 || sampleRate !== "default") {
        audioFilters.push("aformat=sample_fmts=s16");
    }

    return audioFilters;    // zwraca tablice
}

//funkcja sprawdzajaca czy plik potrzebuje dalszego procesowania przez ffmpeg, np w przypadku efektow lub przycinania. zwraca bool
function shouldProcessMedia(experimental, trimStartSeconds, trimEndSeconds, mediaType, format, generatedFile) {
    const audioFilters = buildAudioFilters(experimental);

    const needsAudioProcessing = audioFilters.length > 0 || experimental.channels === "mono";

    const needsTrim = trimStartSeconds !== null || trimEndSeconds !== null;

    const needsSeparateMp4Encoding = mediaType === "videoOnly" && format === "mp4";

    const needsVideoConversion =
        (mediaType === "video" || mediaType === "videoOnly") &&
        (
            format === "mpeg" ||
            format === "mjpeg" ||
            path.extname(generatedFile).replace(".", "").toLowerCase() !== format
        );

    if (mediaType === "videoOnly") {
        return needsTrim || needsVideoConversion || needsSeparateMp4Encoding;
    }

    return needsAudioProcessing || needsTrim || needsVideoConversion;       // jesli ktorekolwiek jest true, zwraca true (bramka OR)
}


//funkcja budujaca argumenty do kodowania. po processingu albo  wprzypadku innych formatow niz mp4, ffmpeg musi przeprocesowac jeszcze raz wideo, i czesto byly problemy z kodekami,
// wiec wrzucilem taka funkcje zeby bylo ekstra bezpiecznie. niestety przez to troche dluzej zajmuje pobieranie
function addVideoCodecArgs(ffmpegArgs, format, mediaType) {
    if (format === "mp4") {
        if (mediaType === "videoOnly") {
            ffmpegArgs.push("-c:v", "libx264","-preset", "veryfast","-crf", "23","-pix_fmt", "yuv420p","-an");

            return;
        }

        ffmpegArgs.push("-c:v", "copy");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "aac","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        return;
    }

    if (format === "mpeg") {
        ffmpegArgs.push("-c:v", "mpeg2video","-q:v", "5");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "mp2","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        ffmpegArgs.push("-f", "mpeg");
        return;
    }

    if (format === "mjpeg") {
        ffmpegArgs.push("-c:v", "mjpeg","-q:v", "5");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "libmp3lame","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        ffmpegArgs.push("-f", "avi");
        return;
    }

    if (format === "mkv") {
        ffmpegArgs.push("-c:v", "copy");

        if (mediaType === "video") {
            ffmpegArgs.push("-c:a", "aac","-b:a", "192k");
        } else {
            ffmpegArgs.push("-an");
        }

        return;
    }

    ffmpegArgs.push("-c:v", "copy");

    if (mediaType === "video") {
        ffmpegArgs.push("-c:a", "aac");
    } else {
        ffmpegArgs.push("-an");
    }
}

//funkcja procesujaca plik, jesli tego potrzebuje - TUTAJ URUCHAMIAMY FFMPEG
async function processDownloadedFile(options) {
    const {
        generatedFile,
        experimental,
        trimStartSeconds,
        trimEndSeconds,
        mediaType,
        format,
        bitrate
    } = options;

    if (!shouldProcessMedia(experimental, trimStartSeconds, trimEndSeconds, mediaType, format, generatedFile)) {
        console.log("FFMPEG SKIP: nie trzeba procesowac pliku");
        return generatedFile;
    }

    const originalPath = path.join(downloadsDir, generatedFile);
    const processedFile = buildProcessedFileName(generatedFile, format, mediaType);
    const processedPath = path.join(downloadsDir, processedFile);

    const ffmpegArgs = ["-y", "-nostdin"]; // y - nadpisz plik, nostdin - nie czekaj na input z klawiatury

    if (trimStartSeconds !== null) {
        ffmpegArgs.push("-ss", String(trimStartSeconds));
    }

    if (trimEndSeconds !== null) {
        ffmpegArgs.push("-to", String(trimEndSeconds));
    }

    ffmpegArgs.push("-i", originalPath);

    if (mediaType === "videoOnly") {                                                    //TYLKO WIDEO W TRYBIE ODDZIELNYM
        if (format === "mp4" || format === "mpeg" || format === "mjpeg") {
            addVideoCodecArgs(ffmpegArgs, format, mediaType);
        } else {
            ffmpegArgs.push("-c", "copy");
        }

        ffmpegArgs.push(processedPath);

        await runProcess(ffmpegPath, ffmpegArgs, "FFMPEG VIDEO ONLY");
        deleteOriginalFile(originalPath);

        return processedFile;
    }

    const audioFilters = buildAudioFilters(experimental);

    if (mediaType === "video") {                                                        //TRYB ŁĄCZNY
        if (audioFilters.length > 0) {
            ffmpegArgs.push("-af", audioFilters.join(","));
        }

        if (experimental.channels === "mono") {
            ffmpegArgs.push("-ac", "1");
        }

        if (format === "mpeg" || format === "mjpeg") {
            addVideoCodecArgs(ffmpegArgs, format, mediaType);
        } else if (audioFilters.length > 0 || experimental.channels === "mono") {
            ffmpegArgs.push("-c:v", "copy");

            if (format === "mp4" || format === "mkv") {
                ffmpegArgs.push("-c:a", "aac");
                ffmpegArgs.push("-b:a", "192k");
            }
        } else {
            ffmpegArgs.push("-c", "copy");
        }
    }

    if (mediaType === "audio") {                                                        // TRYB AUDIO
        if (audioFilters.length > 0) {
            ffmpegArgs.push("-af", audioFilters.join(","));
        }

        if (experimental.channels === "mono") {
            ffmpegArgs.push("-ac", "1");
        }

        if (format === "mp3" && bitrate !== "best") {
            ffmpegArgs.push("-b:a", getAudioQuality(bitrate));
        }
    }

    ffmpegArgs.push(processedPath);

    await runProcess(ffmpegPath, ffmpegArgs, "FFMPEG");
    deleteOriginalFile(originalPath);

    return processedFile;
}

//funkcja pobierająca i zwracająca plik audio - TUTAJ URUCHAMIAMY YTDLP
async function downloadAudio(url, format, bitrate, jobId) {
    const outputTemplate = buildOutputTemplate(jobId);
    const audioQuality = getAudioQuality(bitrate);

    const ytDlpArgs = [
        "--ffmpeg-location", binDir,
        "-x",
        "--audio-format", format,
        "--audio-quality", audioQuality,
        "-o", outputTemplate,
        url
    ];

    await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP AUDIO");     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

    const generatedFile = findGeneratedFile(jobId);

    if (!generatedFile) {
        throw {
            message: "Pobieranie zakończone, ale nie znaleziono pliku audio.",
            error: ""
        };
    }

    return generatedFile;
}

//funkcja pobierajaca wideo z audio
async function downloadVideo(url, resolution, format, jobId) {
    const outputTemplate = buildOutputTemplate(jobId);
    const videoFormat = buildVideoFormat(resolution, format);
    const mergeFormat = getYtDlpMergeFormat(format);

    const ytDlpArgs = [
        "--ffmpeg-location", binDir,
        "-f", videoFormat,
        "--merge-output-format", mergeFormat,
        "-o", outputTemplate,
        url
    ];

    await runProcess(ytDlpPath, ytDlpArgs, "YT-DLP VIDEO");     // tutaj uruchamiamy yt-dlp ktory sciaga plik z yt

    const generatedFile = findGeneratedFile(jobId);

    if (!generatedFile) {
        throw {
            message: "Pobieranie video zakończone, ale nie znaleziono pliku.",
            error: ""
        };
    }

    return generatedFile;
}

//funkcja pobierajaca wideo i audio oddzielnie
async function downloadSeparate(url, resolution, format, jobId) {
    const videoOutputTemplate = buildOutputTemplate(jobId, "video");
    const audioOutputTemplate = buildOutputTemplate(jobId, "audio");

    const videoOnlyFormat = buildVideoOnlyFormat(resolution, format);

    const videoArgs = [
        "--ffmpeg-location", binDir,
        "-f", videoOnlyFormat,
        "-o", videoOutputTemplate,
        url
    ];

    const audioArgs = [
        "--ffmpeg-location", binDir,
        "-x",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "-o", audioOutputTemplate,
        url
    ];

    await runProcess(ytDlpPath, videoArgs, "YT-DLP VIDEO ONLY");        //odpalamy dwa razy, raz dla wideo raz dla audio
    await runProcess(ytDlpPath, audioArgs, "YT-DLP AUDIO ONLY");

    const videoFile = findGeneratedFile(jobId, "video");
    const audioFile = findGeneratedFile(jobId, "audio");

    if (!videoFile || !audioFile) {
        throw {
            message: "Pobieranie osobnych plików zakończone, ale nie znaleziono video albo audio.",
            error: ""
        };
    }

    return {
        videoFile,
        audioFile
    };
}

//funkcja walidująca dane przysylane z frontendu na serwer
function validateRequest(req, res) {
    const { url, type, bitrate, resolution, format, experimental } = req.body;

    if (!url || !type || !format) {
        badRequest(res, "Brakuje podstawowych danych.");
        return null;
    }

    try {
        new URL(url);
    } catch {
        badRequest(res, "Nieprawidłowy URL.");
        return null;
    }

    if (!allowedTypes.includes(type)) {
        badRequest(res, "Nieprawidłowy tryb pobierania.");
        return null;
    }

    if (type === "audio") {
        if (!allowedAudioFormats.includes(format)) {
            badRequest(res, "Nieprawidłowy format audio.");
            return null;
        }

        if (!allowedBitrates.includes(bitrate)) {
            badRequest(res, "Nieprawidłowy bitrate.");
            return null;
        }
    }

    if (type === "video" || type === "separate") {
        if (!allowedVideoFormats.includes(format)) {
            badRequest(res, "Nieprawidłowy format wideo.");
            return null;
        }

        if (!allowedResolutions.includes(resolution)) {
            badRequest(res, "Nieprawidłowa rozdzielczość.");
            return null;
        }
    }

    if (!experimental || typeof experimental !== "object" || Array.isArray(experimental)) {
        badRequest(res, "Brakuje opcji eksperymentalnych.");
        return null;
    }

    const { bitcrush, sampleRate, channels, normalize, trimStart, trimEnd } = experimental;

    if (!Number.isInteger(bitcrush) || bitcrush < 0 || bitcrush > 15) {
        badRequest(res, "Nieprawidłowy bitcrush.");
        return null;
    }

    if (!allowedSampleRates.includes(sampleRate)) {
        badRequest(res, "Nieprawidłowy sample rate.");
        return null;
    }

    if (!allowedChannels.includes(channels)) {
        badRequest(res, "Nieprawidłowy tryb kanałów.");
        return null;
    }

    if (typeof normalize !== "boolean") {
        badRequest(res, "Nieprawidłowa wartość normalizacji.");
        return null;
    }

    if (typeof trimStart !== "string" || typeof trimEnd !== "string") {
        badRequest(res, "Nieprawidłowe czasy przycinania.");
        return null;
    }

    const trimStartSeconds = parseTimeToSeconds(trimStart);
    const trimEndSeconds = parseTimeToSeconds(trimEnd);

    if (Number.isNaN(trimStartSeconds) || Number.isNaN(trimEndSeconds)) {
        badRequest(res, "Nieprawidłowy format czasu przycinania.");
        return null;
    }

    if (trimStartSeconds !== null && trimStartSeconds < 0) {
        badRequest(res, "Początek przycinania nie może być mniejszy od zera.");
        return null;
    }

    if (trimEndSeconds !== null && trimEndSeconds < 0) {
        badRequest(res, "Koniec przycinania nie może być mniejszy od zera.");
        return null;
    }

    if (trimStartSeconds !== null && trimEndSeconds !== null && trimStartSeconds >= trimEndSeconds) {
        badRequest(res, "Początek przycinania musi być mniejszy niż koniec.");
        return null;
    }

    return {
        url,
        type,
        bitrate,
        resolution,
        format,
        experimental,
        trimStartSeconds,
        trimEndSeconds
    };
}

// tutaj mamy endpoint na ktorym wszystko sie dzieje
app.post("/api/download", async (req, res) => {
    console.log(req.body);

    const data = validateRequest(req, res);

    if (!data) {
        return;
    }

    const {
        url,
        type,
        bitrate,
        resolution,
        format,
        experimental,
        trimStartSeconds,
        trimEndSeconds
    } = data;

    const jobId = getJobId();

    try {
        if (type === "audio") {
            const downloadedFile = await downloadAudio(url, format, bitrate, jobId);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format,
                bitrate
            });

            return res.json({
                success: true,
                message: "Audio gotowe do pobrania.",
                downloadUrl: `/downloads/${finalFile}`,
                receivedData: data
            });
        }

        if (type === "video") {
            const downloadedFile = await downloadVideo(url, resolution, format, jobId);

            const finalFile = await processDownloadedFile({
                generatedFile: downloadedFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "video",
                format,
                bitrate
            });

            return res.json({
                success: true,
                message: "Video gotowe do pobrania.",
                downloadUrl: `/downloads/${finalFile}`,
                receivedData: data
            });
        }

        if (type === "separate") {
            const { videoFile, audioFile } = await downloadSeparate(url, resolution, format, jobId);

            const finalVideoFile = await processDownloadedFile({
                generatedFile: videoFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "videoOnly",
                format,
                bitrate
            });

            const finalAudioFile = await processDownloadedFile({
                generatedFile: audioFile,
                experimental,
                trimStartSeconds,
                trimEndSeconds,
                mediaType: "audio",
                format: "mp3",
                bitrate: "best"
            });

            return res.json({
                success: true,
                message: "Video i audio osobno gotowe do pobrania.",
                downloadUrl: `/downloads/${finalAudioFile}`,
                downloadUrls: [
                    `/downloads/${finalVideoFile}`,
                    `/downloads/${finalAudioFile}`
                ],
                receivedData: data
            });
        }

        return badRequest(res, "Nieobsługiwany tryb pobierania.");
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            success: false,
            message: error.message || "Wystąpił błąd podczas pobierania.",
            error: error.error || error.message || String(error)
        });
    }
});

app.listen(PORT, () => {
    console.log("slucham na porcie " + PORT);
});