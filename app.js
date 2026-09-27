/**
 * AquaCheck – Motor de análisis de calidad del agua
 * =====================================================
 * Funcionalidades:
 *  - Captura de imagen (cámara / galería / drag-and-drop)
 *  - Análisis visual mediante muestreo de píxeles (Canvas API)
 *  - Diagnóstico de potabilidad basado en características visuales
 *  - Modo accesible para personas con TEA y condiciones especiales
 *  - Anuncios ARIA para lectores de pantalla
 *  - Sin dependencias externas
 */

'use strict';

/* ============================================================
   CONFIGURACIÓN Y CONSTANTES
============================================================ */

/** Tiempo de análisis simulado para dar sensación de procesamiento (ms) */
const ANALYSIS_DELAY_MS = 1800;

/** Umbral de saturación media para considerar agua turbia */
const TURBIDITY_SAT_THRESHOLD = 45;

/** Colores de referencia (HSL ranges) para detección visual */
const COLOR_RANGES = {
  clearBlue:  { hMin: 185, hMax: 230, sMin: 20, lMin: 55 },
  greenAlgae: { hMin: 70,  hMax: 155, sMin: 30, lMin: 25 },
  brownMud:   { hMin: 15,  hMax: 45,  sMin: 25, lMin: 20 },
  grayDirt:   { hMin: 0,   hMax: 360, sMax: 18, lMin: 20, lMax: 70 },
  yellowish:  { hMin: 40,  hMax: 75,  sMin: 25, lMin: 55 },
  darkBlack:  { hMin: 0,   hMax: 360, lMax: 22 },
};

/** Número de píxeles que se muestrean del canvas (rendimiento) */
const SAMPLE_COUNT = 2500;

/* ============================================================
   REFERENCIAS AL DOM
============================================================ */
const body              = document.body;
const btnAccessible     = document.getElementById('btn-accessible');
const btnExitAccessible = document.getElementById('btn-exit-accessible');
const accessibleBanner  = document.getElementById('accessible-banner');
const dropZone          = document.getElementById('drop-zone');
const dropPlaceholder   = document.getElementById('drop-placeholder');
const previewImg        = document.getElementById('preview-img');
const inputCamera       = document.getElementById('input-camera');
const inputGallery      = document.getElementById('input-gallery');
const btnClear          = document.getElementById('btn-clear');
const btnAnalyze        = document.getElementById('btn-analyze');
const resultsSection    = document.getElementById('results-section');
const loadingIndicator  = document.getElementById('loading-indicator');
const resultCard        = document.getElementById('result-card');
const verdictBanner     = document.getElementById('verdict-banner');
const verdictIcon       = document.getElementById('verdict-icon');
const verdictTitle      = document.getElementById('verdict-title');
const verdictSubtitle   = document.getElementById('verdict-subtitle');
const barContamination  = document.getElementById('bar-contamination');
const barPotable        = document.getElementById('bar-potable');
const barClarity        = document.getElementById('bar-clarity');
const valContamination  = document.getElementById('val-contamination');
const valPotable        = document.getElementById('val-potable');
const valClarity        = document.getElementById('val-clarity');
const featuresList      = document.getElementById('features-list');
const recText           = document.getElementById('rec-text');
const btnNewAnalysis    = document.getElementById('btn-new-analysis');
const ariaAnnouncer     = document.getElementById('aria-announcer');

/* Estado de la aplicación */
let currentFile    = null;
let isAnalyzing    = false;
let accessibleMode = false;

/* ============================================================
   ACCESIBILIDAD: MODO ACCESIBLE
============================================================ */

/**
 * Activa o desactiva el modo accesible (alto contraste,
 * textos grandes, instrucciones simplificadas).
 * @param {boolean} enable
 */
function setAccessibleMode(enable) {
  accessibleMode = enable;
  body.dataset.accessible = enable ? 'true' : 'false';
  btnAccessible.setAttribute('aria-pressed', enable ? 'true' : 'false');
  accessibleBanner.hidden = !enable;

  // Persistir preferencia en sessionStorage
  try { sessionStorage.setItem('aquacheck_accessible', enable ? '1' : '0'); }
  catch (_) { /* navegador sin sessionStorage, ignorar */ }

  announce(
    enable
      ? 'Modo accesible activado. Colores de alto contraste, textos grandes e instrucciones simples están activos.'
      : 'Modo accesible desactivado. Apariencia normal restaurada.'
  );
}

