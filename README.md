# Indoor Navigation

An indoor navigation PWA for offices with no backend at all. Floor plans, waypoints, corridors and learned
visual "fingerprints" of places live in the browser and can be shared as a JSON file. Hosting is free on
GitHub Pages. Teams that want one shared, always up to date map can optionally connect their own free
Firebase project (see [Cloud sync](#cloud-sync-optional-firebase-backend)).

**Live:** https://vibecoding.sanda.dev/indoor-navigation/

## Features

- **Multiple maps.** Keep several offices or floors side by side and switch between them from the header.
  You can create, duplicate, rename, delete and import maps.
- **2D navigation.** Tap a room or location to get the shortest walkable route (A\* over the corridor graph),
  with real distances in meters. You can also search for a place by name; focusing the empty search field
  lists the last 5 places you picked on that map.
- **Map orientation.** A wide plan on a portrait phone (or a tall one on a landscape screen) is turned 90°
  counter-clockwise automatically when that makes it much bigger. The rotate button below the zoom buttons
  cycles Auto, Original and Turned. In Auto the Editor keeps the plan upright. The saved map is not changed.
- **Markerless visual localization.** Walk through a place once in the Editor and the app records camera
  keyframes as MobileNet v2 embeddings. The scanner then recognizes where you are by cosine similarity (k-NN)
  against those views. Everything runs on the device with TensorFlow.js.
- **QR / code markers.** You can also locate yourself by scanning a marker (via `BarcodeDetector` where the
  browser supports it) or by typing its code.
- **Manual location.** On a desktop press **I’m here** in the bottom bar (phones use the camera button instead), then search for a place by name or tap a room or
  location on the map to set where you are, without the camera.
- **AR view.** (Phones and tablets only; the camera locate button and AR are hidden on a desktop.) The camera passthrough shows a floor-projected arrow towards the next waypoint. It uses the
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
| Cloud settings and per-map sync state (optional)  | `localStorage`                                      |

On first start the app moves over any map saved by the original single-file prototype
(`localStorage` key `indoor_nav_map_data_v3`). If there is none, it loads `public/default-map.json`.

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:5173
```

Build for production and check the result locally:

```bash
npm run build        # type check + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173
```

The app needs no configuration to run. Everything in [Cloud sync](#cloud-sync-optional-firebase-backend)
is optional.

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

## Opening the nearest map

In the Editor, **Map location** stores the building's latitude and longitude with the map. Type the
coordinates as copied from a map app, or press **Use my location** while standing in the building.

When the app opens without a link, it asks for the device position once and switches to the map with the
nearest location, if that map is within 500 m. Nothing changes when the position is denied or unavailable,
when no map is close enough, when the maps have no location, or when you pick a map before the position
arrives. Links win over this: `?map=`, `?to=` and the cloud links (`?cfg=`, `?cloudMap=`) open what they
name and skip the automatic switch.

## Cloud sync (optional Firebase backend)

By default everything stays in the browser. If your team wants one shared map that stays up to date on every
phone, connect your own free [Firebase](https://firebase.google.com/) project. Nothing is sent anywhere
until you configure it, and without cloud settings the app behaves exactly as before.

**How it works**

- **Local first.** Every edit is saved on the device immediately, as always. The cloud is only written when
  you press **Sync to Cloud**.
- **Status in the header.** **Synced**, **Unsaved local changes** (with the **Sync to Cloud** button) or
  **Offline**. Offline edits are kept and can be published once you are back online.
- **Public read, signed-in write** (default in the rule examples). Anyone who opens a cloud map can view it
  and navigate without signing in. Publishing needs **Sign in with Google**. Who may read and who may
  publish is decided by your Firestore security rules, so you can also require sign-in for reading
  ([Scenario 4](#firestore-security-rules)).
- **Live updates.** A phone that has a cloud map open receives changes when someone publishes. It applies
  them automatically unless it has unpublished edits (you then choose which version to keep) or a route is
  active (you get an **Update now** button instead).
- **No silent overwrites.** Publishing checks that nobody published in between. If they did, you choose
  between **Use cloud version** and **Keep mine and publish**.

### Setting up your own Firebase backend

No programming needed. You need a Google account. The free plan (Spark) is enough for an office map; limits
are listed on the [Firebase pricing page](https://firebase.google.com/pricing).

1. **Create a project.** Open the [Firebase console](https://console.firebase.google.com/), click **Create a
   project**, enter a name and continue. Google Analytics is not needed, so you can switch it off.
2. **Enable Firestore.** In the left menu open **Firestore** (under **Project shortcuts**, or **Databases &
   Storage → Firestore**) and click **Create database**. Pick the location closest to your office and start
   in **production mode**.
3. **Set the security rules.** Open the **Rules** tab of Firestore, replace the content with one of the
   [rule sets below](#firestore-security-rules) and click **Publish**.
4. **Enable Google sign-in.** In the left menu open **Authentication** (under **Project shortcuts**), click
   **Get started** if it is the first time, then open the **Sign-in method** tab and choose **Google**.
   Switch it on, choose a support e-mail and **Save**.
5. **Allow your website to sign in.** In **Authentication** open the **Settings** tab, then **Authorized
   domains** in the list on the left (under **Domains**), and click **Add domain**. Enter the address where
   the app runs, for example `vibecoding.sanda.dev`. `localhost` and your project's `firebaseapp.com` and
   `web.app` addresses are already there. Without your domain on the list, sign-in fails with "This domain
   is not allowed to sign in".
6. **Register a web app.** In the left menu click **Settings** (top, under **Project Overview**) and choose
   **Project settings**. On the **General** tab scroll down to **Your apps**. A new project shows "There are
   no apps in your project" with a row of platform icons: click the web icon `</>`. Enter a nickname (skip
   Firebase Hosting) and click **Register app**. Firebase now shows a block that starts with
   `const firebaseConfig = {`. Keep this page open. If you closed it, you find the block again under **Your
   apps → SDK setup and configuration → Config**.
7. **Connect the app.** In Indoor Navigation click **Cloud sync** in the header, paste that whole block into
   the first field (the fields below fill in by themselves) and **Save**. Then **Sign in with Google** and
   **Publish to cloud** to upload your current map.

The Firebase console menus change between versions and accounts. If you cannot find an item, use **Search for
products** at the top of the left menu.

Other devices get the same setup through a [configuration link](#sharing-the-configuration-by-url).

### Why the API key in the config is not a secret

The `apiKey` in the Firebase web config is not a password. It only identifies your project to Google's
servers and is visible to everyone who loads your app, which is how every Firebase web app works. What
protects your data is the **Firestore security rules** and the **Authentication** settings on Google's side.
Treat the rules as your real access control, and keep them as strict as your use case allows. Do not put
private service-account keys or admin credentials anywhere in this app.

Tip: in the Google Cloud console you can additionally restrict the API key to your website's address
(**APIs & Services → Credentials → the browser key → Application restrictions → Websites**).

### Firestore security rules

Maps are stored in the `indoorMaps` collection. Each map uses a few documents there: the map itself under
its map id and, for large content such as the floor plan image and learned views, extra chunk documents with
ids like `<mapId>~fp~…`. Because all of them sit directly in `indoorMaps`, the rules below cover everything.
Paste one of them in **Firestore → Rules → Publish**.

**Scenario 1: public read, write only for your company's Google accounts (recommended)**

Replace `yourcompany.com` with your domain. Only people signed in with an address on that domain can publish.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /indoorMaps/{mapId} {
      allow read: if true;
      allow write: if request.auth != null
                   && request.auth.token.email.matches('.*@yourcompany\\.com');
    }
  }
}
```

**Scenario 2: public read, any signed-in Google account may write**

Anyone with a Google account can publish and overwrite maps. Fine for a small trusted group, risky otherwise.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /indoorMaps/{mapId} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

**Scenario 3: open sandbox (testing only)**

Anyone who knows your project can read, change and delete maps, with no sign-in. Use it only for a short
test with throwaway data and switch to Scenario 1 afterwards.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /indoorMaps/{mapId} {
      allow read, write: if true;
    }
  }
}
```

**Scenario 4: read only after sign-in, write only for specific people**

Nobody can see the maps without signing in with Google, and only the listed addresses can publish. Use it
when the maps must not be public. Replace the example addresses with your own, written in lowercase.

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /indoorMaps/{mapId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null
                   && request.auth.token.email_verified == true
                   && request.auth.token.email in [
                        'anna.novak@yourcompany.com',
                        'petr.svoboda@yourcompany.com'
                      ];
    }
  }
}
```

To let every colleague read but keep writing limited to the list, change the read line to
`allow read: if request.auth != null && request.auth.token.email.matches('.*@yourcompany\\.com');`. To let
anyone with a Google account read, keep it as shown.

With this scenario everyone has to sign in before a cloud map opens. A link still works: the app tells the
person to sign in (**Cloud sync → Sign in with Google**) and then opens the map by itself. Sign-in happens
inside the app, so the address bar never carries a password or token.

Good to know:

- **Read is public in scenarios 1 to 3.** Anyone who has the Firebase config of your project can read every
  map in it, including the camera thumbnails of learned views. Do not use those scenarios for maps that must
  stay confidential; use Scenario 4.
- The rules, not the app, enforce who may read and write. A person who is not allowed sees "The security
  rules do not allow this" and their local copy stays intact.
- Changes to the list of addresses in the rules take effect within a minute or so, without touching the app.

### Configuration

The cloud connection is configured in exactly two ways, and nothing is built into the app or read from
build-time environment variables:

1. **Manually** in the **Cloud sync** dialog: paste the Firebase config block or fill in the fields.
2. **Through a link** (see below).

Either way the settings are stored in `localStorage` on that device. Without settings the app is purely local
and shows no cloud status. The trash button on a project in the dialog removes it again; its maps stay on
the device as local maps and stop syncing.

### Several Firebase projects and choosing maps

A device can be connected to more than one Firebase project, for example one per region or company. **Add
another Firebase project** in the **Cloud sync** dialog adds it; adding a project that is already listed
updates its credentials. Every project has its own Google sign-in.

Connecting a project does not download anything. Open **Choose maps** on the project to list the maps it
holds, tick the ones this device should use (say only the Prague map, never the Liberec one) and press **Use
selected maps**. Ticked maps are downloaded and kept in sync. Unticking a map stops syncing it and keeps the
local copy; delete the copy from the map manager if you do not want it. A ticked map whose local copy you
delete comes back on the next start, so untick it instead.

When you publish a map that is not linked to the cloud yet and more than one project is connected, the dialog
asks which project to publish to.

The list comes from a small catalog document that is stored next to every map (`<mapId>~meta` in the same
`indoorMaps` collection, so the security rules above cover it). Maps published before the catalog existed
show up in the list after their next publish.

### Sharing the configuration by URL

An administrator can set the cloud connection up once and hand out links, so employees never see a
credential form.

1. Connect the app as described above and publish the map.
2. Open **Cloud sync** and click **Copy configuration link**. The link looks like
   `https://<host>/indoor-navigation/?cfg=<base64url>&cloudMap=<map id>`:
   - `cfg` is the Firebase web config (JSON, base64url encoded).
   - `cloudMap` is the id of the map to open. It is ticked on the project of the same link (or on the only
     connected project) and opened. Either parameter may be used alone, for example
     `?cloudMap=headquarters-floor-2` on a device that is connected to exactly one project.
3. Send it by e-mail or chat, or print it as a QR code. The format is plain text, so any QR generator works.

When someone opens the link the app saves the settings on their device, downloads the map (signing in is not
needed) and keeps it up to date. Then a bar offers **Clean address bar**, which removes `cfg` and `cloudMap`
from the URL so the credentials do not linger in the address bar, the browser history or a screenshot.

Keep in mind: the link carries the Firebase web config. That is public by design (see above), but anyone who
gets it can connect the app to your project and read its maps, so share it with the people who should see
the maps.

### What is stored in Firestore

Only the parts that changed are uploaded or downloaded. Map structure (locations, corridors, rooms,
settings) is one small document. The floor plan image and each location's learned views are split into
chunks below the 1 MiB Firestore document limit, so a map with photos is fine. A map whose structure alone
exceeds roughly 900 KiB cannot be synced. Corridors are stored as objects because Firestore does not allow
nested arrays. Older versions of the chunks are removed after each publish.

## Project structure

```text
src/
├── components/   ar/, cloud/, editor/, layout/, map/, maps/, scanner/, ui/
├── hooks/        useCamera, useOrientation, usePDR, useTensorFlow, useLocalStorage, useMapLibrary,
│                 useCloudSync, useSyncState
├── services/     pathfinding (A*), navigation, geometry, visionMatcher, pdr, mapStorage (Zod),
│                 mapLibrary (IndexedDB), mapEditing, imageFiles, mapSharing, p2pSignal, p2pTransfer (WebRTC),
│                 cloudConfig (config cascade, URL links), cloud/ (Firestore sync, see below)
└── types/        map, vision, navigation, sensors.d.ts
public/           default-map.json, sample-floorplan.svg, maps/ (shared map JSON), models/mobilenet_v2_050/, icons
```

## Limitations

- The compass is disturbed by metal and electronics indoors. Calibrate by moving the phone in a figure 8.
- PDR assumes an average step of 0.7 m and that you follow the route, so rescan now and then.
- Views recorded with the fallback colour descriptor (used when the model cannot load) cannot be compared
  with MobileNet views. Record them again once the model is available.
- A map's data lives in a single browser until you share or export it or publish it to the cloud. Browsers may
  clear site data under storage pressure, although the app asks for persistent storage.
- Cloud sync keeps the newest published version. Two people editing the same map at the same time cannot
  merge their edits; the second to publish chooses which version to keep.

## Licenses

Code: see repository. The MobileNet v2 weights in `public/models/` are © Google, Apache License 2.0.
