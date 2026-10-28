# Gitastic 1.2

**Gitastic** is a fast, cross-platform local Git client for macOS, Windows and Linux (powered by **Tauri v2 + Rust**) that also runs as a local loopback web app. It combines a high-contrast, modern developer UI with deep Git power features — without cloud accounts, telemetry, or storing plaintext tokens.

[![Version](https://img.shields.io/badge/version-1.2.0-38bdf8?style=flat-square)](#)
[![Latest release](https://img.shields.io/github/v/release/dirk-rossbach/gitastic?style=flat-square)](https://github.com/dirk-rossbach/gitastic/releases/latest)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Tauri_v2-Rust-ff2a85?style=flat-square)](#)
[![React 19](https://img.shields.io/badge/React_19-Tailwind_CSS_4-a78bfa?style=flat-square)](#)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-dirk--rossbach-fb7185?style=flat-square)](https://github.com/sponsors/dirk-rossbach)

**Download:** [Latest GitHub release](https://github.com/dirk-rossbach/gitastic/releases/latest) — macOS (universal), Windows and Linux builds.

---

## Highlights & Features

### 1. Rust-Powered Desktop App + Local Web Mode
- **Desktop bundles** for macOS (`.app`, `.dmg`), Windows (`.msi`, NSIS `.exe`) and Linux (`.deb`, `.rpm`, `.AppImage`) built with **Tauri v2** and a 100% native **Rust backend** (`src-tauri/src/`).
- Uses Tauri IPC (`#[tauri::command]`) directly — zero Node.js runtime or open network ports required in the desktop app.
- Also includes a standalone local loopback server (`npm start` on `127.0.0.1:8787`) for browser or headless workflows.

### 2. Eleven Visual Styles, Grouped by Dark & Light
- **Dark:** **Gorgeous (Default)** aurora gradients and neon glow; **Synthwave** outrun magenta and cyber-cyan; **Transilvania** blood-black gothic crimson; **Ubernerd** phosphor terminal green with CRT scanlines; **8-Bit** PICO-8 pixels, chunky arcade borders, and chiptune typography; **Smelly Socks** moldy lime, unwashed linen, and typewriter grit.
- **Light:** **Daybreak** porcelain surfaces with cobalt and apricot; **Vellum** parchment, sepia ink, and wax-seal red; **Blueprint** drafting paper, navy grid, and cyan ink; **Lemon Baby** lemon yellow, tangerine orange, and lime green.
- **Focus** appears in both libraries and strips out gradients, animations, and effects.
- Styles set their own dark or light mode, so there is no separate theme switch.
- Typography follows the theme: gothic serif for Transilvania, literary serif for Vellum, rounded Fredoka for Lemon Baby, pixel fonts for 8-Bit, distressed typewriter for Smelly Socks, and terminal mono for Ubernerd and Blueprint.

### 3. Pro Diff Viewer & Partial Staging
- **Unified & Side-by-Side (Split) Diff:** Switch between unified and split views at any time.
- **Hunk & Single-Line Staging / Unstaging / Discarding:** Stage, unstage, or discard individual hunks (`Stage hunk` / `Unstage hunk` / `Discard hunk`) or hover any changed line (`+` / `-`) to stage or discard that single line (`+ Stage line` / `- Unstage line` / `Discard`) via `git apply --unidiff-zero --recount`.
- **Zero Diff Noise:** Strips internal Git patch headers (`index ...`, `--- a/...`, `+++ b/...`, `new file mode`) and surfaces clean status badges (`new`, `deleted`, `renamed`, `copied`).
- **Collapsible File Cards & Badge Jump:** Click any file badge in a commit to scroll straight to its diff card and highlight it.

### 4. Animated Branch Graph & Persistent History Cache
- **Server- & Rust-computed Lane Graph:** Continuous SVG branch lanes, animated commit flow, and branch labels along lanes (both inline and on lane hover).
- **Instant Re-Open Cache:** Commit histories and computed graph layouts are cached in memory and on disk (`dataDir/cache/<repoId>.json`) keyed by `git show-ref --head` fingerprint — reopening large repositories is instant. Cache can be cleared anytime in **Settings**.

### 5. GitHub & GitLab Integration (Including Self-Hosted)
- **Repo Browser & 1-Click Clone:** Search and clone your GitHub and GitLab repositories over HTTPS or SSH.
- **Pull Requests & Merge Requests:** Browse open PRs/MRs of the current repository and check them out into a local tracking branch with one click.
- **Deep-Links & Shortcuts:** Direct links to view the repository, branch, or commit on GitHub/GitLab and to create a new PR/MR for the current branch.
- **Zero-Token-Storage Security:** Gitastic never stores tokens in its own files — tokens are verified and stored exclusively in your OS credential helper (`osxkeychain` / `git credential`) or `gh` / `glab` keyring.

### 6. SSH Key & Git Identity Manager
- **SSH Key Management:** List keys in `~/.ssh`, generate new `ed25519` keys, copy `.pub` keys, load keys into `ssh-agent` via an interactive passphrase modal, unload keys from `ssh-agent`, or delete keys. macOS also persists unlocked keys in the Keychain; on Windows, add passphrase-protected keys with `ssh-add` in a terminal.
- **Git User Identity:** View and update global `user.name` and `user.email` directly in Settings.

### 7. Merge Conflicts, Worktrees, Stashes & Undo Safety Net
- **Interactive Conflict Resolver:** Resolve merge, rebase, and cherry-pick conflicts block-by-block (`Ours`, `Theirs`, `Both`, or manual edit) with a live resolved preview, grouped sub-chunks and hover line overrides.
- **Partial Stash:** Stash only the files you select from the Changes or Stashes view while leaving the rest of your working tree untouched.
- **Reflog Recovery:** Browse recent HEAD movements and check out any reflog entry to recover lost commits, branches, or resets.
- **Git Worktrees:** List, create, switch to, and remove linked Git worktrees (`git worktree`) for parallel branch workflows.
- **Undo Time Machine:** Destructive actions (`reset --hard`, `clean`, `restore`, branch deletion, pull/merge/rebase) automatically create backup refs (`refs/gitastic/backup/...`) and trash snapshots that can be undone with one click.
- **IDE & OS Integration:** Open the repository or any changed file directly in **Cursor**, **Zed**, **VS Code**, **Terminal**, or **Finder/Explorer**.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| **`Ctrl + P`** / **`⌘P`** / **`⌘K`** | Open **Command Palette** (Git actions, branches, repos, and styles) |
| **`⌘,`** / **`Ctrl + ,`** | Open **Settings** overlay |
| **`⌘ + Enter`** / **`Ctrl + Enter`** | Commit staged changes (in Changes view) |
| **`Esc`** | Close active modal, Command Palette, or Settings overlay |

---

## Quick Start & Development

### Requirements
- **Node.js** >= 22
- **Git** >= 2.38.0
- **Rust & Cargo** (for building the native Tauri desktop app)
- **Windows:** Rust MSVC toolchain, Visual Studio C++ Build Tools, Git for Windows and WebView2. Tauri downloads WiX/NSIS automatically; WebView2 is installed by the bootstrapper if missing.
- **Linux:** `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf` and `libxdo-dev` (the CI job installs these on Ubuntu 22.04).

### Install & Run Native Desktop App (Tauri)
```bash
npm install
npm run tauri:dev      # Run native desktop app in development mode
npm run tauri:build    # Build installers for the current platform
```
macOS output: `src-tauri/target/release/bundle/macos/Gitastic.app` and `.../bundle/dmg/`

Windows output: `src-tauri/target/release/bundle/msi/*.msi` and `.../bundle/nsis/*.exe`

Linux output: `src-tauri/target/release/bundle/deb/*.deb`, `.../bundle/rpm/*.rpm` and `.../bundle/appimage/*.AppImage`

CI builds macOS, Windows and Linux bundles and uploads them as the `gitastic-macos`, `gitastic-windows` and `gitastic-linux` artifacts.

### Unsigned Builds

> **Warning:** Release binaries are currently **not code-signed or notarized**. macOS Gatekeeper and Windows SmartScreen will show warnings on first launch. Only download from the official GitHub Releases page and verify the published `SHA256SUMS.txt`.

- **macOS:** Right-click **Gitastic.app** and choose **Open**, or allow it under **System Settings → Privacy & Security**. The app is distributed as a universal DMG for Apple Silicon and Intel.
- **Windows:** In the SmartScreen dialog, choose **More info → Run anyway**. The release includes both an NSIS installer (`.exe`) and an MSI package.
- **Linux:** Use the `.AppImage` (`chmod +x` first) or install the `.deb` / `.rpm` package.

Code signing and Apple notarization are planned; signed assets will replace these builds under the same release.

### Run Local Web / Loopback Server Mode
```bash
npm run build
npm start              # Starts local server on http://127.0.0.1:8787
```

### Verification & Tests
```bash
npm run lint           # ESLint
npm run typecheck      # TypeScript (server & web)
npm test               # Vitest integration suite (26 tests)
npm run e2e            # Playwright end-to-end UI suite
```

---

## Project Architecture

```text
src-tauri/       Native Rust backend & Tauri v2 desktop app (runner, parser, graph, ops, providers)
apps/web/        React 19 UI (Vite 8, Tailwind CSS 4, TanStack Query, Zustand)
apps/server/     Fastify loopback server for standalone web/CLI mode
packages/shared/ Shared Zod schemas, API contracts & URL builders
e2e/             Playwright end-to-end test suite
docs/            Screenshots and documentation assets
```

---

## License

Gitastic is licensed under the [Apache License 2.0](LICENSE).

---

## Support & Sponsoring

If you enjoy using **Gitastic**, consider supporting its development via GitHub Sponsors:

- **[♥ Sponsor @dirk-rossbach on GitHub](https://github.com/sponsors/dirk-rossbach)**

---

## Screenshots

| Welcome Screen (`Gorgeous` Style) | Timeline & Grouped Commit Diffs (`Gorgeous` Style) |
| :---: | :---: |
| ![Welcome Screen](docs/screenshots/welcome.png) | ![Timeline & Commit Diff](docs/screenshots/timeline.png) |

| Split Diff & Partial Staging (`Synthwave` Style) | Interactive Merge Conflict Resolver |
| :---: | :---: |
| ![Split Diff in Synthwave Style](docs/screenshots/diff-split-synthwave.png) | ![Merge Conflict Resolver](docs/screenshots/conflicts.png) |

| Command Palette (`Ctrl + P` / `⌘P`) | Settings Overlay (Styles, Identity & SSH) |
| :---: | :---: |
| ![Command Palette](docs/screenshots/command-palette.png) | ![Settings](docs/screenshots/settings.png) |
