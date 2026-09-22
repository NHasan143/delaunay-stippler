import "./style.css";
import { Delaunay } from "d3-delaunay";

// working size limits. tiny images get upscaled so there are enough pixels per point
// for the relaxation to behave, big ones get downscaled because the worker cost is
// basically proportional to pixel count
const MIN_WORK = 600;
const MAX_WORK = 1200;
const ITERATIONS = 120; // hard cap, the worker usually stops way before this
const DOT_PUNCH = 0.4; // how much dot radius varies with local darkness. 0 = all dots same size

const els = {
  file: document.getElementById("file"),
  points: document.getElementById("points"),
  pointsValue: document.getElementById("pointsValue"),
  rerun:document.getElementById("rerun"),
  gamma:document.getElementById("gamma"),
  gammaValue:document.getElementById("gammaValue"),
  white:document.getElementById("white"),
  whiteValue:document.getElementById("whiteValue"),
  detail:document.getElementById("detail"),
  detailValue:document.getElementById("detailValue"),
  mode: document.getElementById("mode"),
  dotSize: document.getElementById("dotSize"),
  dotSizeValue: document.getElementById("dotSizeValue"),
  exportScale: document.getElementById("exportScale"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  canvas: document.getElementById("canvas"),
};

const ctx = els.canvas.getContext("2d");

const state = {
  rgba: null, // source pixels at working res, already flattened onto white
  width: 0,
  height: 0,
  dpr: 1,
  density: null, // one float per pixel, 0 = white 1 = black
  densitySum: 0, // needed for the dot radius
  densityCanvas: null, // grayscale picture of density, only used by the preview mode
  points: null, // last snapshot from the worker, [x0,y0,x1,y1,...]
  worker: null,
  fileName: "image",
};

//UI wiring
const readouts = [
  [els.points, els.pointsValue, (v) => Number(v).toLocaleString()],
  [els.gamma, els.gammaValue, (v) => Number(v).toFixed(2)],
  [els.white, els.whiteValue, (v) => Number(v).toFixed(2)],
  [els.detail, els.detailValue, (v) => Number(v).toFixed(2)],
  [els.dotSize, els.dotSizeValue, (v) => Number(v).toFixed(2)],
];

for (const [input, out, fmt] of readouts){
  input.addEventListener("input", () => (out.textContent = fmt(input.value)));
}

els.file.addEventListener("change", onFileChange);
els.rerun.addEventListener("click", () => state.density && startWorker());
els.download.addEventListener("click", exportPNG);
els.mode.addEventListener("change", renderDisplay);
els.dotSize.addEventListener("input", () => state.points && renderDisplay());
els.points.addEventListener("input", () => state.density && setStatus("Point count changed - press Re-run."));

// tone sliders only rebuild the density map, which is fast. the points don't move
// until Re-run. debounced because a slider drag fires dozens of input events a second
let toneTimer = 0;
for (const input of [els.gamma, els.white, els.detail]) {
  input.addEventListener("input", () => {
    if (!state.rgba) return;
    clearTimeout(toneTimer);
    toneTimer = setTimeout(() => {
      buildDensity();
      renderDisplay();
      if (state.points) setStatus("Tone changed - press Rerun to relax the points to the new density.");
    }, 60);
  });
}

function setStatus(text) {
  els.status.textContent = text;
}

// decode and working resolution

async function onFileChange(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  els.file.value = ""; // otherwise choosing the same file again does nothing

  terminateWorker();
  state.points = null;
  els.rerun.disabled = true;
  els.download.disabled = true;
  state.fileName = file.name.replace(/\.[^.]+$/, "") || "image";

  setStatus("Loading image...");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);

  } catch (err) {
    console.error(err);
    setStatus(`Could not decode "${file.name}". Try a JPEG, PNG or WebP.`);
    return;
  }

  // scale by the longest side so tall images don't blow up the pixel count
  const longest = Math.max(bitmap.width, bitmap.height);
  let scale = Math.min(1, MAX_WORK / longest);
  if (longest * scale < MIN_WORK) scale = MIN_WORK / longest;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  // read pixels from an offscreen canvas so the visible one can be sized for the screen.
  // fill white first - transparent png pixels are (0,0,0,0) and would count as black otherwise
  const work = document.createElement("canvas");
  work.width = width;
  work.height = height;
  const wctx = work.getContext("2d", { willReadFrequently: true });
  wctx.fillStyle = "#fff";
  wctx.fillRect(0,0,width, height);
  wctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  state.rgba = wctx.getImageData(0, 0, width, height).data;
  state.width = width;
  state.height = height;

  setupDisplayCanvas(width, height);
  buildDensity();
  els.rerun.disabled = false;
  startWorker();

}

