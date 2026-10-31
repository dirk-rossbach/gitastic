import { UI_STYLE_IDS, type ThemeManifest } from '@gitastic/shared';

export type ThemeDraftMode = 'dark' | 'light';

export const THEME_VARIABLES = [
  { key: 'canvas', label: 'Canvas', group: 'surfaces' },
  { key: 'panel', label: 'Panel', group: 'surfaces' },
  { key: 'raised', label: 'Raised', group: 'surfaces' },
  { key: 'edge', label: 'Edge', group: 'surfaces' },
  { key: 'ink', label: 'Ink', group: 'text' },
  { key: 'muted', label: 'Muted', group: 'text' },
  { key: 'faint', label: 'Faint', group: 'text' },
  { key: 'accent', label: 'Accent', group: 'accents' },
  { key: 'accent-2', label: 'Accent 2', group: 'accents' },
  { key: 'accent-3', label: 'Accent 3', group: 'accents' },
  { key: 'success', label: 'Success', group: 'status' },
  { key: 'warning', label: 'Warning', group: 'status' },
  { key: 'danger', label: 'Danger', group: 'status' },
] as const;

export type ThemeVariable = (typeof THEME_VARIABLES)[number]['key'];

export type ThemeColors = Record<ThemeVariable, string>;

export interface ThemeDraft {
  id: string;
  name: string;
  mode: ThemeDraftMode;
  tagline: string;
  description: string;
  keywords: string;
  badge: string;
  fontDisplay: string;
  shadowPanel: string;
  shadowCard: string;
  colors: ThemeColors;
  swatches: string[];
  laneColors: string[];
}

export const FONT_OPTIONS = [
  { value: '', label: 'Theme default (Inter)' },
  { value: "'Inter', ui-sans-serif, system-ui, sans-serif", label: 'Inter' },
  { value: "'Space Grotesk', Inter, ui-sans-serif, system-ui, sans-serif", label: 'Space Grotesk' },
  { value: "'Lexend', ui-sans-serif, system-ui, sans-serif", label: 'Lexend' },
  {
    value: "'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif",
    label: 'Atkinson Hyperlegible',
  },
  { value: "'JetBrains Mono', SFMono-Regular, ui-monospace, monospace", label: 'JetBrains Mono' },
  { value: "'IBM Plex Mono', ui-monospace, monospace", label: 'IBM Plex Mono' },
  {
    value: "'Iowan Old Style', 'Palatino Linotype', Palatino, Georgia, serif",
    label: 'Iowan Old Style (system)',
  },
  {
    value: "'Source Serif 4', 'Iowan Old Style', Palatino, Georgia, serif",
    label: 'Source Serif 4',
  },
  { value: "'Lora', Georgia, serif", label: 'Lora' },
  { value: "'Playfair Display', Georgia, serif", label: 'Playfair Display' },
  {
    value: "'IM Fell English', 'Iowan Old Style', Palatino, Georgia, serif",
    label: 'IM Fell English',
  },
  { value: "'Cinzel Decorative', 'Iowan Old Style', Palatino, Georgia, serif", label: 'Cinzel Decorative' },
  { value: "Orbitron, 'Avenir Next Condensed', ui-sans-serif, sans-serif", label: 'Orbitron' },
  { value: "'Special Elite', 'Courier New', ui-monospace, monospace", label: 'Special Elite' },
  { value: "Fredoka, 'Arial Rounded MT Bold', 'Trebuchet MS', ui-sans-serif, sans-serif", label: 'Fredoka' },
  { value: "'VT323', 'JetBrains Mono', monospace", label: 'VT323' },
  { value: "'Press Start 2P', 'JetBrains Mono', monospace", label: 'Press Start 2P' },
] as const;

const DARK_DEFAULTS: ThemeColors = {
  canvas: '#060912',
  panel: '#0b1120',
  raised: '#141d31',
  edge: '#27334d',
  ink: '#eef5ff',
  muted: '#9daccc',
  faint: '#647394',
  accent: '#38bdf8',
  'accent-2': '#a78bfa',
  'accent-3': '#f472b6',
  success: '#2dd4bf',
  warning: '#fbbf24',
  danger: '#fb7185',
};

const LIGHT_DEFAULTS: ThemeColors = {
  canvas: '#f7faff',
  panel: '#ffffff',
  raised: '#eaf2fc',
  edge: '#cbd9ea',
  ink: '#0a1a2f',
  muted: '#526980',
  faint: '#8195ab',
  accent: '#2563eb',
  'accent-2': '#0d9488',
  'accent-3': '#f59e0b',
  success: '#0f9f6e',
  warning: '#b45309',
  danger: '#dc2626',
};

const DEFAULT_SWATCHES: Record<ThemeDraftMode, string[]> = {
  dark: ['#38bdf8', '#a78bfa', '#f472b6'],
  light: ['#2563eb', '#0d9488', '#f59e0b'],
};

const DEFAULT_LANE_COLORS = [
  '#38bdf8',
  '#2dd4bf',
  '#fbbf24',
  '#f472b6',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#a3e635',
];

export const DEFAULT_SHADOW_PANEL = '0 24px 70px rgb(0 0 0 / 0.38)';
export const DEFAULT_SHADOW_CARD =
  'inset 0 1px 0 rgb(255 255 255 / 0.04), 0 20px 55px rgb(0 0 0 / 0.2)';

