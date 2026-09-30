# Plan: Local-first cloud sync (Firebase)

Optional cloud layer. Edits stay local-first (IndexedDB + localStorage index, unchanged). An explicit "Sync / Publish" pushes to Firestore after Google sign-in. Visitors read and navigate without signing in. Config comes only from the settings dialog or a link (saved to localStorage), never from env vars; without it the app is purely local.

## Design summary

- **Firestore layout:** everything lives as sibling docs in `indoorMaps` so the README rules (`match /indoorMaps/{mapId}`) work unchanged. Main doc `{mapId}` (`kind:'map'`) holds name, metadata, nodes without embeddings, edges as `{from,to,bends?}` objects (Firestore rejects nested arrays), rooms, `revision`, and per-chunk `rev`. Heavy data goes into chunk docs `{mapId}~fp~{i}` (floor plan) and `{mapId}~emb~{nodeId}~{i}` (embeddings), each <= ~700 KB. Push writes chunks first and the main doc last. Pull validates with `parseMapData`.
- **Sync state:** separate localStorage key `indoor_nav_sync_v1` (`cloudMapId`, `baseRevision`, `dirty`, `lastSyncedAt`), so the map Zod schemas stay untouched. `useMapLibrary.flush` gets an `onPersisted(mapId)` callback that marks the map dirty.
- **Status:** Synced / Unsaved local changes / Offline, hidden without cloud config. Push needs sign-in and never overwrites silently: a differing remote `revision` opens a conflict choice (keep mine / take cloud).
- **Live updates:** `onSnapshot` on the main doc only. Clean local and not navigating: fetch changed chunks and apply with a "Map updated" notice. Dirty local: conflict banner. Active route: "Update available, apply".
- **Config:** `cloudConfig.ts` (pure). Saved config or null (no env vars, by decision). URL bootstrap via query params `cfg` (base64url JSON) and `cloudMap`, then a "Clean URL" button strips them.
- **Adapter:** `CloudAdapter` interface, `nullAdapter` fallback, lazy `firestoreAdapter` (dynamic firebase imports, separate chunk). Google sign-in via `signInWithPopup`.

## Checklist

- [x] Branch from `main`; add pinned `firebase` dependency (env-var config was dropped: no `vite-env.d.ts`, `.env.example`)
- [x] `cloudConfig.ts` + tests (Zod schema, cascade, URL parse/build, clean URL)
- [x] `cloud/mapDocs.ts` + tests (chunking, edge conversion, round-trip through `parseMapData`)
- [x] `cloud/syncState.ts` + tests (status, dirty tracking, conflict decision)
- [x] `cloud/types.ts`, `nullAdapter`, lazy `firestoreAdapter` (+ fake-SDK test)
- [x] `useMapLibrary` `onPersisted` hook; `useCloudSync` hook (config, auth, status, push, pull, live updates)
- [x] `SyncStatus` in `Header`, `CloudSettingsModal`, conflict dialog, URL bootstrap in `App.tsx`
- [x] README rewrite of setup/config/security sections with the three Rules scenarios
- [x] lint, typecheck, test, build green; check firebase is in its own chunk

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build`; confirm firebase is a separate lazy chunk and the main bundle did not grow.
- No config: app behaves exactly as before, no cloud UI.
- Real test Firebase project or emulator: URL config persisted and cleaned, status transitions, sign-in and sync, unauthenticated read-only navigation, rule rejection for a non-company account, offline status, two-browser conflict and live update, large map (several walked nodes plus a 2048 px floor plan) round-trip.
