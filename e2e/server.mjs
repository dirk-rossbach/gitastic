import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { E2E_HOME, E2E_PORT } from './constants.mjs';

fs.rmSync(E2E_HOME, { recursive: true, force: true });
fs.mkdirSync(E2E_HOME, { recursive: true });

const server = spawn(
  process.execPath,
  ['apps/server/dist/cli.js', '--no-open', '--port', String(E2E_PORT)],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      GITASTIC_HOME: E2E_HOME,
      GITASTIC_CONFIG_DIR: `${E2E_HOME}/config`,
      GITASTIC_DATA_DIR: `${E2E_HOME}/data`,
    },
  },
);

const stop = () => server.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', (code) => process.exit(code ?? 0));
