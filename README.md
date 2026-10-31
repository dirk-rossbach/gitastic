# Gitastic — Visual Git Client for macOS, Windows & Linux

**Git, but easier to see and understand.**

**Gitastic** is a desktop app that helps you work with Git repositories without living in the terminal. It shows your branches and history as a clear visual graph, lets you review and commit changes, and helps you resolve merge conflicts side by side. Everything runs locally on your computer — no account, no cloud and no telemetry.

[![Version](https://img.shields.io/badge/version-1.2.2-38bdf8?style=flat-square)](#)
[![Latest release](https://img.shields.io/github/v/release/dirk-rossbach/gitastic?style=flat-square)](https://github.com/dirk-rossbach/gitastic/releases/latest)
[![License](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Tauri_v2-Rust-ff2a85?style=flat-square)](#)
[![React 19](https://img.shields.io/badge/React_19-Tailwind_CSS_4-a78bfa?style=flat-square)](#)
[![Sponsor](https://img.shields.io/badge/%E2%99%A5_Sponsor-dirk--rossbach-fb7185?style=flat-square)](https://github.com/sponsors/dirk-rossbach)

**[Download Gitastic](https://github.com/dirk-rossbach/gitastic/releases/latest)** for macOS, Windows or Linux.

[What is Gitastic?](#what-is-gitastic) · [Screenshots](#screenshots) · [Features](#what-you-can-do) · [Themes](#themes) · [Install](#install) · [For developers](#for-developers)

---

## What is Gitastic?

Git is powerful, but it can be hard to see what is going on. Gitastic gives you a visual overview of your repository and keeps the important actions simple:

- Open a local repository or clone one from GitHub or GitLab.
- See branches, tags and commits in a visual history.
- Review changes and commit only the parts you want.
- Resolve merge conflicts without editing conflict markers by hand.
- Undo mistakes with a built-in safety net.

You do not need to know every Git command to use Gitastic. If you already work with Git, you can keep your existing repositories, remotes and credentials.

### Getting started

1. **Download and install** Gitastic for your platform.
2. **Open a repository** or clone one from GitHub or GitLab.
3. **Explore the history**, review your changes and start committing.

---

## Why people use Gitastic

- **Understand your project at a glance.** Branches, tags and commits are shown as a clear visual graph instead of plain terminal output.
- **Commit with confidence.** Review changes side by side and stage only the files, parts or lines you actually want to commit.
- **Fix conflicts visually.** Compare your version, the other version and the result while you resolve conflicts.
- **Experiment without fear.** Automatic backups and undo help you recover from destructive actions.
- **Keep your work private.** Repositories stay on your machine. Gitastic does not send your code to a cloud service.
- **Connect your accounts.** Clone repositories and browse pull requests or merge requests from GitHub and GitLab, including self-hosted instances.

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

## What you can do

### See your repository clearly

Browse branches, tags and commits in a visual history. Search for commits, jump between branches and use the command palette to reach actions quickly. Recently opened repositories are ready when you come back.

### Review and commit changes

Switch between a unified diff and a side-by-side view. Stage a whole file, a section of changes or a single line, then write your commit message and commit. This makes it easy to keep unrelated changes out of the same commit.

### Resolve merge conflicts

When a merge, rebase or cherry-pick has conflicts, Gitastic shows your version, the other version and the live result together. Accept a block, a group of lines or a single line — or edit the result directly.

### Undo mistakes safely

Destructive actions create a backup automatically. If something goes wrong, use the undo history to restore commits, branches or changes. You can also browse your repository's recovery history to find work you thought was lost.

### Work with GitHub and GitLab

Clone repositories over HTTPS or SSH, browse open pull requests or merge requests, check them out locally and open the repository, branch or commit in your browser. Gitastic supports GitHub, GitLab and self-hosted GitLab instances. Your access tokens are stored in your operating system's secure credential store, not in Gitastic's own files.

### Manage SSH keys and your Git identity

View the SSH keys on your machine, create new keys, copy public keys, add keys to the SSH agent or remove them. You can also set the name and email address used for your Git commits.

### Keep changes aside and use multiple branches

Set aside only the files you select without committing them. Work on several branches at the same time with linked worktrees, and open the repository or a changed file in Cursor, Zed, VS Code, Terminal or Finder/Explorer.

### Make Gitastic look like your workspace

Choose from 15 visual styles, from calm monochrome layouts to colourful retro themes. Each style includes its own light or dark appearance, so there is no separate theme switch.

---

## Themes

Gitastic ships with **15 visual styles**. Each style is self-contained and already includes its preferred light or dark appearance.

- **Dark styles:** Gorgeous (default), Synthwave, Transilvania, Ubernerd, 8-Bit, Smelly Socks, Nightmare on Main Branch and Domino.
- **Light styles:** Daybreak, Vellum, Blueprint, Lemon Baby, Cat's Cradle and Ink.
- **Minimal options:** Focus is available in dark and light versions. Domino and Ink are strictly monochrome. These styles remove animations, gradients and other visual effects.

### Custom themes

Prefer your own palette? Every style is a single CSS file, and you can import your own themes from **Settings → Custom themes**. Add a `.css` file with a `/* @gitastic-theme { ... } */` metadata block, then pick it from the style library. See **[docs/THEMES.md](docs/THEMES.md)** for the format and a full reference.

### Dark style previews

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

### Light style previews

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

---

## Keyboard shortcuts

| Shortcut | Action |
| :--- | :--- |
| **`Ctrl + P`** / **`⌘P`** / **`⌘K`** | Open the command palette |
| **`⌘,`** / **`Ctrl + ,`** | Open settings |
| **`⌘ + Enter`** / **`Ctrl + Enter`** | Commit staged changes |
| **`Esc`** | Close the active window or overlay |

---

## Install

Download the latest version from **[GitHub Releases](https://github.com/dirk-rossbach/gitastic/releases/latest)**.

- **macOS:** universal DMG for Apple Silicon and Intel.
- **Windows:** NSIS installer (`.exe`) or MSI package.
- **Linux:** AppImage, Debian (`.deb`) or RPM package.

> **These builds are not code-signed or notarized yet.** macOS and Windows may show a warning the first time you open the app.

- **macOS:** Right-click **Gitastic.app** and choose **Open**, or allow it under **System Settings → Privacy & Security**.
- **Windows:** In the SmartScreen dialog, choose **More info → Run anyway**.
- **Linux:** Make the AppImage executable first (`chmod +x`) or install the `.deb` / `.rpm` package.

Only download Gitastic from the official GitHub Releases page and verify the published `SHA256SUMS.txt`.

---

## For developers

Gitastic is open source and built with Tauri v2, Rust, React and TypeScript.

### Requirements

- Node.js 22 or newer
- Git 2.38 or newer
- Rust and Cargo for the native desktop app
- **Windows:** Rust MSVC toolchain, Visual Studio C++ Build Tools, Git for Windows and WebView2
- **Linux:** the WebKitGTK, AppIndicator, librsvg, patchelf and libxdo development packages

### Build and run

```bash
npm install
npm run tauri:dev      # Run the desktop app in development mode
npm run tauri:build    # Build installers for the current platform
```

### Local web mode

Gitastic also includes a local web mode for browser-based and headless workflows:

```bash
npm run build
npm start              # Opens the app at http://127.0.0.1:8787
```

### Tests

```bash
npm run lint
npm run typecheck
npm test
npm run e2e
```

### Project structure

```text
src-tauri/        Native Rust backend and Tauri desktop app
apps/web/         React user interface
apps/server/      Local server for web mode
packages/shared/  Shared API types and schemas
e2e/              End-to-end tests
docs/             Screenshots and documentation assets
```

---

## License

Gitastic is licensed under the [Apache License 2.0](LICENSE).

---

## Support & sponsoring

If Gitastic makes your Git workflow clearer or safer, consider supporting its development:

- **[♥ Sponsor @dirk-rossbach on GitHub](https://github.com/sponsors/dirk-rossbach)**
