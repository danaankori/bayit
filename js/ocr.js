// Reads text from receipt photos on the phone itself (Tesseract, Hebrew + English).
// Nothing is uploaded: the library and the Hebrew model are downloaded once and cached.

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let progressFn = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('לא הצלחתי לטעון את רכיב הקריאה. צריך אינטרנט בפעם הראשונה.'));
    document.head.appendChild(s);
  });
}

function worker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      await loadScript(TESSERACT);
      const w = await window.Tesseract.createWorker(['heb', 'eng'], 1, {
        logger: m => { if (progressFn) progressFn(m); }
      });
      // One uniform block of text, keeping spaces between columns.
      await w.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
      return w;
    })().catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

// Grayscale, scale to a readable width and turn into black text on white (Otsu threshold).
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(2.5, Math.max(1, 1600 / bmp.width));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    d[i] = g;
    hist[g]++;
  }
  const total = w * h;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * Math.pow(sumB / wB - (sum - sumB) / wF, 2);
    if (between > best) { best = between; threshold = t; }
  }
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] > threshold ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Returns the text of each image, in order. onProgress(fraction 0..1, label).
export async function readImages(files, onProgress) {
  const texts = [];
  progressFn = m => {
    if (m.status === 'recognizing text') onProgress((texts.length + m.progress) / files.length, `קורא תמונה ${texts.length + 1} מתוך ${files.length}`);
    else if (/loading|initializ/.test(m.status)) onProgress(0, 'טוען את רכיב הקריאה (בפעם הראשונה זה לוקח קצת זמן)');
  };
  const w = await worker();
  for (const f of files) {
    const canvas = await prepare(f);
    const { data } = await w.recognize(canvas);
    texts.push(data.text || '');
  }
  progressFn = null;
  return texts;
}
