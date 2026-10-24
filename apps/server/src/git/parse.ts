import type {
  BlameLine,
  Branch,
  CommitBase,
  ConflictBlock,
  DiffFile,
  FileKind,
  Status,
  Stash,
  Tag,
} from '@gitastic/shared';
import { shortHash } from '@gitastic/shared';

function splitRefs(value: string): string[] {
  return value
    .split(',')
    .map((ref) => ref.trim())
    .filter(Boolean);
}

function kindFromStatus(x: string, y: string): FileKind {
  if (x === '?' && y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
    return 'conflicted';
  }
  const code = x !== '.' ? x : y;
  switch (code) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'M':
    case 'T':
      return 'modified';
    default:
      return 'unknown';
  }
}

export function parseStatusV2(output: string): Status {
  let branch: string | null = null;
  let head: string | null = null;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;
  const files: Status['files'] = [];
  const tokens = output.split('\0');

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;

    if (token.startsWith('# ')) {
      const header = token.slice(2);
      if (header.startsWith('branch.oid ')) {
        const value = header.slice('branch.oid '.length).trim();
        head = value && value !== '(initial)' ? value : null;
      } else if (header.startsWith('branch.head ')) {
        const value = header.slice('branch.head '.length).trim();
        branch = value && value !== '(detached)' ? value : null;
      } else if (header.startsWith('branch.upstream ')) {
        upstream = header.slice('branch.upstream '.length).trim() || null;
      } else if (header.startsWith('branch.ab ')) {
        const match = header.match(/\+(\d+)\s+-(\d+)/);
        if (match) {
          ahead = Number(match[1]);
          behind = Number(match[2]);
        }
      }
      continue;
    }

    const type = token[0];
    if (type === '1') {
      const parts = token.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(8).join(' ');
      if (!path) continue;
      const x = xy[0] ?? '.';
      const y = xy[1] ?? '.';
      files.push({
        path,
        origPath: null,
        index: x,
        worktree: y,
        staged: x !== '.' && x !== '?',
        unstaged: y !== '.' && y !== '?',
        untracked: false,
        conflicted: false,
        kind: kindFromStatus(x, y),
      });
    } else if (type === '2') {
      const parts = token.split(' ');
      const xy = parts[1] ?? '..';
      const path = parts.slice(9).join(' ');
      const origPath = tokens[index + 1] ?? null;
      if (origPath !== null) index += 1;
      if (!path) continue;
      const x = xy[0] ?? '.';
      const y = xy[1] ?? '.';
      files.push({
        path,
        origPath,
        index: x,
        worktree: y,
        staged: x !== '.' && x !== '?',
        unstaged: y !== '.' && y !== '?',
        untracked: false,
        conflicted: false,
        kind: kindFromStatus(x, y),
      });
    } else if (type === 'u') {
      const parts = token.split(' ');
      const xy = parts[1] ?? 'UU';
      const path = parts.slice(10).join(' ');
      if (!path) continue;
      files.push({
        path,
        origPath: null,
        index: xy[0] ?? 'U',
        worktree: xy[1] ?? 'U',
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true,
        kind: 'conflicted',
      });
    } else if (type === '?' || type === '!') {
      const path = token.slice(2);
      if (!path) continue;
      files.push({
        path,
        origPath: null,
        index: '?',
        worktree: '?',
        staged: false,
        unstaged: false,
        untracked: type === '?',
        conflicted: false,
        kind: type === '?' ? 'untracked' : 'unknown',
      });
    }
  }

  return { branch, head, upstream, ahead, behind, operation: null, files };
}

export function parseCommitFields(fields: string[]): CommitBase {
  const [hash = '', parents = '', authorName = '', authorEmail = '', authorDate = ''] = fields;
  const [, , , , , committerName = '', committerEmail = '', committerDate = ''] = fields;
  const subject = fields[8] ?? '';
  const body = fields[9] ?? '';
  const refs = splitRefs(fields[10] ?? '');
  return {
    hash,
    shortHash: shortHash(hash),
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    authorName,
    authorEmail,
    authorDate,
    committerName,
    committerEmail,
    committerDate,
    subject,
    body,
    refs,
  };
}

