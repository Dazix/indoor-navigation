# Corridor bend points, corridor deletion, search by name, location links

## Context
Corners and turns in corridors currently need a full node (name, marker, embeddings), which then clutters destinations and navigation. Goals:
1. **Bend points** on a corridor: hovering a corridor shows a point under the cursor, a click creates it; bends can be dragged and have no metadata.
2. **Delete only a corridor**, not the whole node.
3. **Search by name**: in navigation (destination: locations + rooms) and in the editor (select + zoom to a node).
4. **Location address**: every full node has a URL; opening it starts navigation to that node.

Branch: `feat/corridor-bends-search`.

## 1. Data model
- [x] `Edge = [string, string] | [string, string, Point[]]` in `src/types/map.ts` (bends ordered from `edge[0]` to `edge[1]`)

## 2. Corridor service `src/services/corridors.ts`
- [x] `edgeBends`, `corridorPoints(nodes, edge, fromId)`, `findEdgeIndex` (move `sameEdge` here)
- [x] `insertBend`, `moveBend`, `deleteBend` (empty → `[u, v]`), `deleteEdge`
- [x] `nearestOnPolyline(points, p) → { segmentIndex, point }`
- [x] Tests in `corridors.test.ts`

## 3. Pathfinding and navigation
- [x] `buildGraph` cost = polyline length through bends
- [x] `computeRoute` expands bends into `points`, adds `pointNodeIndex` / `nextNodeIndex`; `next.node` is the next real node, bearing/distance aim at the next vertex
- [x] `App.tsx` `navigateTo` uses `nextNodeIndex`
- [x] Tests in `navigation.test.ts` / `pathfinding.test.ts`

## 4. Transforms and validation
- [x] `setMapAspect` and `rotateMap90` transform bends
- [x] `mapStorage.ts` schema accepts bends, checks them inside the map
- [x] Tests in `mapStorage.test.ts` / `mapEditing.test.ts`

## 5. Editor map `InteractiveMap.tsx`
- [x] Corridors drawn as polylines with a wide invisible hit stroke
- [x] Hover ghost point on a corridor (mouse), click / tap creates a bend, press + drag creates and drags it
- [x] Existing bends rendered as draggable diamonds
- [x] New props: `onBendInsert`, `onBendDrag`, `onEdgeTap`, `onBendTap`, `focusPoint`

## 6. Editor wiring `App.tsx`, `EditorSidebar.tsx`
- [x] Handlers via `updateMap`; Delete tool: corridor → `deleteEdge`, bend → `deleteBend`, node → `deleteNode`
- [x] Tool hints updated

## 7. Search by name
- [x] `searchPlaces(map, query)` in `src/services/placeSearch.ts` (nodes + rooms, case/diacritics-insensitive, prefix first) + tests
- [x] `LocationSearch.tsx` combobox (↑/↓/Enter/Esc)
- [x] User mode: search replaces the "Tap a room…" hint, pick → navigate
- [x] Editor: search in sidebar, pick → select node + zoom to it

## 8. Location links
- [x] `TO_URL_PARAM`, `buildNodeLink(appUrl, nodeId, mapSourceUrl?)` in `mapSharing.ts` + tests
- [x] `App.tsx` reads and strips `?to=` on load, navigates after the `?map=` import (or finds the map in the library), notice when not found
- [x] `NodeDetailsCard.tsx` link section: copy, share, QR

## Verification
- [x] `npm test`, typecheck, lint, build pass
- [x] Browser: hover ghost point, click creates bend, drag, reload keeps it
- [x] Browser: Delete tool removes a bend / a corridor, nodes stay
- [x] Browser: rotate 90° rotates bends; route draws the bent line
- [x] Browser: search with diacritics, Enter navigates; editor search zooms to node
- [x] Browser: node link opens navigation, `?to=` removed from URL; unknown id shows notice
