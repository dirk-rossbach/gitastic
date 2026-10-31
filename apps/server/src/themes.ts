import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ThemeManifestSchema,
  UI_STYLE_IDS,
  type ThemeManifest,
} from '@gitastic/shared';
import { dataDir } from './config';
import { AppError } from './errors';

export const themesDir = path.join(dataDir, 'themes');

const RESERVED_IDS = new Set<string>(UI_STYLE_IDS);
const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const METADATA_PATTERN = /\/\*\s*@gitastic-theme\s*([\s\S]*?)\*\//;

function assertValidId(id: string): void {
  if (!ID_PATTERN.test(id)) {
    throw new AppError(
      400,
      'INVALID_THEME_ID',
      'Theme ids may only use lowercase letters, numbers and dashes.',
    );
  }
  if (RESERVED_IDS.has(id)) {
    throw new AppError(400, 'RESERVED_THEME_ID', `"${id}" is a built-in theme id.`);
  }
}

function parseManifest(css: string, fallbackId: string): ThemeManifest {
  const match = css.match(METADATA_PATTERN);
  if (!match) {
    throw new AppError(
      400,
      'MISSING_THEME_METADATA',
      'The theme file needs a /* @gitastic-theme { ... } */ metadata block.',
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(match[1]);
  } catch {
    throw new AppError(400, 'INVALID_THEME_METADATA', 'Theme metadata is not valid JSON.');
  }
  const parsed = ThemeManifestSchema.safeParse({ ...(raw as object), id: fallbackId });
  if (!parsed.success) {
    throw new AppError(400, 'INVALID_THEME_METADATA', 'Theme metadata is invalid.', {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function themeFile(id: string): string {
  const target = path.resolve(themesDir, `${id}.css`);
  if (!target.startsWith(`${path.resolve(themesDir)}${path.sep}`)) {
    throw new AppError(400, 'INVALID_THEME_ID', 'Theme id resolves outside the theme directory.');
  }
  return target;
}

export async function ensureThemesDir(): Promise<void> {
  await fs.mkdir(themesDir, { recursive: true, mode: 0o700 });
}

export async function listThemes(): Promise<ThemeManifest[]> {
  await ensureThemesDir();
  const entries = await fs.readdir(themesDir).catch(() => []);
  const themes: ThemeManifest[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.css')) continue;
    const id = entry.slice(0, -4);
    if (!ID_PATTERN.test(id) || RESERVED_IDS.has(id)) continue;
    try {
      const css = await fs.readFile(path.join(themesDir, entry), 'utf8');
      themes.push(parseManifest(css, id));
    } catch {
      // Ignore invalid theme files instead of breaking the whole library.
    }
  }
  themes.sort((a, b) => a.name.localeCompare(b.name));
  return themes;
}

export async function readThemeCss(id: string): Promise<string | null> {
  assertValidId(id);
  try {
    return await fs.readFile(themeFile(id), 'utf8');
  } catch {
    return null;
  }
}

export async function importTheme(css: string): Promise<ThemeManifest> {
  await ensureThemesDir();
  const match = METADATA_PATTERN.exec(css);
  if (!match) {
    throw new AppError(
      400,
      'MISSING_THEME_METADATA',
      'The theme file needs a /* @gitastic-theme { ... } */ metadata block.',
    );
  }
  let id = '';
  try {
    id = String((JSON.parse(match[1]) as { id?: unknown }).id ?? '');
  } catch {
    throw new AppError(400, 'INVALID_THEME_METADATA', 'Theme metadata is not valid JSON.');
  }
  assertValidId(id);
  const manifest = parseManifest(css, id);
  await fs.writeFile(themeFile(id), css, { mode: 0o600 });
  return manifest;
}

export async function deleteTheme(id: string): Promise<boolean> {
  assertValidId(id);
  try {
    await fs.unlink(themeFile(id));
    return true;
  } catch {
    return false;
  }
}
