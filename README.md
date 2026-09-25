# Indoor Navigation

An indoor navigation PWA for offices with no backend at all. Floor plans, waypoints, corridors and learned
visual "fingerprints" of places live in the browser and can be shared as a JSON file. Hosting is free on
GitHub Pages.

**Live:** https://vibecoding.sanda.dev/indoor-navigation/

## Features

- **Multiple maps.** Keep several offices or floors side by side and switch between them from the header.
  You can create, duplicate, rename, delete and import maps.
- **2D navigation.** Tap a room or location to get the shortest walkable route (A\* over the corridor graph),
  with real distances in meters.
- **Markerless visual localization.** Walk through a place once in the Editor and the app records camera
  keyframes as MobileNet v2 embeddings. The scanner then recognizes where you are by cosine similarity (k-NN)
  against those views. Everything runs on the device with TensorFlow.js.
- **QR / code markers.** You can also locate yourself by scanning a marker (via `BarcodeDetector` where the
  browser supports it) or by typing its code.
- **AR view.** The camera passthrough shows a floor-projected arrow towards the next waypoint. It uses the
  compass (`DeviceOrientationEvent`, including the iOS 13+ permission prompt).
- **Step tracking (PDR).** Accelerometer step detection moves your dot along the route between scans.
- **Offline PWA.** The app shell and sample map are precached. The AI model (~7.5 MB) is downloaded the
  first time you open the scanner and cached from then on.

## How it works without a backend

| Data                                              | Where it lives                                      |
| ------------------------------------------------- | --------------------------------------------------- |
| Map index (names, active map)                     | `localStorage`                                      |
| Map bodies (nodes, corridors, views, floor plans) | IndexedDB (much more space than `localStorage`)     |
| MobileNet v2 weights                              | Vendored in `public/models/`, cached by the SW      |
| Sharing between devices                           | Share / export file, `?map=` link, or direct WebRTC |

On first start the app moves over any map saved by the original single-file prototype
(`localStorage` key `indoor_nav_map_data_v3`). If there is none, it loads `public/default-map.json`.

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

### Testing on a phone

Browsers only allow the camera and motion sensors in a **secure context** (HTTPS). `localhost` is the only
exception. To test on a phone on the same Wi-Fi:

```bash
npm run dev:host     # vite --host over HTTPS with a self-signed certificate
```

Open the `https://<your-LAN-IP>:5173` URL that Vite prints and accept the certificate warning. On iOS,
the AR view shows an **Enable compass & step tracking** button, because Safari only asks for sensor access
after a tap.

### Scripts

| Script                        | What it does                                             |
| ----------------------------- | -------------------------------------------------------- |
| `npm run dev` / `dev:host`    | Dev server (local / LAN over HTTPS)                      |
| `npm run build`               | Type check (`tsc -b`) and production build into `dist/`  |
| `npm run preview`             | Serve the production build                               |
| `npm run test`                | Vitest unit tests (routing, matching, PDR, schema, …)    |
| `npm run lint` / `typecheck`  | ESLint (typed rules + React hooks) / TypeScript          |
| `npm run format`              | Prettier                                                 |
| `npm run generate-pwa-assets` | Rebuild favicons and PWA icons from `public/favicon.svg` |
| `npm run fetch-model`         | Download the MobileNet v2 (α 0.5) weights into `public/` |

## Deploying to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings → Pages → Build and deployment → Source** and select **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`: `npm ci` → lint → tests → type check and build
   → deploy.

The build sets `base` to `/<repository-name>/` when `GITHUB_PAGES` is set, so assets, the service worker and
the model load correctly from the Pages sub-path. Locally the base is `/`.

## Mapping an office in the Editor

1. **Create a map.** Open the maps menu (layers icon next to the map name) and click **Create**, starting
   either blank or from the sample office.
2. **Floor plan.** In **Editor → Floor plan & data**, upload an image of the plan. It is stretched to the
   100 × 100 map space. Large images are scaled down automatically.
