import type { UiStyle } from '@gitastic/shared';
import {
  BookOpen,
  Citrus,
  Eye,
  Footprints,
  Gamepad2,
  Ruler,
  Skull,
  Sparkles,
  Sun,
  Terminal,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export type StyleMode = 'dark' | 'light';

export type UiStyleMeta = {
  id: UiStyle;
  name: string;
  tagline: string;
  description: string;
  keywords: string;
  badge?: string;
  icon: LucideIcon;
  modes: readonly StyleMode[];
  swatches: readonly string[];
  laneColors: readonly string[];
};

export const DEFAULT_STYLE_BY_MODE: Record<StyleMode, UiStyle> = {
  dark: 'gorgeous',
  light: 'daybreak',
};

const STYLE_MEMORY_KEY = 'gitastic:style-by-mode';

export const UI_STYLES: Record<UiStyle, UiStyleMeta> = {
  gorgeous: {
    id: 'gorgeous',
    name: 'Gorgeous',
    tagline: 'Aurora gradients & neon glow',
    description: 'Vibrant gradients, glowing commit dots, and fluid timeline animations.',
    keywords: 'gorgeous aurora neon gradients glow default',
    badge: 'Default',
    icon: Sparkles,
    modes: ['dark'],
    swatches: ['#38bdf8', '#a78bfa', '#f472b6'],
    laneColors: ['#38bdf8', '#2dd4bf', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#22d3ee', '#a3e635'],
  },
  synthwave: {
    id: 'synthwave',
    name: 'Synthwave',
    tagline: 'Outrun magenta & cyber-cyan',
    description: 'Hot-magenta, cyber-cyan and laser-yellow neon over an outrun grid.',
    keywords: 'synthwave cyberpunk outrun retro neon pink cyan',
    badge: 'Cyberpunk',
    icon: Zap,
    modes: ['dark'],
    swatches: ['#ff2a85', '#00f0ff', '#ffe600'],
    laneColors: ['#ff2a85', '#00f0ff', '#ffe600', '#00ff9f', '#b829ff', '#ff6b00', '#ff0055', '#00ffcc'],
  },
  transilvania: {
    id: 'transilvania',
    name: 'Transilvania',
    tagline: 'Bloodmoon gothic & candlelit shadows',
    description: 'Moonlit bone, arterial crimson, and castle-shadow surfaces.',
    keywords: 'transilvania gothic vampire castle dracula blood crimson moon',
    badge: 'Gothic',
    icon: Skull,
    modes: ['dark'],
    swatches: ['#c81d3a', '#e8d5c4', '#aebfd9'],
    laneColors: ['#c81d3a', '#e8d5c4', '#aebfd9', '#7f0d20', '#7fb58a', '#d99a3e', '#d95d74', '#5b6f8f'],
  },
  ubernerd: {
    id: 'ubernerd',
    name: 'Ubernerd',
    tagline: 'Phosphor terminal & CRT scanlines',
    description: 'Phosphor green, amber warnings, monospace labels, and CRT texture.',
    keywords: 'ubernerd terminal crt hacker phosphor green amber retro computer',
    badge: 'Nerd',
    icon: Terminal,
    modes: ['dark'],
    swatches: ['#39ff14', '#ffb000', '#00e5ff'],
    laneColors: ['#39ff14', '#ffb000', '#00e5ff', '#7dffb0', '#ff5c00', '#c6ff00', '#00ffa3', '#ff3b30'],
  },
  daybreak: {
    id: 'daybreak',
    name: 'Daybreak',
    tagline: 'Porcelain light & sunrise glow',
    description: 'Porcelain surfaces, cobalt and teal accents, and a warm apricot dawn.',
    keywords: 'daybreak light bright porcelain blue teal apricot sunrise clean',
    badge: 'Light',
    icon: Sun,
    modes: ['light'],
    swatches: ['#2563eb', '#0d9488', '#f59e0b'],
    laneColors: ['#2563eb', '#0d9488', '#f59e0b', '#7c3aed', '#e11d48', '#0891b2', '#65a30d', '#64748b'],
  },
  vellum: {
    id: 'vellum',
    name: 'Vellum',
    tagline: 'Parchment, iron-gall ink & wax seals',
    description: 'Warm parchment, sepia ink, and a wax-seal red for a literary workspace.',
    keywords: 'vellum light parchment paper sepia ink wax red literary warm',
    badge: 'Literary',
    icon: BookOpen,
    modes: ['light'],
    swatches: ['#9f1239', '#6b4f2a', '#d5c2a8'],
    laneColors: ['#9f1239', '#6b4f2a', '#8a6a3f', '#4f6b52', '#6b7280', '#a16207', '#7c5e8a', '#4b6a88'],
  },
  blueprint: {
    id: 'blueprint',
    name: 'Blueprint',
    tagline: 'Drafting paper, navy grid & cyan ink',
    description: 'Cool drafting paper, navy grid lines, cyan accents, and technical monospace details.',
    keywords: 'blueprint light technical drafting grid navy cyan paper nerd',
    badge: 'Technical',
    icon: Ruler,
    modes: ['light'],
    swatches: ['#1d4ed8', '#0891b2', '#f59e0b'],
    laneColors: ['#1d4ed8', '#0891b2', '#f59e0b', '#0f766e', '#7c3aed', '#dc2626', '#475569', '#0369a1'],
  },
  'lemon-baby': {
    id: 'lemon-baby',
    name: 'Lemon Baby',
    tagline: 'Lemon drop, tangerine & lime',
    description: 'Juicy lemon yellow, tangerine orange, and lime green over warm citrus cream.',
    keywords: 'lemon baby light yellow citrus orange lime bright playful summer zesty',
    badge: 'Zesty',
    icon: Citrus,
    modes: ['light'],
    swatches: ['#eab308', '#f97316', '#65a30d'],
    laneColors: ['#ca8a04', '#ea580c', '#4d7c0f', '#0891b2', '#db2777', '#7c3aed', '#0d9488', '#c2410c'],
  },
  '8bit': {
    id: '8bit',
    name: '8-Bit',
    tagline: 'Pixel quest & arcade cabinet',
    description: 'Chunky pixels, PICO-8 primaries, and a chiptune arcade cabinet glow.',
    keywords: '8bit 8-bit pixel arcade retro game console chiptune nes pico-8',
    badge: 'Arcade',
    icon: Gamepad2,
    modes: ['dark'],
    swatches: ['#ff004d', '#ffec27', '#00e436'],
    laneColors: ['#ff004d', '#00e436', '#29adff', '#ffec27', '#ff77a8', '#ffa300', '#83769c', '#ffccaa'],
  },
  'smelly-socks': {
    id: 'smelly-socks',
    name: 'Smelly Socks',
    tagline: 'Moldy lime & unwashed linen',
    description: 'Damp olive shadows, lint-dusted surfaces, and a radioactive lime stink.',
    keywords: 'smelly socks moldy lime laundry gross funky grunge green sock',
    badge: 'Grimy',
    icon: Footprints,
    modes: ['dark'],
    swatches: ['#b8f34a', '#e8d8b7', '#6f8f5c'],
    laneColors: ['#b8f34a', '#e8d8b7', '#8fb573', '#7ec8c0', '#d8a657', '#c98b8b', '#9a8fc4', '#6f8f5c'],
  },
  focus: {
    id: 'focus',
    name: 'Focus',
    tagline: 'Flat surfaces & zero effects',
    description: 'Fewer colors, flat surfaces, and zero animations, gradients, or neon effects.',
    keywords: 'focus minimal flat calm',
    badge: 'Minimal',
    icon: Eye,
    modes: ['dark', 'light'],
    swatches: ['#6893b8', '#9aa2b1', '#2c313c'],
    laneColors: ['#6893b8', '#7d8a9a', '#86a397', '#9b8ca6'],
  },
};

export const UI_STYLE_LIST = Object.values(UI_STYLES);

export const DARK_STYLES = UI_STYLE_LIST.filter((style) => style.modes.includes('dark'));

export const LIGHT_STYLES = UI_STYLE_LIST.filter((style) => style.modes.includes('light'));

function supportsMode(style: UiStyle, mode: StyleMode): boolean {
  return UI_STYLES[style].modes.includes(mode);
}

function readStyleMemory(): Partial<Record<StyleMode, UiStyle>> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STYLE_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<StyleMode, unknown>>;
    const memory: Partial<Record<StyleMode, UiStyle>> = {};
    for (const mode of ['dark', 'light'] as const) {
      const candidate = parsed[mode];
      if (typeof candidate === 'string' && candidate in UI_STYLES) {
        memory[mode] = candidate as UiStyle;
      }
    }
    return memory;
  } catch {
    return {};
  }
}