/**
 * Anuncia un mensaje a lectores de pantalla mediante aria-live.
 * @param {string} message
 */
function announce(message) {
  ariaAnnouncer.textContent = '';
  // Pequeño timeout para que algunos lectores detecten el cambio
  requestAnimationFrame(() => {
    ariaAnnouncer.textContent = message;
  });
}

/* Botón modo accesible */
btnAccessible.addEventListener('click', () => setAccessibleMode(!accessibleMode));
btnExitAccessible.addEventListener('click', () => setAccessibleMode(false));

/* Restaurar preferencia al cargar */
try {
  if (sessionStorage.getItem('aquacheck_accessible') === '1') setAccessibleMode(true);
} catch (_) {}

/* ============================================================
   CAPTURA DE IMAGEN
============================================================ */

/**
 * Carga una imagen desde un File y muestra la previsualización.
 * @param {File} file
 */
function loadImageFile(file) {
  if (!file || !file.type.startsWith('image/')) {
    announce('El archivo seleccionado no es una imagen válida. Elige una foto.');
    return;
  }

  currentFile = file;
  const url = URL.createObjectURL(file);

  previewImg.src = url;
  previewImg.hidden = false;
  dropPlaceholder.hidden = true;
  dropZone.classList.add('has-image');
  dropZone.setAttribute('aria-label', `Imagen seleccionada: ${file.name}. Pulsa Analizar para continuar.`);

  btnClear.hidden = false;
  enableAnalyzeButton(true);

  // Liberar URL anterior al cargar la nueva
  previewImg.onload = () => URL.revokeObjectURL(url);

  announce(`Imagen cargada: ${file.name}. Pulsa el botón Analizar Agua para obtener el resultado.`);

  // Ocultar resultados anteriores si los hubiera
  hideResults();
}

/**
 * Limpia la imagen seleccionada y resetea la interfaz.
 */
function clearImage() {
  currentFile = null;
  previewImg.src = '';
  previewImg.hidden = true;
  dropPlaceholder.hidden = false;
  dropZone.classList.remove('has-image');
  dropZone.setAttribute('aria-label', 'Área para subir imagen. Haz clic o arrastra una foto aquí');
  btnClear.hidden = true;
  enableAnalyzeButton(false);
  hideResults();
  announce('Imagen eliminada. Sube o toma una nueva foto para analizar.');
}

/** Habilita / deshabilita el botón de análisis */
function enableAnalyzeButton(enabled) {
  btnAnalyze.disabled = !enabled;
  btnAnalyze.setAttribute('aria-disabled', !enabled ? 'true' : 'false');
}

/* Eventos de los inputs file */
[inputCamera, inputGallery].forEach(input => {
  input.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) loadImageFile(file);
    // Resetear el input para permitir seleccionar el mismo archivo
    input.value = '';
  });
});

/* Botón limpiar */
btnClear.addEventListener('click', clearImage);

/* ── DRAG AND DROP ── */
dropZone.addEventListener('dragenter', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', (e) => {
  if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer?.files?.[0];
  if (file) loadImageFile(file);
});

/* Soporte de teclado para la drop-zone (role="button") */
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    inputGallery.click();
  }
});

/* Clic en la zona (cuando no hay imagen) abre el selector */
dropZone.addEventListener('click', () => {
  if (!currentFile) inputGallery.click();
});

/* ============================================================
   MOTOR DE ANÁLISIS VISUAL
============================================================ */

/**
 * Extrae una muestra de píxeles de una imagen usando Canvas.
 * Devuelve un array de objetos {r, g, b}.
 * @param {HTMLImageElement} imgEl
 * @returns {{r:number, g:number, b:number}[]}
 */
