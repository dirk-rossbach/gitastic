# Writing Gitastic themes

Gitastic ships with 15 built-in styles. Each one lives in its own file under
`apps/web/src/themes/<id>.css` and is imported by `apps/web/src/styles.css`. You can also add
your own themes without rebuilding the app.

## Where custom themes live

Custom themes are plain `.css` files stored in the Gitastic data folder:

- `$GITASTIC_DATA_DIR/themes/<id>.css`
- or, if `GITASTIC_DATA_DIR` is not set, the platform default from
  [`env-paths`](https://github.com/sindresorhus/env-paths#pathsdata) (for example
  `~/Library/Application Support/gitastic` on macOS).

Every theme file is self-contained: it carries its metadata in a leading comment and then
overrides the app's CSS variables. The app reads the folder on launch and after an import.

## Creating and installing themes

- **Theme Builder:** **Settings → Custom themes → Theme Builder** opens a visual editor with live
  preview. Pick dark or light, adjust colors, save locally and optionally export the `.css`.
- **Import:** **Settings → Custom themes → Import theme** accepts a `.css` file, validates the
  metadata and copies it into the themes folder.
- **Community:** **Settings → Custom themes → Community** lists themes published in
  [`community-themes/`](../community-themes) and installs them locally.

Custom themes only appear under **Custom themes** so the built-in style library stays clean. Each
custom theme is either dark or light. Installed themes live in `$GITASTIC_DATA_DIR/themes/` and work
offline.

## File format

A theme has two parts: a `@gitastic-theme` JSON block and one or more CSS rule blocks.

```css
/* @gitastic-theme
{
  "id": "midnight-ocean",
  "name": "Midnight Ocean",
  "tagline": "Deep water & moonlit foam",
  "description": "Cool navy surfaces with sea-glass accents.",
  "keywords": "ocean blue navy dark calm",
  "badge": "Custom",
  "modes": ["dark"],
  "swatches": ["#0b2545", "#7fb3d5", "#eaf4ff"],
  "laneColors": ["#7fb3d5", "#5dade2", "#1abc9c", "#f4d03f", "#ec7063", "#a569bd", "#5d6d7e", "#48c9b0"]
}
*/

:root[data-style='midnight-ocean'][data-theme='dark'] {
  --canvas: #06101d;
  --panel: #0b1a2b;
  --raised: #12283f;
  --edge: #274a68;
  --ink: #eaf4ff;
  --muted: #9db8d0;
  --faint: #64819a;
  --accent: #7fb3d5;
  --accent-2: #1abc9c;
  --accent-3: #f4d03f;
  --success: #1abc9c;
  --warning: #f4d03f;
  --danger: #ec7063;
  color-scheme: dark;
}
```

### Metadata

| Field         | Required | Notes                                                             |
| ------------- | -------- | ----------------------------------------------------------------- |
| `id`          | yes      | Lowercase letters, numbers and dashes. Must match the file name.  |
| `name`        | yes      | Shown in the style picker.                                        |
| `modes`       | yes      | `["dark"]`, `["light"]` or both.                                  |
| `tagline`     | no       | One short line under the name.                                    |
| `description` | no       | Longer text for the preview panel.                                |
| `keywords`    | no       | Space-separated search terms.                                     |
| `badge`       | no       | Small label in the picker. Defaults to `Custom`.                  |
| `swatches`    | no       | Up to 8 colors shown as dots.                                     |
| `laneColors`  | no       | Up to 16 colors used for the commit graph.                        |

Built-in ids are reserved and cannot be reused.

Lane colors are applied cyclically: lane `n` uses `laneColors[n % laneColors.length]`. With two
colors the lanes alternate, and when there are more lanes than colors the sequence wraps back to the
first color.

## Selectors

The app sets `data-style="<id>"` and `data-theme="dark"` or `data-theme="light"` on `<html>`.
Target your theme with an attribute selector. Prefixing with `:root` keeps the rules above the
base variables:

```css
:root[data-style='midnight-ocean'][data-theme='dark'] { /* variables */ }
:root[data-style='midnight-ocean'] body { /* optional global tweaks */ }
```

Base rules for `--font-display` and `body` font-family can also be set per theme.

### CSS variables

| Variable                       | Purpose                          |
| ------------------------------ | -------------------------------- |
| `--canvas`, `--panel`, `--raised` | Surfaces from back to front   |
| `--edge`                       | Borders and separators           |
| `--ink`, `--muted`, `--faint`  | Text at three emphasis levels    |
| `--accent`, `--accent-2`, `--accent-3` | Primary and supporting accents |
| `--success`, `--warning`, `--danger` | Status colors                |
| `--font-display`               | Headline typeface (optional)     |
| `--font-sans`                  | Body/copy typeface (optional)    |
| `--shadow-card`                | Card shadow (optional)           |
| `--shadow-panel`               | Overlay/toast shadow (optional)  |

Set `color-scheme: dark` or `color-scheme: light` so native controls match.

## Fonts

All fonts offered by the Theme Builder are bundled with Gitastic, so themes look the same on every
machine:

- **Sans:** Inter, Space Grotesk, Lexend, Atkinson Hyperlegible
- **Mono:** JetBrains Mono, IBM Plex Mono
- **Serif:** Source Serif 4, Lora, Playfair Display, IM Fell English, Cinzel Decorative, Iowan Old Style
- **Display:** Orbitron, Special Elite, Fredoka, VT323, Press Start 2P

The app body defaults to Inter, monospace text to JetBrains Mono. Set `--font-display` for headings
and `--font-sans` for body copy to use one of the stacks above.

## Shadows

The Theme Builder exposes two shadows through accessible controls (offset, blur, spread, color,
opacity and an inset toggle) instead of raw CSS:

- **Card shadow** → `--shadow-card` (used by `.card`)
- **Panel shadow** → `--shadow-panel` (used by toasts and overlays)

Both can be disabled per theme. In CSS, write a standard `box-shadow` value:

```css
--shadow-card: inset 0 1px 0 rgb(255 255 255 / 0.04), 0 20px 55px rgb(0 0 0 / 0.2);
```

## Tips

- A ready-made dark example lives at
  [`community-themes/copper-pine.css`](../community-themes/copper-pine.css), and a light one at
  [`community-themes/parchment.css`](../community-themes/parchment.css). Both can be installed from
  **Settings → Custom themes → Community**, or imported manually.
- Start from a built-in file in `apps/web/src/themes/` — copying one and renaming the id is the
  fastest way to get every variable covered.
- Custom themes are either dark or light, never both. A theme targets exactly one mode.
- Themes are local CSS only. Gitastic never downloads or executes remote theme files; community
  themes are validated before saving.
- Keep the metadata JSON valid; invalid files are ignored in the picker and rejected on import.
