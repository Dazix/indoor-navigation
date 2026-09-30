# Plan: editor link tool and unnamed bend points

- [x] `mapEditing.ts`: replace `toggleEdge` with idempotent `addEdge` (existing corridor is left untouched)
- [x] `App.tsx`: use `addEdge` in the link tool, so tapping an already linked node only selects it
- [x] Rename `toggleEdge` to `addEdge` in the tests and replace the "toggle removes edge" test
- [x] `InteractiveMap.tsx`: `corridorAt` returns the exact projection on the corridor (no grid snap), so the hover preview stays centred on the line
- [x] `InteractiveMap.tsx`: hover preview and click-to-add bend also in the add and link tools (desktop mouse)
- [x] `App.tsx`: `handleCanvasTap` inserts a bend on a corridor in both the add and link tools
- [ ] Add a `corridorNear` test for an unsnapped point on the corridor
- [x] `npm test`, `npm run typecheck`, `npm run lint`
- [ ] Manual check in `npm run dev`