function samplePixels(imgEl) {
  const canvas = document.createElement('canvas');
  const MAX_DIM = 200; // reducir para rendimiento
  const scale   = Math.min(1, MAX_DIM / Math.max(imgEl.naturalWidth, imgEl.naturalHeight));
  canvas.width  = Math.round(imgEl.naturalWidth  * scale);
  canvas.height = Math.round(imgEl.naturalHeight * scale);

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(imgEl, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels    = imageData.data;
  const total     = canvas.width * canvas.height;

  // Muestreo uniforme para no procesar todos los píxeles
  const step    = Math.max(1, Math.floor(total / SAMPLE_COUNT));
  const samples = [];

  for (let i = 0; i < total; i += step) {
    const idx = i * 4;
    samples.push({ r: pixels[idx], g: pixels[idx + 1], b: pixels[idx + 2] });
  }
  return samples;
}

/**
 * Convierte RGB [0-255] a HSL [h:0-360, s:0-100, l:0-100].
 * @param {number} r @param {number} g @param {number} b
 * @returns {{h:number, s:number, l:number}}
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      default:h = ((r - g) / d + 4) / 6;
    }
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Analiza los píxeles muestreados y devuelve métricas de calidad.
 * @param {{r:number, g:number, b:number}[]} samples
 * @returns {WaterMetrics}
 */
function analyzePixels(samples) {
  let countClearBlue = 0, countGreenAlgae = 0, countBrownMud = 0;
  let countGrayDirt  = 0, countYellowish  = 0, countDarkBlack = 0;
  let totalSaturation = 0, totalLightness = 0;

  const hslSamples = samples.map(({ r, g, b }) => {
    const hsl = rgbToHsl(r, g, b);
    totalSaturation += hsl.s;
    totalLightness  += hsl.l;
    return hsl;
  });

  hslSamples.forEach(({ h, s, l }) => {
    const r = COLOR_RANGES;
    if (h >= r.clearBlue.hMin  && h <= r.clearBlue.hMax  && s >= r.clearBlue.sMin  && l >= r.clearBlue.lMin)  countClearBlue++;
    if (h >= r.greenAlgae.hMin && h <= r.greenAlgae.hMax && s >= r.greenAlgae.sMin && l >= r.greenAlgae.lMin) countGreenAlgae++;
    if (h >= r.brownMud.hMin   && h <= r.brownMud.hMax   && s >= r.brownMud.sMin   && l >= r.brownMud.lMin)   countBrownMud++;
    if (                                                      s <= r.grayDirt.sMax  && l >= r.grayDirt.lMin && l <= r.grayDirt.lMax) countGrayDirt++;
    if (h >= r.yellowish.hMin  && h <= r.yellowish.hMax  && s >= r.yellowish.sMin  && l >= r.yellowish.lMin)  countYellowish++;
    if (                                                                               l <= r.darkBlack.lMax)  countDarkBlack++;
  });

  const total       = samples.length || 1;
  const avgSat      = totalSaturation / total;
  const avgLight    = totalLightness  / total;

  const pctClear    = countClearBlue  / total;
  const pctAlgae    = countGreenAlgae / total;
  const pctMud      = countBrownMud   / total;
  const pctGray     = countGrayDirt   / total;
  const pctYellow   = countYellowish  / total;
  const pctDark     = countDarkBlack  / total;

  /* ── Calcular puntuaciones (0-100) ── */

  // Contaminación: mayor si hay algas, barro, turbidez, color oscuro
  let contamScore = 0;
  contamScore += pctAlgae  * 90;
  contamScore += pctMud    * 85;
  contamScore += pctYellow * 60;
  contamScore += pctDark   * 80;
  contamScore += pctGray   * 30;
  contamScore -= pctClear  * 40; // agua clara reduce contaminación
  if (avgSat < 15 && avgLight > 55) contamScore -= 10; // agua muy transparente
  contamScore = Math.max(0, Math.min(100, contamScore * 120));

  // Transparencia / claridad
  let clarityScore = 0;
  clarityScore += pctClear * 80;
  if (avgLight > 60) clarityScore += 20;
  if (avgSat   < TURBIDITY_SAT_THRESHOLD) clarityScore += 15;
  clarityScore -= pctMud   * 60;
  clarityScore -= pctAlgae * 40;
  clarityScore -= pctDark  * 50;
  clarityScore = Math.max(0, Math.min(100, clarityScore * 120));

  // Potabilidad: inverso de contaminación + bonus por transparencia
  let potableScore = Math.max(0, 100 - contamScore * 0.9 + clarityScore * 0.15);
  potableScore = Math.max(0, Math.min(100, potableScore));

  return {
    contamination: Math.round(contamScore),
    potable:       Math.round(potableScore),
    clarity:       Math.round(clarityScore),
    features: {
      hasClearBlue:  pctClear  > 0.12,
      hasGreenAlgae: pctAlgae  > 0.08,
      hasBrownMud:   pctMud    > 0.06,
      hasGrayDirt:   pctGray   > 0.15,
      hasYellowish:  pctYellow > 0.08,
      hasDarkColor:  pctDark   > 0.10,
      isTurbid:      avgSat    > TURBIDITY_SAT_THRESHOLD && clarityScore < 45,
    },
    raw: { pctClear, pctAlgae, pctMud, pctGray, pctYellow, pctDark, avgSat, avgLight }
  };
}

/**
 * Interpreta las métricas y genera el veredicto + recomendación.
 * @param {WaterMetrics} metrics
 * @returns {Verdict}
 */
function buildVerdict(metrics) {
  const { contamination, potable, clarity, features } = metrics;

  /* Nivel de contaminación textual */
  let contamLevel;
  if      (contamination < 28) contamLevel = 'bajo';
  else if (contamination < 60) contamLevel = 'medio';
  else                         contamLevel = 'alto';

  /* Veredicto general */
  let level, icon, title, subtitle, recommendation;

  if (contamination < 28 && potable >= 65) {
    level    = 'safe';
    icon     = '✅';
    title    = 'Esta agua parece segura';
    subtitle = 'El nivel de contaminación es bajo y la transparencia es buena.';
    recommendation = 'El agua tiene buenas características visuales. Si proviene de una fuente pública tratada, puede ser apta para el consumo. Aun así, si tienes dudas, hiérvela o fíltrala antes de beber.';

  } else if (contamination < 60 && potable >= 35) {
    level    = 'warn';
    icon     = '⚠️';
    title    = 'Esta agua tiene señales de alerta';
    subtitle = `Nivel de contaminación ${contamLevel}. Se detectaron características que requieren atención.`;
    recommendation = 'No bebas esta agua sin tratarla antes. Hiérvela al menos 1 minuto o usa un filtro certificado. Puedes usarla para limpiar si no hay alternativa, pero evita el consumo directo.';

  } else {
    level    = 'danger';
    icon     = '🚫';
    title    = 'Esta agua NO es segura';
    subtitle = `Nivel de contaminación ${contamLevel}. Presenta características visuales de agua no potable.`;
    recommendation = 'No uses esta agua para beber, cocinar ni lavarte la boca. Contacta con las autoridades locales de agua o busca una fuente alternativa segura. Puedes reportarla como posible foco de contaminación.';
  }

  /* Construir lista de características visuales detectadas */
  const detectedFeatures = [];
  if (features.hasClearBlue)  detectedFeatures.push({ label: '💧 Agua clara y azulada',   type: 'ok'      });
  if (features.hasGreenAlgae) detectedFeatures.push({ label: '🟢 Presencia de algas',       type: 'danger'  });
  if (features.hasBrownMud)   detectedFeatures.push({ label: '🟤 Sedimentos o barro',       type: 'danger'  });
  if (features.hasGrayDirt)   detectedFeatures.push({ label: '⚫ Partículas en suspensión', type: 'warn'    });
  if (features.hasYellowish)  detectedFeatures.push({ label: '🟡 Coloración amarillenta',   type: 'warn'    });
  if (features.hasDarkColor)  detectedFeatures.push({ label: '🖤 Color oscuro / turbio',    type: 'danger'  });
  if (features.isTurbid)      detectedFeatures.push({ label: '🌫️ Agua turbia',              type: 'warn'    });
  if (clarity > 65)           detectedFeatures.push({ label: '✨ Alta transparencia',        type: 'ok'      });

  if (detectedFeatures.length === 0) {
    detectedFeatures.push({ label: '🔍 Características no concluyentes', type: 'neutral' });
  }

  return { level, icon, title, subtitle, recommendation, detectedFeatures, contamLevel, contamination, potable, clarity };
}

/* ============================================================
   RENDERIZADO DE RESULTADOS
============================================================ */

/**
 * Muestra los resultados del análisis en la interfaz.
 * @param {Verdict} verdict
 */
function renderResults(verdict) {
  // Veredicto banner
  verdictBanner.className = `verdict-banner verdict-${verdict.level}`;
  verdictIcon.textContent    = verdict.icon;
  verdictTitle.textContent   = verdict.title;
  verdictSubtitle.textContent = verdict.subtitle;

  // Barras de métricas (con animación retrasada)
  requestAnimationFrame(() => {
    barContamination.style.width = `${verdict.contamination}%`;
    barPotable.style.width       = `${verdict.potable}%`;
    barClarity.style.width       = `${verdict.clarity}%`;
  });

  valContamination.textContent = `${verdict.contamination}% (${verdict.contamLevel})`;
  valPotable.textContent       = `${verdict.potable}%`;
  valClarity.textContent       = `${verdict.clarity}%`;

  // Características detectadas
  featuresList.innerHTML = '';
  verdict.detectedFeatures.forEach(feat => {
    const li  = document.createElement('li');
    const tag = document.createElement('span');
    tag.className   = `feature-tag tag-${feat.type}`;
    tag.textContent = feat.label;
    li.appendChild(tag);
    featuresList.appendChild(li);
  });

  // Recomendación
  recText.textContent = verdict.recommendation;

  // Mostrar tarjeta
  loadingIndicator.hidden = true;
  resultCard.hidden       = false;

  // Anuncio accesible con el resultado principal
  announce(`Análisis completo. ${verdict.title}. ${verdict.subtitle} Recomendación: ${verdict.recommendation}`);

  // Scroll suave hasta los resultados
  resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Oculta la sección de resultados */
function hideResults() {
  resultsSection.hidden   = true;
  loadingIndicator.hidden = true;
  resultCard.hidden       = true;
}

/* ============================================================
   FLUJO PRINCIPAL DE ANÁLISIS
============================================================ */

/**
 * Ejecuta el análisis completo de la imagen.
 * Carga la imagen en memoria, muestrea píxeles, calcula métricas
 * y renderiza los resultados.
 */
async function runAnalysis() {
  if (!currentFile || isAnalyzing) return;
  isAnalyzing = true;

  // Mostrar sección de resultados con el spinner
  resultsSection.hidden   = false;
  loadingIndicator.hidden = false;
  resultCard.hidden       = true;
  announce('Analizando la imagen de tu agua. Por favor, espera un momento.');

  // Scroll suave al área de carga
  resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    // Cargar imagen en un elemento temporal para acceder a sus píxeles
    const img = await loadImageForAnalysis(currentFile);

    // Simular tiempo de procesamiento para UX natural
    await wait(ANALYSIS_DELAY_MS);

    // Análisis real de píxeles
    const samples = samplePixels(img);
    const metrics = analyzePixels(samples);
    const verdict = buildVerdict(metrics);

    renderResults(verdict);

  } catch (err) {
    console.error('Error durante el análisis:', err);
    loadingIndicator.hidden = true;
    resultCard.hidden       = true;
    announce('Ha ocurrido un error al analizar la imagen. Por favor, inténtalo de nuevo.');

    // Mostrar mensaje de error inline
    showError('No se pudo analizar la imagen. Asegúrate de que el archivo es una imagen válida e inténtalo de nuevo.');

  } finally {
    isAnalyzing = false;
  }
}

/**
 * Carga un File como HTMLImageElement resolviendo cuando esté lista.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImageForAnalysis(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload  = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo cargar la imagen.')); };
    img.src = url;
  });
}

/**
 * Espera N milisegundos.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Muestra un mensaje de error accesible en la sección de resultados.
 * @param {string} message
 */
function showError(message) {
  const errorEl = document.createElement('div');
  errorEl.setAttribute('role', 'alert');
  errorEl.className = 'error-message';
  errorEl.style.cssText = `
    background: #ffd7d9; border: 2px solid #cf222e; border-radius: 0.75rem;
    padding: 1rem 1.5rem; color: #8b0000; font-weight: 600; margin-top: 1rem;
  `;
  errorEl.innerHTML = `<span aria-hidden="true">❌</span> ${message}`;
  resultsSection.appendChild(errorEl);

  // Auto-eliminar tras 8 segundos
  setTimeout(() => errorEl.remove(), 8000);
}

/* Botón analizar */
btnAnalyze.addEventListener('click', runAnalysis);

/* Botón "Nuevo análisis" */
btnNewAnalysis.addEventListener('click', () => {
  clearImage();
  // Mover foco al área de captura
  dropZone.focus();
});

/* ============================================================
   SOPORTE DE TECLADO GLOBAL (shortcuts de accesibilidad)
============================================================ */

document.addEventListener('keydown', (e) => {
  // Alt+A → activar/desactivar modo accesible desde cualquier punto
  if (e.altKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    setAccessibleMode(!accessibleMode);
    btnAccessible.focus();
  }
  // Escape → limpiar si hay imagen (y no está analizando)
  if (e.key === 'Escape' && currentFile && !isAnalyzing) {
    clearImage();
  }
});

/* ============================================================
   INICIALIZACIÓN
============================================================ */
(function init() {
  // Asegurar estado inicial correcto
  enableAnalyzeButton(false);
  hideResults();
  previewImg.hidden = true;
  btnClear.hidden   = true;

  // Informar al lector de pantalla que la app está lista
  announce('AquaCheck cargado. Sube o fotografía una muestra de agua para analizarla.');
})();
