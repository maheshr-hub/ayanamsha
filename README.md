# Vedic Sky Map (Khagola Darśana)

A focused Vedic astronomy sky map showing Rāśi, Nakṣatra, Lagna, planets, and Vedic-named stars. No distracting features — just the celestial dome from a zenith stereographic projection, with sidereal (Lahiri) coordinates.

## Stack

- **React 18** + **Vite 6** for the app
- **astronomy-engine** (VSOP87, accurate to ~1 arcminute) for planet positions
- **vite-plugin-pwa** for installable PWA + offline support
- Pure SVG rendering (no canvas, no WebGL — fast on phones, scales perfectly)

## Local development

```bash
# Install dependencies (one-time)
npm install

# Run dev server. The `--host` flag exposes it on your LAN
# so you can open it on your phone while connected to the same Wi-Fi.
npm run dev
```

Vite will print two URLs:
```
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/   <-- open this on your phone
```

Save any file and the page hot-reloads instantly on both laptop and phone.

## Production build

```bash
npm run build       # builds to ./dist
npm run preview     # serves the production build locally for testing
```

## Deploying to GitHub Pages (same flow as Sankalpam)

1. **Edit `vite.config.js`** and set `REPO_NAME` to match your GitHub repo name (currently `'vedic-sky-map'`). The `base` path needs to match `/<repo>/` for Pages to resolve assets correctly.

2. **Create the repo on GitHub**, then push:

   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/vedic-sky-map.git
   git push -u origin main
   ```

3. **Deploy with one command:**

   ```bash
   npm run deploy
   ```

   This builds to `dist/` and pushes that folder to a `gh-pages` branch via the `gh-pages` package.

4. **Enable Pages** in your GitHub repo settings → Pages → Source: `gh-pages` branch / root.

5. Open `https://<your-username>.github.io/vedic-sky-map/` on your phone. On iOS Safari: tap Share → "Add to Home Screen". On Android Chrome: tap menu → "Install app". You'll get a real icon on your home screen and the app launches without browser chrome.

## File layout

```
vedic-sky-map/
├── index.html                      Entry HTML, font preload, PWA meta
├── package.json                    Dependencies and scripts
├── vite.config.js                  Vite + PWA plugin config
├── public/                         Static assets served as-is
│   ├── favicon.svg                 Browser tab icon
│   ├── icon-192.png                PWA icon (Android home screen)
│   ├── icon-512.png                PWA icon (splash screen)
│   ├── icon-512-maskable.png       PWA icon (adaptive Android)
│   └── apple-touch-icon.png        iOS home screen icon
└── src/
    ├── main.jsx                    React mount point
    ├── index.css                   Global styles, mobile safe-area
    └── VedicSkyMap.jsx             The whole sky map component
```

## What it shows

- **Horizon circle** with cardinal points (N at top, E on left — sky-view orientation)
- **Ecliptic** as a dashed blue arc
- **Twelve Rāśi boundaries** with names (toggle)
- **Twenty-seven Nakṣatra boundaries** with abbreviated names (toggle)
- **One hundred and eight Pāda tick marks** (toggle)
- **Twenty-seven Nakṣatra yogatārās** as real stars sized by magnitude
- **Seventeen named Vedic stars** (Lubdhaka/Sirius, Agastya/Canopus, the Saptarṣi, Dhruva, Abhijit/Vega, Agni/Elnath, etc.)
- **Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn** with retrograde detection
- **Rāhu and Ketu** (mean lunar node)
- **Lagna** — the current ascendant on the eastern horizon

Tap any marker for sidereal longitude, rāśi, nakṣatra, and pāda.

## Accuracy notes

- Planet positions: VSOP87 via astronomy-engine, ~1 arcminute accurate
- Lahiri ayanāṃśa: polynomial approximation, ~1 arcminute (good for visualisation; for muhūrta-grade work, see "Upgrading to Swiss Ephemeris" below)
- Lunar node: **mean** node (true node oscillates by up to ~1.5°)
- Star positions: J2000 epoch, no precession correction applied (negligible visual impact over a human lifetime)

## Upgrading to Swiss Ephemeris (later)

The architecture is set up so the astronomy engine is a contained module. To upgrade to Swiss Ephemeris (jyotiṣa-grade precision, true node, official ayanāṃśa):

```bash
npm install sweph
```

Then in `VedicSkyMap.jsx`, swap three functions:
- `planetEcliptic(body, date)` → `swe_calc_ut(jd, body, SEFLG_SIDEREAL | SEFLG_SWIEPH)`
- `meanRahuTropical(jd)` → `swe_calc_ut(jd, SE_TRUE_NODE, ...)` for the true node
- `lahiriAyanamsa(jd)` → `swe_get_ayanamsa_ex_ut(jd, SE_SIDM_LAHIRI, ...)`

Swiss Ephemeris is AGPL, so any public deployment inherits AGPL.

## License

Your choice — the code here is yours to license. astronomy-engine is MIT.