function setupDisplayCanvas(width, height) {
  state.dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.round(width * state.dpr);
  els.canvas.height = Math.round(height * state.dpr);
  els.canvas.style.width = `${width}px`; // 1 working px = 1 css px. css can shrink it but never stretch it
}

//Density pipeline: luminance -> levels -> local contrast
function buildDensity() {
  const { rgba, width, height } = state;
  const n = width * height;
  const density = new Float64Array(n);

  // proper luminance instead of just the red channel. red alone made skin and a
  // pink wall look identical, and made red lips come out light
  for (let i = 0; i < n; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    density[i] = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  autoLevels(density, {
    gamma: Number(els.gamma.value),
    whitePoint: Number(els.white.value),
  });

  const amount = Number(els.detail.value);
  if (amount > 0) {
    // blur radius scales with image size so detail feels the same at 600 and 1200px
    unsharp(density, width, height, { radius: Math.max(2, Math.round(width / 160)), amount });
  }

  let sum = 0;
  for (let i = 0; i < n; i++) sum += density[i];

  state.density = density;
  state.densitySum = sum;
  state.densityCanvas = densityToCanvas(density, width, height);
}

// levels. stretch so the darkest / lightest 1% hit the ends of the range, anything
// lighter than whitePoint becomes pure white, then gamma (>1 thins the midtones)
function autoLevels(density, { clip = 0.01, gamma = 1, whitePoint = 0 } = {}) {
  const n = density.length;
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[(density[i] * 255) | 0]++;

  // walk the histogram in from both ends until we've passed clip% of the pixels
  let lo = 0;
  let hi = 255;
  let acc = 0;
  for (; lo < 255 && acc < clip * n; lo++) acc += hist[lo];
  acc = 0;
  for (; hi > 0 && acc < clip * n; hi--) acc += hist[hi];

  const a = Math.max(whitePoint, lo / 255);
  const b = Math.max(a + 1e-3, hi / 255); // guard against a == b on flat images
  const range = b - a;
  for (let i = 0; i < n; i++) {
    const d = Math.min(1, Math.max(0, (density[i] - a) / range));
    density[i] = Math.pow(d, gamma);
  }
}

// unsharp mask. boosts pixels that differ from their neighbourhood so edges like
// eyeliner, lips, nose get more weight. flat areas come out unchanged
function unsharp(density, width, height, { radius = 4, amount = 1 } = {}) {
  const blurred = boxBlur(density, width, height, radius);
  for (let i = 0; i < density.length; i++) {
    density[i] = Math.min(1, Math.max(0, density[i] + amount * (density[i] - blurred[i])));
  }
}

// plain separable box blur, edges clamp. not the fastest but it only runs when a slider moves
function boxBlur(src, width, height, r) {
  const tmp = new Float64Array(width * height);
  const out = new Float64Array(width * height);
  const k = 2 * r + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let d = -r; d <= r; d++) acc += src[y * width + Math.min(width - 1, Math.max(0, x + d))];
      tmp[y * width + x] = acc / k;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let d = -r; d <= r; d++) acc += tmp[Math.min(height - 1, Math.max(0, y + d)) * width + x];
      out[y * width + x] = acc / k;
    }
  }
  return out;
}

