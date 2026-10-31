# Gitastic — Visual Git Client for macOS, Windows & Linux

**The fast, local-first Git GUI for clear history, precise commits and confident conflict resolution.**

**Gitastic** helps you understand your repository, review changes and ship with confidence. It combines a visual branch graph, line-level staging, an interactive merge conflict resolver, a safe undo history and GitHub/GitLab integration in one focused developer tool. The desktop app is powered by **Tauri v2 + Rust**; a standalone local web mode is included for browser and headless workflows.

[![Version](https://img.shields.io/badge/version-1.2.1-38bdf8?style=flat-square)](#)
[![Latest release](https://img.shields.io/github/v/release/dirk-rossbach/gitastic?style=flat-square)](https://github.com/dirk-rossbach/gitastic/releases/latest)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Tauri_v2-Rust-ff2a85?style=flat-square)](#)
[![React 19](https://img.shields.io/badge/React_19-Tailwind_CSS_4-a78bfa?style=flat-square)](#)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-dirk--rossbach-fb7185?style=flat-square)](https://github.com/sponsors/dirk-rossbach)

**[Download Gitastic](https://github.com/dirk-rossbach/gitastic/releases/latest)** for macOS (universal), Windows and Linux — no cloud account, telemetry or plaintext token storage.

[Features](#highlights--features) · [Screenshots](#screenshots) · [Visual Styles](#2-fifteen-visual-styles-for-every-workflow) · [Quick Start](#quick-start--development) · [Sponsor](https://github.com/sponsors/dirk-rossbach)

---

## Why Developers Choose Gitastic

- **See the whole repository at a glance.** Explore branches, tags and commits through a responsive visual Git history instead of reconstructing repository state from terminal output.
- **Commit exactly what you intend.** Review unified or side-by-side diffs and stage individual files, hunks or lines before every commit.
- **Resolve conflicts with context.** Compare ours, theirs and the live result side by side, then accept blocks, grouped chunks or individual lines.
- **Experiment without losing your safety net.** Automatic backup refs, trash snapshots, undo and reflog recovery help you undo destructive Git operations.
- **Keep your workflow local.** Repository access stays on your machine through the system Git CLI or the native Rust backend; provider tokens remain in OS credential helpers or `gh` / `glab` keyrings.

---

## Screenshots

| Open & Clone Repositories | Visual Git History & Commit Diffs |
| :---: | :---: |
| ![Gitastic welcome screen for opening and cloning local Git repositories](docs/screenshots/welcome.png) | ![Visual Git branch graph and grouped commit diff in Gitastic](docs/screenshots/timeline.png) |

| Side-by-Side Diffs & Partial Staging | Interactive Merge Conflict Resolver |
| :---: | :---: |
| ![Side-by-side Git diff with hunk and single-line staging in Gitastic](docs/screenshots/diff-split-synthwave.png) | ![Interactive merge conflict resolver with ours, theirs and live result panes](docs/screenshots/conflicts.png) |

| Keyboard-Driven Command Palette | Styles, Git Identity & SSH Settings |
| :---: | :---: |
| ![Gitastic command palette for Git actions, branches and repository navigation](docs/screenshots/command-palette.png) | ![Gitastic settings with visual styles, Git identity and SSH key management](docs/screenshots/settings.png) |

---

## Highlights & Features

### 1. Native Desktop Performance + Local Web Mode
- **Cross-platform desktop bundles** for macOS (`.app`, `.dmg`), Windows (`.msi`, NSIS `.exe`) and Linux (`.deb`, `.rpm`, `.AppImage`), built with **Tauri v2** and a native **Rust backend**.
- **No Node.js runtime in the desktop app:** Tauri IPC (`#[tauri::command]`) connects the UI directly to the Rust backend without opening network ports.
- **Optional local web mode:** run the standalone Fastify loopback server with `npm start` on `127.0.0.1:8787` for browser or headless workflows.

### 2. Fifteen Visual Styles for Every Workflow

Choose a visual style that matches your environment — from expressive neon themes to distraction-free monochrome workspaces. Every style includes its own dark or light mode, so there is no separate theme switch.

- **Dark styles:** **Gorgeous (Default)** aurora gradients and neon glow; **Synthwave** outrun magenta and cyber-cyan; **Transilvania** blood-black gothic crimson; **Ubernerd** phosphor terminal green with CRT scanlines; **8-Bit** PICO-8 pixels, chunky arcade borders, and chiptune typography; **Smelly Socks** moldy lime, unwashed linen, and typewriter grit; **Nightmare on Main Branch** pumpkin glow, toxic green, and slasher shadows; **Domino** pure white on black.
- **Light styles:** **Daybreak** porcelain surfaces with cobalt and apricot; **Vellum** parchment, sepia ink, and wax-seal red; **Blueprint** drafting paper, navy grid, and cyan ink; **Lemon Baby** lemon yellow, tangerine orange, and lime green; **Cat's Cradle** cream paper, indigo thread, and a vermilion knot; **Ink** pure black on white.
- **Minimal by choice:** **Focus** appears in both libraries and strips out gradients, animations, and effects. **Domino** and **Ink** are strictly monochrome and also use no animations or effects.
- **Theme-specific typography:** gothic serif for Transilvania, literary serif for Vellum, rounded Fredoka for Lemon Baby, pixel fonts for 8-Bit, distressed typewriter for Smelly Socks, terminal mono for Ubernerd and Blueprint, and restrained Space Grotesk headings for Cat's Cradle, Nightmare on Main Branch, Domino, and Ink.

#### Dark Style Previews

| Gorgeous (Default) | Synthwave |
| :---: | :---: |
| ![Gorgeous dark Git client theme with aurora gradients](docs/screenshots/themes/gorgeous-dark.png) | ![Synthwave dark Git client theme with magenta and cyber-cyan](docs/screenshots/themes/synthwave-dark.png) |

| Transilvania | Ubernerd |
| :---: | :---: |
| ![Transilvania gothic dark Git client theme](docs/screenshots/themes/transilvania-dark.png) | ![Ubernerd phosphor terminal dark Git client theme](docs/screenshots/themes/ubernerd-dark.png) |

| 8-Bit | Smelly Socks |
| :---: | :---: |
| ![8-Bit retro arcade dark Git client theme](docs/screenshots/themes/8bit-dark.png) | ![Smelly Socks grunge dark Git client theme](docs/screenshots/themes/smelly-socks-dark.png) |

| Nightmare on Main Branch | Domino |
| :---: | :---: |
| ![Nightmare on Main Branch Halloween dark Git client theme](docs/screenshots/themes/nightmare-on-main-branch-dark.png) | ![Domino monochrome white-on-black Git client theme](docs/screenshots/themes/domino-dark.png) |

<table>
  <thead>
    <tr>
      <th width="50%" align="center">Focus (Dark)</th>
      <th width="50%">&nbsp;</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td width="50%" align="center"><img src="docs/screenshots/themes/focus-dark.png" alt="Focus dark minimal Git client theme without animations or effects"></td>
      <td width="50%">&nbsp;</td>
    </tr>
  </tbody>
</table>

#### Light Style Previews

| Daybreak | Vellum |
| :---: | :---: |
| ![Daybreak porcelain light Git client theme](docs/screenshots/themes/daybreak-light.png) | ![Vellum parchment light Git client theme](docs/screenshots/themes/vellum-light.png) |

| Blueprint | Lemon Baby |
| :---: | :---: |
| ![Blueprint technical light Git client theme](docs/screenshots/themes/blueprint-light.png) | ![Lemon Baby citrus light Git client theme](docs/screenshots/themes/lemon-baby-light.png) |

| Cat's Cradle | Ink |
| :---: | :---: |
| ![Cat's Cradle handmade light Git client theme](docs/screenshots/themes/cats-cradle-light.png) | ![Ink monochrome black-on-white Git client theme](docs/screenshots/themes/ink-light.png) |

<table>
  <thead>
    <tr>
      <th width="50%" align="center">Focus (Light)</th>
      <th width="50%">&nbsp;</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td width="50%" align="center"><img src="docs/screenshots/themes/focus-light.png" alt="Focus light minimal Git client theme without animations or effects"></td>
      <td width="50%">&nbsp;</td>
    </tr>
  </tbody>
</table>

### 3. Visual Diff Viewer & Precise Partial Staging
- **Unified & Side-by-Side (Split) Diff:** Switch between unified and split views at any time.
- **Hunk & Single-Line Staging / Unstaging / Discarding:** Stage, unstage, or discard individual hunks (`Stage hunk` / `Unstage hunk` / `Discard hunk`) or hover any changed line (`+` / `-`) to stage or discard that single line (`+ Stage line` / `- Unstage line` / `Discard`) via `git apply --unidiff-zero --recount`.
- **Zero Diff Noise:** Strips internal Git patch headers (`index ...`, `--- a/...`, `+++ b/...`, `new file mode`) and surfaces clean status badges (`new`, `deleted`, `renamed`, `copied`).
- **Collapsible File Cards & Badge Jump:** Click any file badge in a commit to scroll straight to its diff card and highlight it.

### 4. Visual Branch Graph & Instant History Cache
- **Server- & Rust-computed Lane Graph:** Continuous SVG branch lanes, animated commit flow, and branch labels along lanes (both inline and on lane hover).
- **Instant Re-Open Cache:** Commit histories and computed graph layouts are cached in memory and on disk (`dataDir/cache/<repoId>.json`) keyed by `git show-ref --head` fingerprint — reopening large repositories is instant. Cache can be cleared anytime in **Settings**.

### 5. GitHub & GitLab Integration (Including Self-Hosted)
- **Repo Browser & 1-Click Clone:** Search and clone your GitHub and GitLab repositories over HTTPS or SSH.
- **Pull Requests & Merge Requests:** Browse open PRs/MRs of the current repository and check them out into a local tracking branch with one click.
- **Deep-Links & Shortcuts:** Direct links to view the repository, branch, or commit on GitHub/GitLab and to create a new PR/MR for the current branch.
- **Zero-Token-Storage Security:** Gitastic never stores tokens in its own files — tokens are verified and stored exclusively in your OS credential helper (`osxkeychain` / `git credential`) or `gh` / `glab` keyring.

### 6. SSH Key & Git Identity Management
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

### Download & Install

Get the latest desktop build from **[GitHub Releases](https://github.com/dirk-rossbach/gitastic/releases/latest)**:

- **macOS:** universal DMG for Apple Silicon and Intel.
- **Windows:** NSIS installer (`.exe`) or MSI package.
- **Linux:** AppImage, Debian (`.deb`) or RPM package.

> **Unsigned builds:** Release binaries are currently **not code-signed or notarized**. macOS Gatekeeper and Windows SmartScreen will show warnings on first launch. Only download from the official GitHub Releases page and verify the published `SHA256SUMS.txt`.

- **macOS:** Right-click **Gitastic.app** and choose **Open**, or allow it under **System Settings → Privacy & Security**.
- **Windows:** In the SmartScreen dialog, choose **More info → Run anyway**.
- **Linux:** Use the `.AppImage` (`chmod +x` first) or install the `.deb` / `.rpm` package.

Code signing and Apple notarization are planned; signed assets will replace these builds under the same release.

### Requirements

- **Node.js** >= 22
- **Git** >= 2.38.0
- **Rust & Cargo** (for building the native Tauri desktop app)
- **Windows:** Rust MSVC toolchain, Visual Studio C++ Build Tools, Git for Windows and WebView2. Tauri downloads WiX/NSIS automatically; WebView2 is installed by the bootstrapper if missing.
- **Linux:** `libwebkit2gtk-4.1-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `patchelf` and `libxdo-dev` (the CI job installs these on Ubuntu 22.04).

### Build the Native Desktop App

```bash
npm install
npm run tauri:dev      # Run native desktop app in development mode
npm run tauri:build    # Build installers for the current platform
```

macOS output: `src-tauri/target/release/bundle/macos/Gitastic.app` and `.../bundle/dmg/`

Windows output: `src-tauri/target/release/bundle/msi/*.msi` and `.../bundle/nsis/*.exe`

Linux output: `src-tauri/target/release/bundle/deb/*.deb`, `.../bundle/rpm/*.rpm` and `.../bundle/appimage/*.AppImage`

CI builds macOS, Windows and Linux bundles and uploads them as the `gitastic-macos`, `gitastic-windows` and `gitastic-linux` artifacts.

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

If **Gitastic** makes your Git workflow clearer, faster or safer, consider supporting its development:

- **[♥ Sponsor @dirk-rossbach on GitHub](https://github.com/sponsors/dirk-rossbach)**