3. **Scale and orientation.** Under **Map settings**:
   - **Scale** is how many meters one map unit represents. Example: an office 30 m wide is 0.3 m per unit.
   - **Plan faces** is the compass heading you look at when facing the top of the plan. The AR arrow
     needs it.
4. **Locations.** Use **Add** and tap the plan wherever people need to go or corridors turn. Then, with
   **Select**, tap a location to rename it and set its marker code, or drag it to move it.
5. **Corridors.** Use **Connect** and tap locations one after another to chain walkable corridors. Tapping an
   existing corridor again removes it.
6. **Visual learning.** Select a location and click **Record walkthrough**. Walk slowly through the place
   while turning the phone. A view is saved every 1.2 s, up to 60 per location. Do this for every place
   people should be recognized in.
7. **QR markers (optional).** Print QR codes that contain each location's marker code (e.g. `LOC-KITCHEN`)
   and put them up on site.
8. **Export JSON.** This saves the whole map, learned views included. Import it on other devices through
   **Import as new** or the maps menu.

## Sharing maps

Every sharing path transfers the complete map: settings, locations, corridors, rooms, learned views and the
floor plan. A floor plan that is only referenced (a bundled asset or an external URL) is embedded into the
file as a data URL.

- **Share map** (Editor). Opens the system share sheet (AirDrop, messaging apps, e-mail) with the map file.
  The other phone opens the file and imports it with **Import as new**. Browsers that cannot share files
  download it instead.
- **Link / QR code.** `https://<host>/indoor-navigation/?map=<url>` downloads the JSON, validates it and
  adds it as a new map. Opening the same link again updates that map instead of adding a copy. The URL can
  be:
  - a path inside this app, e.g. `?map=maps/office.json` for a file committed to `public/maps/`. Deployed
    files are also precached for offline use.
  - any public `https://` URL that allows cross-origin reads, such as a raw gist, S3 or another GitHub Pages
    site. Google Drive and Dropbox share links do not work.

  **Maps → Share via link** turns the URL into the app link and a QR code you can print, for example for the
  reception desk. Anything published this way is public, camera thumbnails of learned views included.

- **Nearby phone (WebRTC).** **Maps → Nearby phone** sends a map directly between two phones:
  1. The sending phone shows a QR code.
  2. The receiving phone scans it and shows its own code.
  3. The sender scans that code.

  The map then travels over a WebRTC data channel. No STUN/TURN or signalling server is used, so both phones
  must be on the same network. Guest and corporate Wi-Fi with client isolation blocks the connection. QR
  reading uses `BarcodeDetector`, or jsQR where it is missing (iOS Safari). A text-code fallback exists for
  devices without a camera.

Views recorded on one phone work on others, but accuracy drops with a very different camera or lighting.
Recording a walkthrough with two different phones helps.

## Project structure

```text
src/
├── components/   ar/, editor/, layout/, map/, maps/, scanner/, ui/
├── hooks/        useCamera, useOrientation, usePDR, useTensorFlow, useLocalStorage, useMapLibrary
├── services/     pathfinding (A*), navigation, geometry, visionMatcher, pdr, mapStorage (Zod),
│                 mapLibrary (IndexedDB), mapEditing, imageFiles, mapSharing, p2pSignal, p2pTransfer (WebRTC)
└── types/        map, vision, navigation, sensors.d.ts
public/           default-map.json, sample-floorplan.svg, maps/ (shared map JSON), models/mobilenet_v2_050/, icons
```

## Limitations

- The compass is disturbed by metal and electronics indoors. Calibrate by moving the phone in a figure 8.
- PDR assumes an average step of 0.7 m and that you follow the route, so rescan now and then.
- Views recorded with the fallback colour descriptor (used when the model cannot load) cannot be compared
  with MobileNet views. Record them again once the model is available.
- A map's data lives in a single browser until you share or export it. Browsers may clear site data under storage
  pressure, although the app asks for persistent storage.

## Licenses

Code: see repository. The MobileNet v2 weights in `public/models/` are © Google, Apache License 2.0.
