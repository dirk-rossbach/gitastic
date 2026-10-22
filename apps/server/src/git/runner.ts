import { execa } from 'execa';
import { AppError } from '../errors';

export interface GitRunOptions {
  input?: string;
  signal?: AbortSignal;
  allowFail?: boolean;
  env?: NodeJS.ProcessEnv;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  errorCode?: string;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class GitRunner {
  constructor(public gitPath = 'git') {}

  async run(cwd: string, args: string[], options: GitRunOptions = {}): Promise<GitResult> {
    const fullArgs = [
      '--no-pager',
      '-c',
      'core.quotepath=false',
      '-c',
      'color.ui=false',
      '-c',
      'advice.detachedHead=false',
      ...args,
    ];

    const child = execa(this.gitPath, fullArgs, {
      cwd,
      reject: false,
      stripFinalNewline: false,
      input: options.input,
      cancelSignal: options.signal,
      maxBuffer: 100 * 1024 * 1024,
      env: {
        ...process.env,
        LC_ALL: 'C',
        LANG: 'C',
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        GIT_EDITOR: 'true',
        GIT_SEQUENCE_EDITOR: 'true',
        ...options.env,
      },
    });

    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      options.onStderr?.(text);
    });

    const result = await child;
    const exitCode = result.exitCode ?? 0;

    if (exitCode !== 0 && !options.allowFail) {
      throw new AppError(
        422,
        options.errorCode ?? 'GIT_FAILED',
        `git ${args.join(' ')} failed`,
        { args, exitCode, stderr, stdout },
      );
    }

    return { stdout, stderr, exitCode };
  }

  async version(): Promise<string | null> {
    const result = await execa(this.gitPath, ['--version'], { reject: false });
    if (result.exitCode !== 0) return null;
    const match = result.stdout.match(/git version (\S+)/);
    return match?.[1] ?? null;
  }
}
