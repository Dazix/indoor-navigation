# Visual localization with similar-looking rooms

## Context
The visual matcher (MobileNet embeddings, cosine k-NN) scores similar rooms almost equally, and the
scanner auto-confirms on an absolute score alone (>= 80 % on 2 frames). Two similar rooms can both
score 85–95 %, so the app confidently picks the wrong one.

Two fixes:
1. Auto-confirm only when the best match clearly beats the runner-up; otherwise show the candidates
   and let the user pick.
2. Soft location prior: places near the last confirmed location get a score bonus that fades with
   time. It is a bonus, not a filter, because the user may have closed the app or moved on since
   the last fix (the prior is in-memory only, so it is gone after a restart).

Branch: `feat/similar-rooms-matching`.

## 1. Ambiguity check
- [x] `pickAutoMatch(ranked, { minScore, minMargin })` in `src/services/visionMatcher.ts`
- [x] Tests in `visionMatcher.test.ts`

## 2. Location prior
- [x] `src/services/locationPrior.ts`: `proximityBoosts(map, fix, now)` (graph distance in metres from
      the last fix, fading with age)
- [x] `rankMatches` accepts `boosts`; ranks by score + boost, keeps the raw `score`
- [x] Tests in `locationPrior.test.ts` and `visionMatcher.test.ts`

## 3. Wiring
- [x] `App.tsx`: remember the last confirmed location (`relocate`) with a timestamp, pass it to the scanner
- [x] `VisionScannerModal.tsx`: apply boosts, use `pickAutoMatch`, show a "similar places, pick one" note

## 4. Verification
- [x] Tests, typecheck, lint, build
