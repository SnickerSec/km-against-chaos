---
name: wait-for-ci
description: Watch the GitHub Actions CI run for the latest pushed commit on this branch and report success or failure. Use after pushing to master since master auto-deploys on green CI.
disable-model-invocation: true
---

# Wait for CI

Polls the most recent GitHub Actions run for the current branch's HEAD commit and reports the outcome. Master auto-deploys to Railway on green, so this gates the deploy.

## Steps

1. Get the current commit SHA: `git rev-parse HEAD`
2. Find the run for that SHA on the current branch:
   ```bash
   gh run list --branch "$(git branch --show-current)" --commit "$(git rev-parse HEAD)" --json databaseId,status,conclusion,workflowName --limit 5
   ```
   If no run exists yet, sleep 5s and retry up to 6 times — GitHub may not have registered the push.
3. Watch it: `gh run watch <id> --exit-status`
4. On success, report green and remind: master push triggered Railway auto-deploy — use `railway logs` to confirm rollout if needed.
5. On failure, run `gh run view <id> --log-failed` and surface the failing step plus the relevant log lines.

## Notes

- CI workflow is `.github/workflows/ci.yml` (lint client, typecheck server, test server, test client, build).
- Don't try to fix failures here — surface them and let the user decide.