// grayscale version of the density map for the "Density map" mode. handy for
// checking what the worker actually sees before waiting for a run
function densityToCanvas(density, width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const cctx = c.getContext("2d");
  const img = cctx.createImageData(width, height);
  for (let i = 0; i < density.length; i++) {
    const v = Math.round(255 * (1 - density[i]));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  cctx.putImageData(img, 0, 0);
  return c;
}

//Worker lifecycle
function startWorker() {
  terminateWorker();
  const n = Number(els.points.value);
  const { density, width, height } = state;

  setStatus(`Relaxing ${n.toLocaleString()} points...`);
  const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  state.worker = worker;

  worker.onmessage = (ev) => {
    // worker bailed out (blank image etc)
    if (ev.data.error) {
      setStatus(ev.data.error);
      terminateWorker();
      return;
    }
    const { points, iter, itersTotal, done } = ev.data;
    state.points = points;
    scheduleRender();
    els.download.disabled = false;
    setStatus(
      done
        ? `Done after ${iter} iterations - ${n.toLocaleString()} points at ${width}x${height}. Adjust sliders and Re-run, or download.`
        : `Relaxing: iteration ${iter}/${itersTotal}`,
    );
  };

  worker.onerror = (err) => {
    console.error(err);
    setStatus("Worker error (see console).");
  };

  worker.postMessage({ density, width, height, n, iters: ITERATIONS });
}

function terminateWorker() {
  if (state.worker) {
    state.worker.terminate();
    state.worker = null;
  }
}

//Rendering (shared by the screen and the export)

// worker snapshots can arrive faster than the screen paints, so only draw once per frame
let rafPending = false;
function scheduleRender() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    renderDisplay();
  });
}

function renderDisplay() {
  if (!state.density) return;
  render(ctx, state.dpr);
}

// draws into whatever context you give it at whatever scale. the screen uses dpr,
// the export uses 2x / 3x / 4x. point coords are the same either way
function render(target, scale) {
  const { width, height, points, density, densitySum } = state;
  const mode = els.mode.value;

  target.setTransform(scale, 0, 0, scale, 0, 0);
  target.fillStyle = "#fff";
  target.fillRect(0, 0, width, height);

  if (mode === "density") {
    target.drawImage(state.densityCanvas, 0, 0);
    return;
  }
  if (!points) return;

  if (mode === "dots") {
    const n = points.length / 2;
    // radius that makes ink coverage match the density. comes from
    // spacing ~ sqrt(sum / (n * density)) and coverage = pi r^2 / spacing^2,
    // the density cancels out so it's one number for the whole image
    const base = Math.sqrt(densitySum / (n * Math.PI)) * Number(els.dotSize.value);
    target.fillStyle = "#000";
    // one big path + a single fill instead of a fill per dot. huge difference at 30k points
    target.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      const d = density[(y | 0) * width + (x | 0)];
      const r = base * (1 - DOT_PUNCH + 2 * DOT_PUNCH * d); // bigger in dark areas, smaller in light
      target.moveTo(x + r, y);
      target.arc(x, y, r, 0, Math.PI * 2);
    }
    target.fill();
    return;
  }

  const delaunay = new Delaunay(points);
  target.strokeStyle = "#000";
  target.lineWidth = 1;
  target.beginPath();
  if (mode === "delaunay") {
    delaunay.render(target);
  } else {
    delaunay.voronoi([0, 0, width, height]).render(target);
  }
  target.stroke();
}

//Export at a multiple of the working resolution
async function exportPNG() {
  if (!state.points) return;
  const scale = Number(els.exportScale.value);
  const out = document.createElement("canvas");
  out.width = state.width * scale;
  out.height = state.height * scale;
  render(out.getContext("2d"), scale);

  // toBlob instead of toDataURL, no giant base64 string sitting in memory
  const blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${state.fileName}-stipple-${els.mode.value}-${state.points.length / 2}pts-${out.width}x${out.height}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
