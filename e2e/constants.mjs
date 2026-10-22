import os from 'node:os';
import path from 'node:path';

export const E2E_PORT = 9890;
export const E2E_HOME = path.join(os.tmpdir(), 'gitastic-e2e-home');
