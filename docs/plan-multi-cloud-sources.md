# Plan: Multiple Firebase sources and choosing cloud maps

A device can be connected to several Firebase projects ("sources"), each holding many maps, and uses only the maps the person ticks. Nothing is downloaded unless ticked.

## Design summary

- **Config:** `StoredCloudConfig = { sources: CloudSource[] }`, `CloudSource = { id, label, firebase, enabledMapIds }`. Source id is derived from the Firebase `projectId`. The old single `{ firebase, mapId }` value under the same localStorage key is migrated on read (`parseStoredCloudConfig`). A launch link adds or updates a source and enables its `cloudMap`.
- **Catalog:** every map gets a small `<mapId>~meta` document (`kind: 'meta'`: name, revision, updatedAt, nodeCount), written in the same transaction as the main document. `CloudAdapter.listMaps()` queries `kind == 'meta'` and never reads map or chunk documents. Existing rules already cover it.
- **Sync state:** `MapSyncEntry.sourceId` (optional for legacy entries, which belong to the first source).
- **Hook:** one cached adapter per Firebase project, per-source sign-in, enabled maps are downloaded once (only the link's map is opened), unticking unlinks and keeps the local copy, publishing an unlinked map asks for the project when there are several.
- **UI:** `CloudSettingsModal` lists projects (`CloudSourceCard`: account, map picker, share link) and an add form.

## Checklist

- [x] Branch `feat/multi-cloud-sources` from `main`
- [x] `cloudConfig.ts`: source model, migration, URL apply, tests
- [x] `syncState.ts`: `sourceId` on entries, helpers, tests
- [x] Catalog: meta document in `mapDocs.ts`, written in the `commitHead` transaction, `listMeta`, `CloudAdapter.listMaps`, tests
- [x] `useCloudSync`: adapter per source, per-source auth, enabled-map download, select and unlink maps, publish target
- [x] `CloudSettingsModal` and `CloudSourceCard`: projects, map picker, publish-target select
- [x] `App.tsx` wiring (cloud import without activating, header publish with several projects)
- [x] README
- [x] lint, typecheck, tests, build green; firebase still a lazy chunk
- [ ] Manual check against two real Firebase projects (list maps, tick one, sign-in per project, old single-config migration)
