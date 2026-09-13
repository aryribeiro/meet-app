// Geometria de vídeo em Node puro: o "bug dos 1280p" (celular em pé).
import { frameLines, isPortrait } from "../src/lib/shared/video.ts";
import { check, summary } from "./_helpers.mjs";

check("1280×720 (deitado) é 720p", frameLines(1280, 720) === 720);
check("720×1280 (celular em pé) TAMBÉM é 720p — não 1280p", frameLines(720, 1280) === 720);
check("640×360 é 360p; 360×640 também", frameLines(640, 360) === 360 && frameLines(360, 640) === 360);
check("sem dimensões dá 0", frameLines(0, 0) === 0 && frameLines(NaN, 720) === 0);
check("retrato detectado", isPortrait(720, 1280) === true && isPortrait(1280, 720) === false);
check("quadrado não é retrato", isPortrait(480, 480) === false);

summary("Geometria de vídeo");
