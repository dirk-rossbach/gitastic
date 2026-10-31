import { CommunityThemeSchema, type CommunityTheme } from '@gitastic/shared';
import { AppError } from './errors';
import { importTheme, listThemes, parseThemeMetadata } from './themes';

const REPO = 'dirk-rossbach/gitastic';
const BRANCH = 'main';
const DIRECTORY = 'community-themes';
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${DIRECTORY}`;

const FORBIDDEN_PATTERNS: RegExp[] = [
  /@import/i,
  /@font-face/i,
  /@charset/i,
  /@namespace/i,
  /@keyframes/i,
  /-moz-binding/i,
  /behavior\s*:/i,
  /expression\s*\(/i,
  /javascript:/i,
  /url\s*\(/i,
];

type IndexEntry = {
  id: string;
  name: string;
  mode: 'dark' | 'light';
  tagline?: string;
  description?: string;
  keywords?: string;
  badge?: string;
  author?: string;
  swatches?: string[];
  laneColors?: string[];
  path: string;
};

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'text/plain, application/json' },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function selectorsIn(css: string): string[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const selectors: string[] = [];
  let buffer = '';
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '"' || char === "'") {
      const quote = char;
      buffer += char;
      i += 1;
      while (i < clean.length && clean[i] !== quote) {
        if (clean[i] === '\\') {
          buffer += clean[i];
          i += 1;
        }
        buffer += clean[i];
        i += 1;
      }
      buffer += clean[i] ?? '';
      continue;
    }
    if (char === '{') {
      selectors.push(buffer.trim());
      buffer = '';
      continue;
    }
    if (char === '}') {
      buffer = '';
      continue;
    }
    buffer += char;
  }
  return selectors.filter(Boolean);
}

export function assertSafeCommunityCss(css: string, id: string): void {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(withoutComments)) {
      throw new AppError(
        400,
        'UNSAFE_THEME_CSS',
        'The theme contains CSS features that are not allowed for community themes.',
      );
    }
  }
  const references = [...css.matchAll(/data-style\s*=\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
  if (references.length === 0 || references.some((value) => value !== id)) {
    throw new AppError(
      400,
      'UNSAFE_THEME_CSS',
      'Every selector in a community theme must be scoped to its own data-style id.',
    );
  }
  for (const selector of selectorsIn(css)) {
    if (selector.startsWith('@')) continue;
    if (!/data-style\s*=/.test(selector)) {
      throw new AppError(
        400,
        'UNSAFE_THEME_CSS',
        'Every rule in a community theme must be scoped to its data-style id.',
      );
    }
  }
}

function entryToManifest(entry: IndexEntry, installed: Set<string>): CommunityTheme {
  return CommunityThemeSchema.parse({
    id: entry.id,
    name: entry.name,
    tagline: entry.tagline ?? '',
    description: entry.description ?? '',
    keywords: entry.keywords ?? '',
    badge: entry.badge,
    author: entry.author,
    modes: [entry.mode],
    swatches: entry.swatches ?? [],
    laneColors: entry.laneColors ?? [],
    path: entry.path,
    installed: installed.has(entry.id),
  });
}

async function loadDirectory(): Promise<IndexEntry[]> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/contents/${DIRECTORY}?ref=${BRANCH}`, {
    headers: { Accept: 'application/vnd.github+json' },
  }).catch(() => null);
  if (!response || !response.ok) {
    throw new AppError(502, 'COMMUNITY_LIST_FAILED', 'Could not read the community themes folder.');
  }
  const entries = (await response.json()) as Array<{ name: string; download_url?: string }>;
  const themes: IndexEntry[] = [];
  for (const entry of entries) {
    if (!entry.name.endsWith('.css') || !entry.download_url) continue;
    const css = await fetchText(entry.download_url);
    if (!css) continue;
    const id = entry.name.slice(0, -4);
    try {
      const manifest = parseThemeMetadata(css, id);
      themes.push({
        id: manifest.id,
        name: manifest.name,
        mode: manifest.modes.includes('dark') ? 'dark' : 'light',
        tagline: manifest.tagline,
        description: manifest.description,
        keywords: manifest.keywords,
        badge: manifest.badge,
        author: manifest.author,
        swatches: manifest.swatches,
        laneColors: manifest.laneColors,
        path: entry.name,
      });
    } catch {
      // Skip invalid theme files.
    }
  }
  return themes;
}

export async function listCommunityThemes(): Promise<CommunityTheme[]> {
  const installed = new Set((await listThemes()).map((theme) => theme.id));
  const entries = await loadDirectory();
  return entries
    .map((entry) => entryToManifest(entry, installed))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function installCommunityTheme(id: string): Promise<CommunityTheme> {
  const path = `${id}.css`;
  const css = await fetchText(`${RAW_BASE}/${path}`);
  if (!css) {
    throw new AppError(404, 'THEME_NOT_FOUND', `Could not download theme: ${id}`);
  }
  assertSafeCommunityCss(css, id);
  const manifest = await importTheme(css);
  return { ...manifest, path, installed: true };
}
