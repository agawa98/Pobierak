// Pomocnik sprawdzen w przegladarce: wstawia na otwarta strone element <video> z podanym adresem,
// odtwarza go, przewija w podane miejsca i zwraca pomiary. Nie jest testem (nazwa nie konczy sie na .przegladarka.js).
// Strona musi byc otwarta z serwera HTTP (nie z file://), a plik lezec pod tym samym adresem serwera.

// seekTimes - lista czasow (w sekundach), do ktorych wideo ma zostac przewiniete, po kolei
async function playAndSeek(page, videoUrl, seekTimes) {
    return page.evaluate(async ({ videoUrl, seekTimes }) => {
        const video = document.createElement("video");

        video.muted = true;         // wyciszone wideo wolno odtwarzac bez klikniecia uzytkownika
        video.preload = "auto";
        video.src = videoUrl;
        document.body.appendChild(video);

        const describeError = () => (video.error ? `kod ${video.error.code} ${video.error.message}` : "brak");

        // czeka na zdarzenie elementu <video>; blad wideo albo brak zdarzenia w 15 s konczy sprawdzenie
        const waitFor = (name) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`brak zdarzenia "${name}" w 15 s (blad wideo: ${describeError()})`)), 15000);

            video.addEventListener(name, () => { clearTimeout(timer); resolve(); }, { once: true });
            video.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`blad wideo: ${describeError()}`)); }, { once: true });
        });

        // odtwarza przez chwile i zwraca, o ile sekund przesunal sie czas
        const playFor = async (seconds) => {
            const from = video.currentTime;
            const deadline = Date.now() + 15000;

            await video.play();

            while (video.currentTime < from + seconds && !video.ended) {
                if (Date.now() > deadline) {
                    throw new Error(`odtwarzanie stoi w miejscu (czas ${video.currentTime}, blad wideo: ${describeError()})`);
                }

                await new Promise(resolve => setTimeout(resolve, 50));
            }

            video.pause();

            return video.currentTime - from;
        };

        // srednia jasnosc aktualnej klatki (0 - czarna, 255 - biala)
        const brightness = () => {
            const canvas = document.createElement("canvas");

            canvas.width = 8;
            canvas.height = 8;

            const context = canvas.getContext("2d");

            context.drawImage(video, 0, 0, 8, 8);

            const pixels = context.getImageData(0, 0, 8, 8).data;
            let sum = 0;

            for (let index = 0; index < pixels.length; index += 4) {
                sum += (pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3;
            }

            return sum / (pixels.length / 4);
        };

        await waitFor("loadeddata");

        const result = {
            duration: video.duration,
            width: video.videoWidth,
            height: video.videoHeight,
            playedFromStart: await playFor(0.5),
            seeks: []
        };

        for (const time of seekTimes) {
            const seeked = waitFor("seeked");

            video.currentTime = time;
            await seeked;

            if (video.readyState < 2) {
                await waitFor("canplay");
            }

            result.seeks.push({ asked: time, currentTime: video.currentTime, readyState: video.readyState, brightness: brightness() });
        }

        // po ostatnim przewinieciu odtwarzanie ma ruszyc dalej z nowego miejsca
        result.playedAfterSeek = await playFor(0.3);
        result.seekableEnd = video.seekable.length > 0 ? video.seekable.end(video.seekable.length - 1) : 0;
        result.error = video.error ? video.error.code : null;

        video.remove();

        return result;
    }, { videoUrl, seekTimes });
}

module.exports = { playAndSeek };