export const COMMIT_LOG_FORMAT =
  '%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00%b%x00%D%x1e';

export function parseCommitLog(output: string): CommitBase[] {
  return output
    .split('\x1e')
    .map((record) => record.replace(/^\n+/, ''))
    .filter(Boolean)
    .map((record) => parseCommitFields(record.split('\0')))
    .filter((commit) => Boolean(commit.hash));
}

export function parseRevListParents(output: string): Array<{ hash: string; parents: string[] }> {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [hash = '', ...parents] = line.split(' ');
      return { hash, parents };
    });
}

export const BRANCH_FORMAT =
  '%(refname:short)%00%(refname)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(committerdate:iso-strict)%00%(subject)';

export function parseBranches(output: string): Branch[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', ref = '', hash = '', upstream = '', head = '', date = '', subject = ''] =
        line.split('\0');
      if (ref.endsWith('/HEAD') || name.endsWith('/HEAD')) return null;
      return {
        name,
        ref,
        hash,
        upstream: upstream || null,
        current: head === '*',
        remote: ref.startsWith('refs/remotes/'),
        date: date || null,
        subject,
      } satisfies Branch;
    })
    .filter((branch): branch is Branch => branch !== null);
}

export const TAG_FORMAT =
  '%(refname:short)%00%(refname)%00%(objectname)%00%(objecttype)%00%(taggername)%00%(creatordate:iso-strict)%00%(subject)';

export function parseTags(output: string): Tag[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', ref = '', hash = '', type = '', tagger = '', date = '', subject = ''] =
        line.split('\0');
      return {
        name,
        ref,
        hash,
        type,
        tagger: tagger || null,
        date: date || null,
        subject,
      } satisfies Tag;
    });
}

export function parseRemotes(output: string): Array<{ name: string; url: string; pushUrl: string }> {
  const map = new Map<string, { name: string; url: string; pushUrl: string }>();
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^(\S+)\t(.+?) \((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const current = map.get(name) ?? { name, url: '', pushUrl: '' };
    if (kind === 'fetch') current.url = url;
    else current.pushUrl = url;
    map.set(name, current);
  }
  return [...map.values()].map((remote) => ({
    ...remote,
    pushUrl: remote.pushUrl || remote.url,
  }));
}

export function parseStashes(output: string): Stash[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [ref = '', hash = '', message = '', date = ''] = line.split('\0');
      const match = ref.match(/stash@\{(\d+)\}/);
      return {
        index: match ? Number(match[1]) : 0,
        ref,
        hash,
        message,
        date,
      } satisfies Stash;
    });
}

export function parseNumstatZ(output: string): Array<{
  path: string;
  oldPath: string | null;
  additions: number;
  deletions: number;
  binary: boolean;
}> {
  const result: Array<{
    path: string;
    oldPath: string | null;
    additions: number;
    deletions: number;
    binary: boolean;
  }> = [];
  const tokens = output.split('\0');

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const parts = token.split('\t');
    if (parts.length < 2) continue;

    const [addText = '0', deleteText = '0', inlinePath = ''] = parts;
    let path = inlinePath;
    let oldPath: string | null = null;

    if (!path) {
      oldPath = tokens[index + 1] ?? null;
      path = tokens[index + 2] ?? '';
      index += 2;
    }

    if (!path) continue;
    const binary = addText === '-' || deleteText === '-';
    result.push({
      path,
      oldPath,
      additions: binary ? 0 : Number(addText) || 0,
      deletions: binary ? 0 : Number(deleteText) || 0,
      binary,
    });
  }

  return result;
}

