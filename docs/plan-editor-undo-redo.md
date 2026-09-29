# Plan: undo / redo in the editor

Session-only snapshot history of the active map. `updateMap(fn, key?)` coalesces same-key commits within 800 ms so a drag or slider move is one step. Cap 100 snapshots. Cleared on map switch, import and load.

- [x] `src/services/history.ts`: `createHistory`, `commit`, `undo`, `redo`, `canUndo`, `canRedo`
- [x] `src/services/history.test.ts`: order, future cleared, coalescing window and key, cap, no-op commit
- [x] `useMapLibrary.ts`: `active` holds a history; `updateMap(updater, key?)`; expose `undo`, `redo`, `canUndo`, `canRedo`; fresh history on load, import and switch
- [x] `App.tsx`: keys at drag, bend drag, node details and map settings call sites
- [x] `App.tsx`: drop stale `selectedNodeId` / `linkFromId` after undo and redo
- [x] `App.tsx`: Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y in editor mode, not while typing in a field
- [x] `EditorSidebar.tsx`: undo and redo buttons above the tool row
- [ ] Verify: test, typecheck, lint, format:check, build; browser check of drag, delete + undo, redo, map switch
