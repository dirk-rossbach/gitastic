import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gitastic-test-')));

process.env.GITASTIC_HOME = root;
process.env.GITASTIC_CONFIG_DIR = path.join(root, 'config');
process.env.GITASTIC_DATA_DIR = path.join(root, 'data');
