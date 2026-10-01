# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Node 20+. Package versions are pinned exactly in `package.json`.

```bash
npm run dev            # http://localhost:5173
npm run dev:host       # LAN dev server over HTTPS (self-signed) for testing camera/sensors on a phone
npm run build          # tsc -b && vite build
npm run typecheck      # tsc -b --noEmit
npm run lint           # ESLint (typed rules + react-hooks)
npm run format:check   # Prettier (npm run format to write)
npm test               # vitest run (all tests)
npx vitest run src/services/__tests__/pathfinding.test.ts   # single test file
npx vitest run -t "name substring"                # single test by name
```

CI (`.github/workflows/deploy.yml`, on push to `main`) runs `npm ci` → lint → test → build (with `GITHUB_PAGES=true`) → deploy to GitHub Pages. Keep lint, tests and build green.

Vitest runs in the `node` environment and only picks up `src/**/*.test.ts`, so there are no component tests. Logic that needs tests belongs in `src/services/`. Tests live in a `__tests__/` folder next to the module they test (e.g. `src/services/cloud/__tests__/`), not beside the source file.

## Architecture

Zero-backend PWA (Vite + React 19 + TypeScript + Tailwind 4). Everything runs in the browser. There is no server API.

- **`src/services/`**: pure, framework-free logic with tests in `__tests__/` folders. This is where behavior lives.
  - Map model: `mapEditing.ts` holds pure immutable edit functions (`addNode`, `toggleEdge`, `setFloorPlan`, …) that take a `MapData` and return a new one. `corridors.ts` handles bend points on edges.
  - Routing: `pathfinding.ts` (A\* over the node/edge graph), `navigation.ts`, `modeRoute.ts`, `routeAnimation.ts`, `placeSearch.ts`.
  - Localization: `visionMatcher.ts` (cosine k-NN over MobileNet embeddings), `pdr.ts` (step detection), `geometry.ts`.
  - Persistence and sharing: `mapStorage.ts` (Zod schemas that validate any imported or loaded map), `mapLibrary.ts` (multi-map library: index in `localStorage`, map bodies in IndexedDB via `idb-keyval`), `mapSharing.ts` (export, `?map=` links), `p2pSignal.ts` and `p2pTransfer.ts` (serverless WebRTC transfer using QR-encoded signalling).
- **`src/hooks/`**: wrap browser APIs and services for React (`useCamera`, `useOrientation`, `usePDR`, `useTensorFlow`, `useMapLibrary`, `useLocalStorage`). `sensorPermission.ts` handles the iOS 13+ motion-permission prompt, which requires a user gesture.
- **`src/components/`**: UI grouped by feature (`ar`, `editor`, `map`, `maps`, `scanner`, `layout`, `ui`). `src/App.tsx` is the orchestrator. It owns the active map, selection and mode state and wires editing functions from `mapEditing.ts` and `corridors.ts` to the editor UI.
- **`src/types/`**: `map.ts` is the core data model (`MapNode`, `Edge`, `Room`, `MapMetadata`, `MapData`). `vision.ts` and `navigation.ts` hold the other shared types.

Key conventions and gotchas:

- Map coordinates are in **map units**, and the longer side of the plan is 100. `metadata.metersPerUnit` converts to meters. `northOffsetDeg` maps the plan to compass heading (used by the AR arrow).
- `Edge` is a tuple `[from, to]` or `[from, to, bendPoints]`. Bend points are unnamed corners ordered from the first node to the second, so code that reads edges must handle both shapes.
- Any change to the persisted map shape must update the Zod schemas in `mapStorage.ts`. They gate imports, share links and P2P transfers.
- TensorFlow.js is a lazily loaded chunk that only loads when the camera or scanner is used. Keep it out of the main bundle. MobileNet weights are vendored in `public/models/` (`npm run fetch-model` re-downloads them) and cached at runtime by the service worker rather than precached.
- Deployment base path: `vite.config.ts` sets `base` to `/<repo>/` only when `GITHUB_PAGES` is set, otherwise `/`. Use Vite-aware paths for assets, not hardcoded absolute URLs.
- Versioning: `package.json` version is a placeholder. semantic-release (`.releaserc.json`, runs in `deploy.yml` before the build, no `@semantic-release/git`) tags `main` from conventional commits, so commit messages must use `feat:` / `fix:` / `perf:` prefixes to release anything. `vite.config.ts` injects `__APP_VERSION__` (`git describe --tags --always`, `dev` without git), `__APP_COMMIT__` and `__APP_BUILD_TIME__` via `define`, and sets the Workbox `cacheId` to `indoor-nav-<version>` so the precache name reveals the service worker's build. `VersionModal` (long press on the header logo) shows all of it; formatting logic is in `services/buildInfo.ts`.
- Camera and motion sensors need a secure context, so use `npm run dev:host` for phone testing.
- `public/default-map.json` is the sample map loaded on first start. `public/maps/*.json` are maps that can be loaded through `?map=<path>`.

## Workflow

Do not save implementation plans to `docs/` unless explicitly asked. If asked, write `docs/plan-<topic>.md` as a `- [ ]` checklist and only tick off items (`- [x]`) as they are finished, without rewriting the plan text.

`README.md` has the user-facing feature descriptions and editor and sharing workflows.