export function parseNameStatusZ(
  output: string,
): Array<{ path: string; oldPath: string | null; status: FileKind }> {
  const result: Array<{ path: string; oldPath: string | null; status: FileKind }> = [];
  const tokens = output.split('\0');

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const code = token[0] ?? 'M';
    if (code === 'R' || code === 'C') {
      const oldPath = tokens[index + 1] ?? null;
      const path = tokens[index + 2] ?? '';
      index += 2;
      if (path) {
        result.push({ path, oldPath, status: code === 'R' ? 'renamed' : 'copied' });
      }
      continue;
    }
    const path = tokens[index + 1] ?? '';
    index += 1;
    if (!path) continue;
    const status: FileKind =
      code === 'A'
        ? 'added'
        : code === 'D'
          ? 'deleted'
          : code === 'U'
            ? 'conflicted'
            : code === 'T'
              ? 'modified'
              : 'modified';
    result.push({ path, oldPath: null, status });
  }

  return result;
}

export function combineDiffFiles(numstatOutput: string, nameStatusOutput: string): DiffFile[] {
  const stats = parseNumstatZ(numstatOutput);
  const statuses = parseNameStatusZ(nameStatusOutput);
  const map = new Map<string, DiffFile>();

  for (const status of statuses) {
    const stat =
      stats.find((entry) => entry.path === status.path) ??
      stats.find((entry) => entry.oldPath === status.oldPath && status.oldPath !== null);
    map.set(status.path, {
      path: status.path,
      oldPath: status.oldPath,
      status: status.status,
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      binary: stat?.binary ?? false,
    });
  }

  for (const stat of stats) {
    if (map.has(stat.path)) continue;
    map.set(stat.path, {
      path: stat.path,
      oldPath: stat.oldPath,
      status: 'modified',
      additions: stat.additions,
      deletions: stat.deletions,
      binary: stat.binary,
    });
  }

  return [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function parseBlamePorcelain(output: string): BlameLine[] {
  const lines = output.split('\n');
  const result: BlameLine[] = [];
  let current: Partial<BlameLine> & { hash?: string; line?: number } = {};

  for (const line of lines) {
    const header = line.match(/^(\^?[0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/);
    if (header) {
      current = { hash: header[1].replace(/^\^/, ''), line: Number(header[2]) };
      continue;
    }

    if (line.startsWith('\t')) {
      if (current.hash && current.line) {
        result.push({
          line: current.line,
          hash: current.hash,
          shortHash: shortHash(current.hash),
          author: current.author ?? '',
          email: current.email ?? '',
          date: current.date ?? '',
          summary: current.summary ?? '',
          content: line.slice(1),
        });
      }
      continue;
    }

    if (line.startsWith('author ')) current.author = line.slice('author '.length);
    else if (line.startsWith('author-mail ')) {
      current.email = line.slice('author-mail '.length).replace(/^<|>$/g, '');
    } else if (line.startsWith('author-time ')) {
      const seconds = Number(line.slice('author-time '.length));
      current.date = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : '';
    } else if (line.startsWith('summary ')) {
      current.summary = line.slice('summary '.length);
    }
  }

  return result;
}

export function parseConflictMarkers(content: string, path = ''): ConflictBlock[] {
  const lines = content.split(/\r?\n/);
  const blocks: ConflictBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    if (!lines[index].startsWith('<<<<<<<')) {
      index += 1;
      continue;
    }

    const startLine = index + 1;
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let mode: 'ours' | 'base' | 'theirs' = 'ours';
    index += 1;

    while (index < lines.length) {
      const line = lines[index];
      if (line.startsWith('|||||||')) {
        mode = 'base';
      } else if (line.startsWith('=======')) {
        mode = 'theirs';
      } else if (line.startsWith('>>>>>>>')) {
        break;
      } else if (mode === 'ours') {
        ours.push(line);
      } else if (mode === 'base') {
        base.push(line);
      } else {
        theirs.push(line);
      }
      index += 1;
    }

    blocks.push({
      id: `${path}:${startLine}`,
      startLine,
      endLine: index + 1,
      ours: ours.join('\n'),
      theirs: theirs.join('\n'),
      base: base.length ? base.join('\n') : null,
    });
    index += 1;
  }

  return blocks;
}
