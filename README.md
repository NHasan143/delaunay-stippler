# Delaunay / Voronoi Stippler

> Transform any image into generative stipple art using weighted Lloyd relaxation — entirely in the browser.

![JavaScript](https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?style=flat&logo=javascript&logoColor=yello)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=flat&logo=vite&logoColor=white)
![d3-delaunay](https://img.shields.io/badge/d3--delaunay-6.x-F9A03C?style=flat&logo=d3.js&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green?style=flat)
![GitHub Pages](https://img.shields.io/badge/deployed-GitHub%20Pages-4078C0?style=flat&logo=github&logoColor=white)

---

## 🖼️ What It Does

Upload any image and the stippler analyses its brightness to produce a distribution of points that **mirrors the original's light and dark regions** — dense stippling in dark areas, sparse in bright ones. The result can be rendered in three modes:

| Mode | Description |
|------|-------------|
| **Dots** | Classic stipple portrait — thousands of fine dots |
| **Delaunay** | Triangulated mesh connecting every point |
| **Voronoi** | Dual diagram partitioning space around each point |

All computation runs inside a **Web Worker** so the UI stays completely responsive during the relaxation process. The final result can be exported as a full-resolution **PNG**.

---

## 🚀 Live Demo

**[nhasan143.github.io/delaunay-stippler](https://nhasan143.github.io/delaunay-stippler/)**

---

## ✨ Features

- 📁 **Drag & drop or file-picker** image upload (any browser-supported format)
- ⚙️ **Adjustable point count** — 200 to 8,000 stipple points via a slider
- 🔄 **Three render modes** — Dots, Delaunay triangulation, Voronoi diagram
- 🧵 **Non-blocking Web Worker** — Lloyd relaxation runs off the main thread
- 🎞️ **Live preview** — canvas updates after every relaxation iteration
- 💾 **PNG export** — download the finished artwork at full canvas resolution
- 🌐 **Zero backend** — everything runs client-side; no data ever leaves your device
- 📦 **Tiny bundle** — single dependency (`d3-delaunay`), built with Vite

---

## 🧠 How It Works

### 1. Density Map
When an image is uploaded it is drawn onto an offscreen `<canvas>`. The raw pixel data is read and each pixel's **red channel is inverted** (`density = 1 − r/255`) to create a floating-point density map where dark pixels have high weight and bright pixels have low weight.

### 2. Weighted Lloyd Relaxation (Web Worker)
Points are seeded via **rejection sampling** biased by the density map. The algorithm then iterates:

1. Build a **Delaunay triangulation** of the current point set using `d3-delaunay`.
2. For every pixel, find the nearest point and accumulate its weighted centroid.
3. Move each point toward its weighted centroid with a **1.8× over-relaxation factor** plus a small amount of **decaying noise** to avoid grid artefacts.
4. Repeat for 80 iterations, broadcasting a snapshot after each one.

This produces a distribution that visually mirrors the tonal structure of the original image.

### 3. Rendering
The main thread receives each snapshot and redraws the canvas using either:
- Raw `arc()` calls for dot mode, or
- `d3-delaunay`'s built-in `render()` / `voronoi.render()` path helpers for the mesh modes.

---

## 🛠️ Tech Stack

| Tool | Role |
|------|------|
| [Vite 5](https://vitejs.dev/) | Dev server & production bundler |
| [d3-delaunay 6](https://github.com/d3/d3-delaunay) | Delaunay triangulation & Voronoi tessellation |
| [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API) | Off-thread Lloyd relaxation |
| [Canvas API](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API) | Image decoding, density extraction & rendering |
| [GitHub Actions](https://github.com/features/actions) | CI/CD — auto-deploy to GitHub Pages on push |

---

## 📦 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- npm v9 or later

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/NHasan143/delaunay-stippler.git
cd delaunay-stippler

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### Build for Production

```bash
npm run build      # outputs to /dist
npm run preview    # locally preview the production build
```

---

## 📁 Project Structure

```
delaunay-stippler/
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions — build & deploy to Pages
├── src/
│   ├── main.js               # UI wiring, image decode, canvas rendering
│   ├── worker.js             # Lloyd relaxation (runs in Web Worker)
│   └── style.css             # App styles
├── index.html                # Single-page shell
├── vite.config.js            # Vite config (sets base path for GitHub Pages)
├── package.json
├── package-lock.json
└── README.md
```

---

## ⚙️ Configuration

You can tweak the following constants in `src/main.js` and `src/worker.js`:

| Parameter | Location | Default | Description |
|-----------|----------|---------|-------------|
| `iters` | `main.js` | `80` | Number of Lloyd relaxation iterations |
| `max canvas width` | `main.js` | `900px` | Images wider than this are scaled down |
| Over-relaxation factor | `worker.js` | `1.8` | Values > 1 converge faster but may overshoot |
| Noise decay | `worker.js` | `(k+1)^-0.8 × 10` | Controls how quickly random jitter fades out |
| Point range | `index.html` | `200 – 8000` | Editable via the slider min/max attributes |

---

## 🚢 Deployment

The project deploys automatically to **GitHub Pages** via GitHub Actions whenever a commit is pushed to `main`.

To set it up on a fork:
1. Go to **Settings → Pages** in your repository.
2. Set the Source to **GitHub Actions**.
3. Push any commit to `main` — the workflow handles the rest.

> Make sure `vite.config.js` has `base` set to your repo name:
> ```js
> base: "/your-repo-name/",
> ```

---

## 🤝 Contributing

Contributions are welcome! To get started:

```bash
# Fork the repo, then:
git checkout -b feature/your-feature-name
# make your changes
git commit -m "feat: describe your change"
git push origin feature/your-feature-name
# open a Pull Request
```

Some ideas for future improvements:
- Luminance-based density (instead of red-channel only)
- Variable dot radius scaled by local density
- SVG export for scalable vector output
- Drag-and-drop image upload
- Color stippling from the original image palette

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.

---

## 👤 Author

**[Naymul Hasan]**
- GitHub: [@NHasan143](https://github.com/NHasan143)
- LinkedIn: [@naymulhasan143](https://www.linkedin.com/in/naymulhasan143/)

---

*If you find this project useful, consider leaving a ⭐ on the [repository](https://github.com/NHasan143/delaunay-stippler) — it helps a lot!*# Delaunay / Voronoi Stippler

Upload an image → generate a stippled distribution of points using weighted Lloyd relaxation (d3-delaunay) in a Web Worker → render as dots, Delaunay triangulation, or Voronoi diagram.

## Run locally

```bash
npm install
npm run dev
