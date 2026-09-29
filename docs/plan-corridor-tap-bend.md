# Plan: unnamed point on a corridor, by touch

Add tool: a tap on or near a corridor inserts an unnamed bend point; a tap elsewhere still places a named location. Touch has no hover, so the Select-tool bend preview is not discoverable on a phone.

- [x] `corridors.ts`: pure `corridorNear(nodes, edges, point, maxDistance)` returning `{ edgeIndex, segmentIndex, point }` or null
- [x] `corridors.test.ts`: straight hit, bent hit (segmentIndex), miss beyond tolerance, closest of two corridors, no edges
- [x] `InteractiveMap.tsx`: `onCanvasTap(point, tolerance)` with `tolerance = 1.75 * s`
- [x] `App.tsx` `handleCanvasTap`: add_node tries `corridorNear` first and calls `insertBend` on a hit
- [x] `EditorSidebar.tsx`: update Add and Select hints
- [ ] Verify: test, typecheck, lint, format:check, build; touch check in Playwright
