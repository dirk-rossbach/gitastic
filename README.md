# Gitastic

Gitastic is a local web-based Git client. It runs a small Fastify server on loopback, uses the system Git CLI for every repository operation, and serves a React UI for history, changes, branches, tags, remotes, merges, stashes, blame and conflict resolution.

There are no accounts, no cloud service and no provider tokens. Git uses your existing credential helper, SSH agent and commit-signing configuration.

## Requirements

- Node.js 22 or newer (the repository is tested on Node 24)
- Git 2.38.0 or newer
- A current Chrome, Chromium, Edge or Safari browser

## Quick start

```bash
npm install
npm run build
npm start
```

`npm start` opens the UI at `http://127.0.0.1:8787` unless the port is busy; in that case it searches the next ports in the 8787–8796 range. Use `--port <n>` to choose a port and `--no-open` to skip opening a browser.

For development:

```bash
npm run dev
```

This starts the API with file watching on port 8787 and Vite on port 5173. Vite proxies `/api` to the server. Open `http://localhost:5173`.

## Features

- **Repositories:** open a local repository, browse directories, clone over HTTPS or SSH, and reopen recent repositories.
- **History:** lane-based commit graph, pagination, search, ref filtering, commit details and per-file diffs.
- **Working tree:** stage, unstage, commit, amend, sign off, discard selected files, clean untracked files, and stash changes.
- **Branches and tags:** create, switch, rename, delete, set upstream, create/delete tags and push tags.
- **Remotes:** add, edit, remove, fetch, pull and push. Force pushes use `--force-with-lease`.
- **Merges and conflicts:** merge, rebase and cherry-pick, with block-level conflict resolution (ours, theirs, both, base) and operation continue/abort/skip.
- **Inspection:** file blame, file history and commit file lists.
- **Safety:** confirmation for destructive actions, backup refs for reset/merge/rebase/cherry-pick, a trash directory for deleted branches and discarded files, and undo entries for supported operations.
- **Jobs:** clone, fetch, pull and push run as cancellable background jobs with live progress over server-sent events.
- **Themes:** dark and light themes, adjustable diff context and Git executable path.

## Security model

- The server binds only to loopback and rejects non-loopback requests.
- Mutating API calls require the `x-gitastic-request: 1` header.
- Browser origins must be same-origin or an explicitly allowed local origin.
- Repositories, clone targets and file operations are restricted to the current home directory.
- The server does not store Git credentials or provider tokens.
- Git hooks run normally. Gitastic does not pass `--no-verify`.
- Commits use the repository's existing Git signing configuration.

Gitastic is a local developer tool, not a multi-user server. Do not expose the port to a network or reverse proxy it.

## Configuration

Configuration is stored as JSON with mode `0600`:

- macOS: `~/Library/Preferences/gitastic/config.json`
- Linux: `~/.config/gitastic/config.json`
- Windows: `%APPDATA%\gitastic\Config\config.json`

For tests or portable setups, override the directories:

```bash
GITASTIC_HOME=/path/to/home \
GITASTIC_CONFIG_DIR=/path/to/config \
GITASTIC_DATA_DIR=/path/to/data \
npm start
```

`GITASTIC_HOME` also becomes the repository boundary.

## Commands

```bash
npm run dev        # API + Vite development servers
npm run build      # build web assets, then the server bundle
npm start          # run the built server
npm run lint       # ESLint
npm run typecheck  # server and web TypeScript checks
npm test           # Vitest server integration tests
npm run e2e        # Playwright UI test (requires a prior build)
npm run format     # Prettier
```

The Playwright test starts its own server and uses `apps/web/dist`, so run `npm run build` first. Install Playwright browsers with `npx playwright install chromium` if needed.

## Project layout

```text
apps/server/     Fastify API, Git runner, jobs and security checks
apps/web/        React UI (Vite, Tailwind CSS 4, TanStack Query, Zustand)
packages/shared/ Shared Zod schemas and TypeScript types
e2e/             Playwright configuration, server launcher and UI test
```

The server supports one current repository per running instance and keeps a list of recent repositories. The shared package is the source of truth for request and response contracts.

## Limitations

- No GitHub/GitLab/Gitea provider integration; remotes are plain Git remotes.
- No interactive rebase, full 3-way merge editor or conflict resolution for binary files beyond choosing a side.
- Submodules, linked worktrees and Git LFS are detected and displayed, but not managed.
- Repository access is limited to the configured home directory.
- Very large diffs are truncated by the API (2 MB patch limit).

## License

Proprietary. `UNLICENSED`.
