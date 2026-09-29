# Plan: run tests in PRs and as a separate gate before build/deploy

- [x] Create `.github/workflows/ci.yml`: on `pull_request` to `main`, job `test` (checkout, node 22, `npm ci`, lint, test), no build step, concurrency per ref with cancel-in-progress.
- [x] Edit `.github/workflows/deploy.yml`: add separate `test` job, `build` needs `test`, drop lint/test steps from `build`.
- [x] Commit on a branch off `main` and open PR.
