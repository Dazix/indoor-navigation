# Scale from a measured reference line (e.g. one wall)

## Context
The map scale can only be set via "Scale (m / unit)" or "Longer side (m)", which needs the whole
office measured. Instead, measure one known part (a wall, a door, a room) and derive the scale —
and thus the office size — from the ratio of that part on the floor plan.

New editor tool **Measure**: tap the two ends of something on the floor plan, type its real length,
Apply → `metersPerUnit = meters / lengthInUnits`.

Branch: `feat/measure-scale`.

## 1. Helper
- [x] `metersPerUnitForSegment(a, b, meters)` in `src/services/mapEditing.ts` (null when invalid)
- [x] Tests in `mapEditing.test.ts`

## 2. Tool + state
- [x] `'measure'` in `EditorTool`, Measure button (Ruler icon) in the toolbar, 5 columns
- [x] `App.tsx`: measure points state; canvas / node taps add points, third tap starts over
- [x] Clear on tool / map change; apply sets `metersPerUnit` with a notice

## 3. Map rendering
- [x] `measureLine` prop in `InteractiveMap`: endpoints, dashed amber line, length label; crosshair cursor

## 4. Sidebar panel
- [x] Measure panel: current length, "Real length (m)" input, Apply scale, Clear, aspect note

## 5. Verification
- [x] Tests, typecheck, lint, build
- [x] Browser check: measure a wall, apply, office size in Map settings matches
