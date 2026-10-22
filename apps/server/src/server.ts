import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config';
import { buildApp } from './app';
import { AppState } from './state';

export interface StartServerOptions {
  port?: number;
  dev?: boolean;
  host?: string;
}

export interface RunningServer {
  app: FastifyInstance;
  state: AppState;
  url: string;
  port: number;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function resolveWebDist(): string | null {
  const candidates = [
    path.resolve(here, '../../web/dist'),
    path.resolve(here, '../web/dist'),
    path.resolve(process.cwd(), 'apps/web/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export async function startServer(options: StartServerOptions = {}): Promise<RunningServer> {
  const config = await loadConfig();
  const state = new AppState(config);
  const webDist = options.dev ? null : resolveWebDist();
  const app = await buildApp({ state, webDist, dev: options.dev ?? false });

  const host = options.host ?? '127.0.0.1';
  const preferred = options.port ?? 8787;
  let lastError: unknown = null;

  const attempts = options.port === 0 ? 1 : 10;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const port = options.port === 0 ? 0 : preferred + attempt;
    try {
      await app.listen({ port, host });
      const address = app.server.address();
      const actualPort = typeof address === 'object' && address ? address.port : port;
      return { app, state, url: `http://${host}:${actualPort}`, port: actualPort };
    } catch (error) {
      lastError = error;
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Could not bind to a local port.');
}
