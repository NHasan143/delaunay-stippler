import { Delaunay } from "d3-delaunay";

// relaxation settings
const OMEGA = 1.8; // over-relaxation. 1 = plain lloyd, 2 is where it starts going unstable
const JITTER = 6; // random nudge in px at the start, fades out as (k+1)^-0.8
const MIN_ITERS = 30; // don't even check for convergence before this
const STOP_PULL = 0.15; // stop once sites are on average this close (px) to their centroid

onmessage = (event) => {
  const { density, width, height, n, iters } = event.data;

  // running total of the density. lets us pick a pixel with probability proportional
  // to its darkness: draw a random number in [0, total) and binary search for it
  const cdf = new Float64Array(density.length);
  let total = 0;
  for (let i = 0; i < density.length; i++) {
    total += density[i];
    cdf[i] = total;
  }
  if (total === 0) {
    // nothing dark at all, probably the white point is too high
    postMessage({ error: "Image is blank after tone mapping - lower the white point or gamma." });
    close();
    return;
  }

  // first index where cdf >= u
  function samplePixel() {
    const u = Math.random() * total;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const points = new Float64Array(n * 2);
  const c = new Float64Array(n * 2); // weighted centroid sums per site
  const s = new Float64Array(n); // total weight (ink) per site

  // random offset inside the pixel so two seeds never land on the exact same spot
  function seed(i) {
    const p = samplePixel();
    points[i * 2] = (p % width) + Math.random();
    points[i * 2 + 1] = Math.floor(p / width) + Math.random();
  }
  for (let i = 0; i < n; i++) seed(i);

  const delaunay = new Delaunay(points);

  for (let k = 0; k < iters; k++) {
    c.fill(0);
    s.fill(0);

    // every inked pixel goes to its nearest site. passing the previous result as the
    // hint makes find() walk from there instead of starting over, big speedup
    for (let y = 0, i = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const w = density[y * width + x];
        if (w <= 0) continue;
        i = delaunay.find(x + 0.5, y + 0.5, i);
        s[i] += w;
        c[i * 2] += w * (x + 0.5);
        c[i * 2 + 1] += w * (y + 0.5);
      }
    }

    const wiggle = Math.pow(k + 1, -0.8) * JITTER;
    // pull = how far sites are from their centroids. that's the real convergence measure,
    // "distance moved" doesn't work because the jitter keeps everything moving a little
    let pull = 0;

    for (let i = 0; i < n; i++) {
      if (s[i] === 0) {
        // site owns no ink at all, drop it somewhere useful instead of leaving it stuck
        seed(i);
        continue;
      }
      const x0 = points[i * 2];
      const y0 = points[i * 2 + 1];
      const x1 = c[i * 2] / s[i];
      const y1 = c[i * 2 + 1] / s[i];
      pull += Math.hypot(x1 - x0, y1 - y0);

      const nx = x0 + (x1 - x0) * OMEGA + (Math.random() - 0.5) * wiggle;
      const ny = y0 + (y1 - y0) * OMEGA + (Math.random() - 0.5) * wiggle;
      points[i * 2] = Math.max(0, Math.min(width - 1e-6, nx));
      points[i * 2 + 1] = Math.max(0, Math.min(height - 1e-6, ny));
    }

    delaunay.update();

    const meanPull = pull / n;
    const done = k === iters - 1 || (k + 1 >= MIN_ITERS && meanPull < STOP_PULL);
    postMessage({ points, iter: k + 1, itersTotal: iters, meanPull, done });
    if (done) break;
  }

  close();
};
