# Walkthrough coverage report

## Context
A place is recognised from any spot only if its recorded views cover the place from several spots and
directions. Today the walkthrough shows just a sample count, so 60 near-identical frames (standing
still, pointing one way) look as good as a real tour, and the place is then recognised only from
that one spot.

Show how many *distinct* views were recorded and tell the user to keep moving or turning when new
frames only repeat what is already covered. Distinctness comes from the embeddings themselves
(greedy clustering by cosine similarity), so no new sensors and no change to the stored map shape.

Only MobileNet embeddings are judged. The colour fallback descriptor scores nearly every pair of
frames as similar, so a report from it would be misleading; nothing is shown for it.

Branch: `feat/walkthrough-coverage` (from `feat/similar-rooms-matching`).

## 1. Service
- [x] `src/services/coverage.ts`: `markNewViews`, `coverageReport` (distinct views, level, hint), `isRepeating`
- [x] Tests in `coverage.test.ts`

## 2. UI
- [x] `WalkthroughModal.tsx`: coverage card (distinct views, progress bar, hint) and a live "move or turn" warning while recording

## 3. Verification
- [x] Tests, typecheck, lint, build