export function defaultColors(mode: ThemeDraftMode): ThemeColors {
  return { ...(mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS) };
}

export function createDraft(mode: ThemeDraftMode = 'dark'): ThemeDraft {
  return {
    id: '',
    name: '',
    mode,
    tagline: '',
    description: '',
    keywords: '',
    badge: 'Custom',
    fontDisplay: '',
    shadowPanel: DEFAULT_SHADOW_PANEL,
    shadowCard: DEFAULT_SHADOW_CARD,
    colors: defaultColors(mode),
    swatches: [...DEFAULT_SWATCHES[mode]],
    laneColors: [...DEFAULT_LANE_COLORS],
  };
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 40);
}

export function isValidHex(value: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

export function isReservedId(id: string): boolean {
  return (UI_STYLE_IDS as readonly string[]).includes(id);
}

export function validateDraft(draft: ThemeDraft, takenIds: string[] = []): string[] {
  const errors: string[] = [];
  const id = draft.id.trim();
  if (!id) errors.push('Id is required.');
  else if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    errors.push('Id may only use lowercase letters, numbers and dashes.');
  } else if (isReservedId(id)) {
    errors.push('This id is reserved by a built-in theme.');
  } else if (takenIds.includes(id)) {
    errors.push('Another custom theme already uses this id.');
  }
  if (!draft.name.trim()) errors.push('Name is required.');
  for (const variable of THEME_VARIABLES) {
    if (!isValidHex(draft.colors[variable.key])) {
      errors.push(`${variable.label} needs a valid hex color.`);
    }
  }
  return errors;
}

function metadataComment(draft: ThemeDraft): string {
  const metadata = {
    id: draft.id.trim(),
    name: draft.name.trim(),
    tagline: draft.tagline.trim(),
    description: draft.description.trim(),
    keywords: draft.keywords.trim(),
    badge: draft.badge.trim() || undefined,
    modes: [draft.mode],
    swatches: draft.swatches.filter(isValidHex).slice(0, 8),
    laneColors: draft.laneColors.filter(isValidHex).slice(0, 16),
  };
  return `/* @gitastic-theme\n${JSON.stringify(metadata, null, 2)}\n*/`;
}

export function serializeTheme(draft: ThemeDraft): string {
  const id = draft.id.trim();
  const lines = THEME_VARIABLES.map(
    (variable) => `  --${variable.key}: ${draft.colors[variable.key].trim()};`,
  );
  if (draft.fontDisplay.trim()) {
    lines.unshift(`  --font-display: ${draft.fontDisplay.trim()};`);
  }
  if (draft.shadowPanel.trim()) {
    lines.unshift(`  --shadow-panel: ${draft.shadowPanel.trim()};`);
  }
  if (draft.shadowCard.trim()) {
    lines.unshift(`  --shadow-card: ${draft.shadowCard.trim()};`);
  }
  lines.push(`  color-scheme: ${draft.mode};`);
  return `${metadataComment(draft)}\n\n:root[data-style='${id}'][data-theme='${draft.mode}'] {\n${lines.join(
    '\n',
  )}\n}\n`;
}

export function draftFromManifest(
  manifest: ThemeManifest,
  css?: string | null,
  mode?: ThemeDraftMode,
): ThemeDraft {
  const resolvedMode = mode ?? (manifest.modes.includes('dark') ? 'dark' : 'light');
  const base = createDraft(resolvedMode);
  const draft: ThemeDraft = {
    ...base,
    id: manifest.id,
    name: manifest.name,
    mode: resolvedMode,
    tagline: manifest.tagline,
    description: manifest.description,
    keywords: manifest.keywords,
    badge: manifest.badge ?? 'Custom',
    swatches: manifest.swatches.length > 0 ? [...manifest.swatches] : base.swatches,
    laneColors: manifest.laneColors.length > 0 ? [...manifest.laneColors] : base.laneColors,
  };
  if (!css) return draft;
  const block = css.match(
    new RegExp(
      `\\[data-style=['"]${manifest.id}['"]\\][^{]*\\[data-theme=['"]${resolvedMode}['"]\\][^{]*\\{([\\s\\S]*?)\\}`,
    ),
  );
  if (!block) return draft;
  const body = block[1];
  for (const variable of THEME_VARIABLES) {
    const match = body.match(new RegExp(`--${variable.key}\\s*:\\s*([^;]+);`));
    if (match) draft.colors[variable.key] = match[1].trim();
  }
  const font = body.match(/--font-display\s*:\s*([^;]+);/);
  if (font) draft.fontDisplay = font[1].trim();
  const shadowPanel = body.match(/--shadow-panel\s*:\s*([^;]+);/);
  if (shadowPanel) draft.shadowPanel = shadowPanel[1].trim();
  const shadowCard = body.match(/--shadow-card\s*:\s*([^;]+);/);
  if (shadowCard) draft.shadowCard = shadowCard[1].trim();
  return draft;
}

export function downloadThemeFile(draft: ThemeDraft): void {
  const blob = new Blob([serializeTheme(draft)], { type: 'text/css' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${draft.id.trim() || 'theme'}.css`;
  anchor.click();
  URL.revokeObjectURL(url);
}
