import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer } from './server';

const execFileAsync = promisify(execFile);

interface CliOptions {
  port?: number;
  open: boolean;
  dev: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { open: true, dev: false, help: false, version: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port' || arg === '-p') {
      const value = argv[index + 1];
      if (!value) throw new Error('--port requires a number.');
      options.port = Number(value);
      index += 1;
    } else if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length));
    } else if (arg === '--no-open') {
      options.open = false;
    } else if (arg === '--dev') {
      options.dev = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--version' || arg === '-v') {
      options.version = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error('--port must be an integer between 0 and 65535.');
  }
  return options;
}

function printHelp(): void {
  process.stdout.write(`Gitastic - a fast, local Git client

Usage:
  gitastic [options]

Options:
  -p, --port <port>  Port to listen on (default: 8787, falls back if busy)
      --no-open      Do not open the browser automatically
      --dev          Run in API-only development mode
  -h, --help         Show this help
  -v, --version      Show the version

The server only listens on 127.0.0.1.
`);
}

async function openBrowser(url: string): Promise<void> {
  try {
    if (process.platform === 'darwin') {
      await execFileAsync('open', [url]);
    } else if (process.platform === 'win32') {
      await execFileAsync('cmd', ['/c', 'start', '', url]);
    } else {
      await execFileAsync('xdg-open', [url]);
    }
  } catch {
    process.stderr.write(`Could not open the browser. Open ${url} manually.\n`);
  }
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    printHelp();
    return;
  }
  if (options.version) {
    process.stdout.write('0.1.0\n');
    return;
  }

  const running = await startServer({ port: options.port, dev: options.dev });
  process.stdout.write(`Gitastic is running at ${running.url}\n`);

  if (options.open) {
    await openBrowser(running.url);
  }

  const shutdown = async () => {
    await running.app.close().catch(() => undefined);
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

void main();
