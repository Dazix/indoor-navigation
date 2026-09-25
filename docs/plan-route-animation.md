# Route draw-on animation, travelling pulse, visible dashes

## Context
The computed route should animate: drawn progressively from the user's position to the destination,
then a subtle pulse periodically travels along it. Bug: the route dashes merge into one solid line —
`strokeDasharray 3 1.5` with `strokeWidth 2.2` and round caps leaves a negative visible gap.

Branch: `feat/route-animation`.

## 1. Visible dashes
- [x] Shorter dash / longer gap (period 5.5) so round caps leave a visible gap
- [x] `dash` keyframe offset = one period (`-5.5 * --dash-scale`)
- [x] Lighter, thinner halo so dashes stand out

## 2. Draw-on reveal
- [x] `src/services/routeAnimation.ts`: `routeKey`, `revealDurationMs`, `pulseDurationMs` + tests
- [x] Mask over halo + dashed line, white polyline `pathLength=1` animated dashoffset 1 → 0
- [x] Reveal keyed by route identity (PDR steps don't restart it), mask dropped when done
- [x] Destination pin pops in at the end of the reveal

## 3. Travelling pulse
- [x] Soft comet along the remaining route after the reveal, pause between runs, duration by distance

## 4. Verification
- [x] Reduced motion: full route shown immediately
- [x] Tests, typecheck, lint, build
- [x] Browser check: progressive drawing, pulse, dashes at several zoom levels, dark mode, replay on new destination
