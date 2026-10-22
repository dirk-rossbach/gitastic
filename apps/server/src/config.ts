import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import envPaths from 'env-paths';
import { AppConfigSchema, type AppConfig, type Settings } from '@gitastic/shared';
import { isPathInside } from './security/paths';

const paths = envPaths('gitastic', { suffix: '' });

function resolveDirectory(input: string): string {
  const resolved = path.resolve(input);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

export const homeDir = resolveDirectory(process.env.GITASTIC_HOME ?? os.homedir());
export const configDir = resolveDirectory(process.env.GITASTIC_CONFIG_DIR ?? paths.config);
export const dataDir = resolveDirectory(process.env.GITASTIC_DATA_DIR ?? paths.data);
export const configFile = path.join(configDir, 'config.json');

const defaults: AppConfig = {
  theme: 'dark',
  gitPath: 'git',
  editor: '',
  pullStrategy: 'ff-only',
  diffContext: 3,
  confirmDestructive: true,
  repoRoots: [homeDir],
  recentRepos: [],
};

export async function loadConfig(): Promise<AppConfig> {
  let stored: unknown = {};
  try {
    stored = JSON.parse(await fs.readFile(configFile, 'utf8'));
  } catch {
    stored = {};
  }

  const parsed = AppConfigSchema.safeParse({ ...defaults, ...(stored as object) });
  const config = parsed.success ? parsed.data : defaults;
  config.repoRoots = [homeDir];
  config.recentRepos = config.recentRepos
    .filter((repo) => isPathInside(homeDir, repo.path))
    .slice(0, 20);
  return config;
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await fs.mkdir(configDir, { recursive: true, mode: 0o700 });
  const temp = `${configFile}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temp, configFile);
}

export async function updateSettings(config: AppConfig, patch: Settings): Promise<AppConfig> {
  const next: AppConfig = { ...config, ...patch, repoRoots: [homeDir] };
  await saveConfig(next);
  return next;
}

export { paths as envPathsResolved };