export function resolvedThemeMode(theme: 'dark' | 'light' | 'system'): StyleMode {
  if (theme !== 'system') return theme;
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function styleForTheme(theme: 'dark' | 'light' | 'system', style: UiStyle): UiStyle {
  const mode = resolvedThemeMode(theme);
  return supportsMode(style, mode) ? style : preferredStyleForMode(mode);
}

export function preferredStyleForMode(mode: StyleMode): UiStyle {
  const remembered = readStyleMemory()[mode];
  if (remembered && supportsMode(remembered, mode)) return remembered;
  return DEFAULT_STYLE_BY_MODE[mode];
}

export function rememberStyleForMode(mode: StyleMode, style: UiStyle): void {
  if (!supportsMode(style, mode) || typeof window === 'undefined') return;
  try {
    const memory = readStyleMemory();
    if (memory[mode] === style) return;
    window.localStorage.setItem(STYLE_MEMORY_KEY, JSON.stringify({ ...memory, [mode]: style }));
  } catch {
    // Storage can be unavailable; the in-memory defaults still work.
  }
}

export function uiStyleMeta(style: string | null | undefined): UiStyleMeta {
  return UI_STYLES[style as UiStyle] ?? UI_STYLES.gorgeous;
}

export function laneColorFor(style: string | null | undefined, lane: number): string {
  const palette = uiStyleMeta(style).laneColors;
  return palette[lane % palette.length] ?? palette[0];
}
