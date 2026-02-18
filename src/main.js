import "./style.css";
import { Delaunay } from "d3-delaunay";

const els = {
  file: document.getElementById("file"),
  points: document.getElementById("points"),
  pointsValue: document.getElementById("pointsValue"),
  mode: document.getElementById("mode"),
  download: document.getElementById("download"),
  status: document.getElementById("status"),
  canvas: document.getElementById("canvas"),
};

const ctx = els.canvas.getContext("2d");

let worker = null;
let lastPoints = null;
let lastDims = { width: 0, height: 0 };

els.points.addEventListener("input", () => {
  els.pointsValue.textContent = els.points.value;
});

els.mode.addEventListener("change", () => {
  if (lastPoints) render(lastPoints);
});

els.download.addEventListener("click", () => {
  const a = document.createElement("a");
  a.download = "output.png";
  a.href = els.canvas.toDataURL("image/png");
  a.click();
});

els.file.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  terminateWorker();

  els.status.textContent = "Decoding image...";
  els.download.disabled = true;
  lastPoints = null;

  const img = await createImageBitmap(file);

  // Choose a working width; adjust to taste.
  const width = Math.min(900, Math.max(400, img.width));
  const height = Math.round((width * img.height) / img.width);

  els.canvas.width = width;
  els.canvas.height = height;
  lastDims = { width, height };

  // Draw the image scaled to canvas, then derive density from pixels.
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const rgba = ctx.getImageData(0, 0, width, height).data;
  const density = new Float64Array(width * height);

  // Same idea as Observable: use red channel, inverted => dark = high density.
  // You can switch to luminance if you want more faithful conversion.
  for (let i = 0, n = width * height; i < n; i++) {
    const r = rgba[i * 4];
    density[i] = Math.max(0, 1 - r / 255);
  }

  // Start worker
  els.status.textContent = "Computing stipple (worker)...";
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });

  worker.onmessage = (ev) => {
    const { points, iter, itersTotal } = ev.data;
    lastPoints = points;
    render(points);
    els.status.textContent = `Relaxing: iteration ${iter}/${itersTotal}`;
    els.download.disabled = false;
  };

  worker.onerror = (err) => {
    console.error(err);
    els.status.textContent = "Worker error (see console).";
  };

  const nPoints = Number(els.points.value);
  worker.postMessage({ density, width, height, n: nPoints, iters: 80 });
});

function terminateWorker() {
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

function render(points) {
  const { width, height } = lastDims;

  // Clear to white
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);

  const mode = els.mode.value;

  if (mode === "dots") {
    ctx.fillStyle = "#000";
    ctx.beginPath();
    for (let i = 0; i < points.length; i += 2) {
      const x = points[i];
      const y = points[i + 1];
      ctx.moveTo(x + 1.5, y);
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
    }
    ctx.fill();
    return;
  }

  // Delaunay/Voronoi render
  const delaunay = new Delaunay(points);
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;

  ctx.beginPath();
  if (mode === "delaunay") {
    delaunay.render(ctx);
  } else {
    const vor = delaunay.voronoi([0, 0, width, height]);
    vor.render(ctx);
  }
  ctx.stroke();
}
