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

export interface ShadowConfig {
  enabled: boolean;
  inset: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  opacity: number;
}

export interface ThemeDraft {
  id: string;
  name: string;
  mode: ThemeDraftMode;
  tagline: string;
  description: string;
  keywords: string;
  badge: string;
  author: string;
  fontDisplay: string;
  fontBody: string;
  shadowPanel: ShadowConfig;
  shadowCard: ShadowConfig;
  colors: ThemeColors;
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

export function derivedSwatches(colors: ThemeColors): string[] {
  const candidates = [colors.accent, colors['accent-2'], colors['accent-3']].filter(isValidHex);
  return [...new Set(candidates)];
}

export const DEFAULT_SHADOW_PANEL: ShadowConfig = {
  enabled: true,
  inset: false,
  x: 0,
  y: 24,
  blur: 70,
  spread: 0,
  color: '#000000',
  opacity: 0.38,
};

export const DEFAULT_SHADOW_CARD: ShadowConfig = {
  enabled: true,
  inset: false,
  x: 0,
  y: 20,
  blur: 55,
  spread: 0,
  color: '#000000',
  opacity: 0.2,
};

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '').trim();
  const expanded =
    clean.length === 3
      ? clean
          .split('')
          .map((char) => char + char)
          .join('')
      : clean;
  const value = Number.parseInt(expanded.slice(0, 6) || '000000', 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const part = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`.toUpperCase();
}

function parseShadowColor(layer: string, fallback: ShadowConfig): { color: string; opacity: number } {
  const rgba = layer.match(/rgba?\(([^)]+)\)/i);
  if (rgba) {
    const parts = rgba[1]
      .replace(/\//g, ' ')
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((part) => Number.parseFloat(part));
    if (parts.length >= 3) {
      const alpha = parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1;
      return { color: rgbToHex(parts[0], parts[1], parts[2]), opacity: alpha };
    }
  }
  const hex = layer.match(/#[0-9a-fA-F]{3,8}/);
  if (hex) {
    return { color: hex[0].length <= 7 ? hex[0].toUpperCase() : hex[0].slice(0, 7).toUpperCase(), opacity: fallback.opacity };
  }
  return { color: fallback.color, opacity: fallback.opacity };
}

export function parseShadow(css: string | undefined, fallback: ShadowConfig): ShadowConfig {
  if (!css || !css.trim()) return fallback;
  const layers = css.split(/,(?![^(]*\))/);
  const layer = layers[layers.length - 1] ?? '';
  const geometry = layer
    .replace(/rgba?\([^)]*\)/gi, ' ')
    .replace(/#[0-9a-fA-F]{3,8}/g, ' ');
  const numbers = geometry.match(/-?\d+(?:\.\d+)?/g)?.map((value) => Number.parseFloat(value)) ?? [];
  const { color, opacity } = parseShadowColor(layer, fallback);
  return {
    enabled: true,
    inset: /\binset\b/.test(layer),
    x: clamp(numbers[0] ?? fallback.x, -60, 60),
    y: clamp(numbers[1] ?? fallback.y, -60, 60),
    blur: clamp(numbers[2] ?? fallback.blur, 0, 160),
    spread: clamp(numbers[3] ?? fallback.spread, -40, 40),
    color,
    opacity: clamp(opacity, 0, 1),
  };
}

export function shadowCss(config: ShadowConfig, insetHighlight = false): string {
  if (!config.enabled) return 'none';
  const { r, g, b } = hexToRgb(config.color);
  const alpha = clamp(config.opacity, 0, 1);
  const offsetX = clamp(config.x, -60, 60);
  const offsetY = clamp(config.y, -60, 60);
  const blur = clamp(config.blur, 0, 160);
  const spread = clamp(config.spread, -40, 40);
  const layer = `${config.inset ? 'inset ' : ''}${offsetX}px ${offsetY}px ${blur}px ${spread}px rgb(${r} ${g} ${b} / ${alpha})`;
  return insetHighlight ? `inset 0 1px 0 rgb(255 255 255 / 0.04), ${layer}` : layer;
}

export function cycleColors(colors: string[], count: number): string[] {
  const palette = colors.filter(Boolean);
  if (palette.length === 0) return [];
  return Array.from({ length: count }, (_, index) => palette[index % palette.length]);
}

export function defaultColors(mode: ThemeDraftMode): ThemeColors {
  return { ...(mode === 'dark' ? DARK_DEFAULTS : LIGHT_DEFAULTS) };
}

function relativeLuminance(hex: string): number {
  if (!isValidHex(hex)) return 0;
  const { r, g, b } = hexToRgb(hex);
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function detectMode(colors: ThemeColors): ThemeDraftMode {
  const background = isValidHex(colors.canvas) ? colors.canvas : colors.panel;
  return relativeLuminance(background) < 0.5 ? 'dark' : 'light';
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
    author: '',
    fontDisplay: '',
    fontBody: '',
    shadowPanel: { ...DEFAULT_SHADOW_PANEL },
    shadowCard: { ...DEFAULT_SHADOW_CARD },
    colors: defaultColors(mode),
    laneColors: [...DEFAULT_LANE_COLORS],
  };
}

export function normalizeShadow(input: unknown, fallback: ShadowConfig): ShadowConfig {
  if (typeof input === 'string') return parseShadow(input, fallback);
  if (input && typeof input === 'object') {
    const value = input as Partial<ShadowConfig>;
    return {
      enabled: value.enabled ?? fallback.enabled,
      inset: value.inset ?? fallback.inset,
      x: typeof value.x === 'number' ? value.x : fallback.x,
      y: typeof value.y === 'number' ? value.y : fallback.y,
      blur: typeof value.blur === 'number' ? value.blur : fallback.blur,
      spread: typeof value.spread === 'number' ? value.spread : fallback.spread,
      color: typeof value.color === 'string' ? value.color : fallback.color,
      opacity: typeof value.opacity === 'number' ? value.opacity : fallback.opacity,
    };
  }
  return fallback;
}

export function normalizeDraft(input: Partial<ThemeDraft> | null | undefined): ThemeDraft {
  const mode: ThemeDraftMode = input?.mode === 'light' ? 'light' : 'dark';
  const base = createDraft(mode);
  return {
    ...base,
    ...input,
    id: typeof input?.id === 'string' ? input.id : base.id,
    name: typeof input?.name === 'string' ? input.name : base.name,
    mode,
    tagline: typeof input?.tagline === 'string' ? input.tagline : base.tagline,
    description: typeof input?.description === 'string' ? input.description : base.description,
    keywords: typeof input?.keywords === 'string' ? input.keywords : base.keywords,
    badge: typeof input?.badge === 'string' ? input.badge : base.badge,
    author: typeof input?.author === 'string' ? input.author : base.author,
    fontDisplay: typeof input?.fontDisplay === 'string' ? input.fontDisplay : base.fontDisplay,
    fontBody: typeof input?.fontBody === 'string' ? input.fontBody : base.fontBody,
    shadowPanel: normalizeShadow(input?.shadowPanel as unknown, base.shadowPanel),
    shadowCard: normalizeShadow(input?.shadowCard as unknown, base.shadowCard),
    colors: { ...base.colors, ...(input?.colors ?? {}) },
    laneColors:
      Array.isArray(input?.laneColors) && input.laneColors.length > 0
        ? input.laneColors
        : base.laneColors,
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
    author: draft.author.trim() || undefined,
    modes: [draft.mode],
    swatches: derivedSwatches(draft.colors),
    laneColors: draft.laneColors.filter(isValidHex).slice(0, 16),
  };
  return `/* @gitastic-theme\n${JSON.stringify(metadata, null, 2)}\n*/`;
}

export function serializeTheme(draft: ThemeDraft): string {
  const id = draft.id.trim();
  const lines = THEME_VARIABLES.map(
    (variable) => `  --${variable.key}: ${draft.colors[variable.key].trim()};`,
  );
  if (draft.fontDisplay?.trim()) {
    lines.unshift(`  --font-display: ${draft.fontDisplay.trim()};`);
  }
  if (draft.fontBody?.trim()) {
    lines.unshift(`  --font-sans: ${draft.fontBody.trim()};`);
  }
  if (draft.shadowPanel) {
    lines.unshift(`  --shadow-panel: ${shadowCss(draft.shadowPanel)};`);
  }
  if (draft.shadowCard) {
    lines.unshift(`  --shadow-card: ${shadowCss(draft.shadowCard, true)};`);
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
    author: manifest.author ?? '',
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
  const bodyFont = body.match(/--font-sans\s*:\s*([^;]+);/);
  if (bodyFont) draft.fontBody = bodyFont[1].trim();
  const shadowPanel = body.match(/--shadow-panel\s*:\s*([^;]+);/);
  if (shadowPanel) draft.shadowPanel = parseShadow(shadowPanel[1].trim(), draft.shadowPanel);
  const shadowCard = body.match(/--shadow-card\s*:\s*([^;]+);/);
  if (shadowCard) draft.shadowCard = parseShadow(shadowCard[1].trim(), draft.shadowCard);
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
