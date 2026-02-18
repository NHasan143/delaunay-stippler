import { Delaunay } from "d3-delaunay";

onmessage = (event) => {
  const { density, width, height, n, iters } = event.data;

  const points = new Float64Array(n * 2);
  const c = new Float64Array(n * 2);
  const s = new Float64Array(n);

  // Initialize via rejection sampling (biased by density map)
  for (let i = 0; i < n; i++) {
    let x = 0, y = 0;
    for (let j = 0; j < 30; j++) {
      x = Math.floor(Math.random() * width);
      y = Math.floor(Math.random() * height);
      if (Math.random() < density[y * width + x]) break;
    }
    points[i * 2] = x;
    points[i * 2 + 1] = y;
  }

  const delaunay = new Delaunay(points);

  for (let k = 0; k < iters; k++) {
    c.fill(0);
    s.fill(0);

    // Weighted centroid accumulation per Voronoi cell (raster assignment)
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

    // Over-relax + decaying noise (matches the Observable feel)
    const wiggle = Math.pow(k + 1, -0.8) * 10;

    for (let i = 0; i < n; i++) {
      const x0 = points[i * 2];
      const y0 = points[i * 2 + 1];

      const x1 = s[i] ? c[i * 2] / s[i] : x0;
      const y1 = s[i] ? c[i * 2 + 1] / s[i] : y0;

      let nx = x0 + (x1 - x0) * 1.8 + (Math.random() - 0.5) * wiggle;
      let ny = y0 + (y1 - y0) * 1.8 + (Math.random() - 0.5) * wiggle;

      // Clamp to bounds (prevents drifting out of frame)
      nx = Math.max(0, Math.min(width - 1e-6, nx));
      ny = Math.max(0, Math.min(height - 1e-6, ny));

      points[i * 2] = nx;
      points[i * 2 + 1] = ny;
    }

    delaunay.update();

    // Send a snapshot (structured clone copies TypedArray contents)
    postMessage({ points, iter: k + 1, itersTotal: iters });
  }

  close();
};
