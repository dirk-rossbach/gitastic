# Agent notes

## Product

Gitastic is a local, single-user web Git client. The server owns all repository access through the system `git` CLI; the browser never receives filesystem paths beyond what the API returns. One repository is current per server process.

## Verified commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run e2e   # requires npm run build first
```

All commands above pass. `npm test` runs the Fastify integration suite in `apps/server/test`; it creates its own temporary home and repositories. `npm run e2e` starts `e2e/server.mjs` and drives Chromium against the built web app.

If Playwright cannot find its managed browser, either run `npx playwright install chromium` or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to an existing Chromium/Chrome executable.

## Architecture

- `packages/shared/src/index.ts` — all API contracts and Zod schemas. Change the schema here first.
- `apps/server/src/app.ts` — all routes, request security, SSE endpoints, static serving and undo dispatch.
- `apps/server/src/state.ts` — current repo, recent repos, settings, history caches, per-repo locks and undo stack.
- `apps/server/src/git/runner.ts` — the only process runner. Uses `execa`; the cancellation option is `cancelSignal`, not `signal`.
- `apps/server/src/git/repo.ts` — read paths: status, diffs, commit detail, branches, tags, remotes, stashes.
- `apps/server/src/git/write.ts` — mutating paths: stage, commit, branch, fetch/pull/push, merge/rebase/cherry-pick, reset, clean, restore.
- `apps/server/src/git/history.ts` — graph lane layout, pagination, blame and file history.
- `apps/server/src/git/conflict.ts` — conflict parsing and block resolution.
- `apps/server/src/git/safety.ts` — backup refs, trash and restore helpers.
- `apps/server/src/security/paths.ts` — repository boundary checks. Uses a loose realpath so nonexistent clone targets under symlinked roots still resolve correctly.
- `apps/web/src/App.tsx` — session gate, theme and shell bootstrap.
- `apps/web/src/api.ts` — typed API client and job EventSource helper.
- `apps/web/src/store.ts` — Zustand view, job, dialog and toast state.
- `apps/web/src/components/` — one view per sidebar section plus shared UI, diff, toast and job hosts.

## Invariants

- Every mutation is sent with `x-gitastic-request: 1` and passes loopback/origin checks.
- Repositories and repository files must remain inside `GITASTIC_HOME` / the user's home.
- Never pass `--no-verify`. Never store Git credentials or provider tokens.
- Force push only with `--force-with-lease`.
- Destructive operations must create a backup ref or trash entry and a matching undo entry where the UI exposes undo.
- Do not parse `git log --graph`; graph lanes are computed server-side.
- `createBranch()` creates a branch without switching. Callers that want a checkout must call `checkout()` explicitly.
- `clean` is a dry run unless `confirm: true`.
- Restore paths are scoped to the requested files; do not discard unrelated changes.

## Gotchas

- `apps/server/src/config.ts` resolves `GITASTIC_HOME`, `GITASTIC_CONFIG_DIR` and `GITASTIC_DATA_DIR` at module load. Tests set them in `apps/server/test/setup.ts` before importing app modules.
- The server serves `apps/web/dist` when present. Run the web build before testing the production server or the Playwright suite.
- Tailwind CSS 4 is configured through `@tailwindcss/vite` and `@import "tailwindcss"` in `apps/web/src/styles.css`. There is intentionally no `tailwind.config.ts` or `postcss.config.js`.
- Keep Vite and Vitest versions aligned across workspaces. A stale nested `apps/web/node_modules/vite` once caused conflicting TypeScript Vite types; a clean reinstall fixed it.
- The macOS temp directory is usually a symlink (`/tmp` → `/private/tmp`). Path comparisons must use real paths.
- `git show-ref --verify` writes to stderr when the ref is absent. Use `hasRef()` in tests instead of expecting a thrown command.
- The API returns errors as `{ error: { code, message, details? } }`. Throw `AppError` for expected failures so the status code and code are preserved.
- When hand-testing API JSON in a shell, do not pipe through zsh `echo`; it can interpret `\n` inside JSON strings. Use `printf '%s'` or parse directly in Node.
