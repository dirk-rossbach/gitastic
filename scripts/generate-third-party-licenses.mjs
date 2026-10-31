import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const licenseFileNames = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENSE-MIT',
  'LICENSE-APACHE',
  'license',
  'COPYING',
  'COPYING.md',
];

function readLicenseText(dir) {
  const parts = [];
  for (const name of licenseFileNames) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      parts.push(fs.readFileSync(file, 'utf8').trim());
    }
  }
  return parts.join('\n\n');
}

function extractCopyright(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /copyright/i.test(line))
    .slice(0, 2)
    .join(' · ');
}

function normalizeLicenseKey(license) {
  let id = (license ?? '').trim();
  if (!id) return '';
  if (/^sil ofl-?1\.1$/i.test(id)) return 'OFL-1.1';
  if (/^(the )?mit license$/i.test(id)) return 'MIT';
  const normalized = id.replace(/\//g, ' OR ').replace(/\s+/g, ' ').trim();
  if (/ OR /i.test(normalized) && !/ AND /i.test(normalized) && !/ WITH /i.test(normalized)) {
    const tokens = normalized
      .split(/ OR /i)
      .map((token) => token.trim())
      .filter(Boolean)
      .sort();
    return tokens.join(' OR ');
  }
  return normalized;
}

function groupLicenses(entries) {
  const groups = new Map();
  for (const entry of entries) {
    if (!entry.text) continue;
    const id = normalizeLicenseKey(entry.license);
    const key = id || `UNKNOWN-${createHash('sha1').update(entry.text).digest('hex').slice(0, 8)}`;
    if (!groups.has(key)) {
      groups.set(key, { license: id || 'Unknown license', texts: new Map(), packages: [] });
    }
    const group = groups.get(key);
    group.texts.set(entry.text, (group.texts.get(entry.text) ?? 0) + 1);
    group.packages.push({ label: entry.label, copyright: extractCopyright(entry.text) });
  }

  return [...groups.values()]
    .map((group) => ({
      license: group.license,
      text: [...group.texts.entries()].sort((a, b) => b[1] - a[1])[0][0],
      packages: group.packages.sort((a, b) => a.label.localeCompare(b.label)),
    }))
    .sort((a, b) => b.packages.length - a.packages.length);
}

function npmEntries() {
  const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--long', '--json'], {
    cwd: root,
    maxBuffer: 200 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  }).toString();
  const tree = JSON.parse(raw);
  const seen = new Map();
  const walk = (node) => {
    if (!node || !node.dependencies) return;
    for (const [name, dep] of Object.entries(node.dependencies)) {
      if (!name.startsWith('@gitastic/') && dep.path && !seen.has(dep.path)) {
        seen.set(dep.path, {
          label: `${name}@${dep.version}`,
          license: dep.license ?? '',
          text: readLicenseText(dep.path),
        });
      }
      walk(dep);
    }
  };
  walk(tree);
  return [...seen.values()];
}

function fontEntries() {
  const dir = path.join(root, 'apps', 'web', 'src', 'fonts', 'licenses');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.txt'))
    .map((file) => {
      const text = fs.readFileSync(path.join(dir, file), 'utf8').trim();
      return {
        label: `font: ${file.replace(/\.txt$/, '')}`,
        license: /Apache License/i.test(text) ? 'Apache-2.0' : 'SIL OFL-1.1',
        text,
      };
    });
}

function cargoEntries() {
  let metadata;
  try {
    const raw = execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--manifest-path', 'src-tauri/Cargo.toml'],
      { cwd: root, maxBuffer: 200 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    ).toString();
    metadata = JSON.parse(raw);
  } catch {
    return [];
  }
  const seen = new Map();
  for (const pkg of metadata.packages ?? []) {
    if (pkg.name === 'gitastic' || !pkg.manifest_path) continue;
    const dir = path.dirname(pkg.manifest_path);
    if (seen.has(dir)) continue;
    seen.set(dir, {
      label: `${pkg.name} ${pkg.version}`,
      license: pkg.license ?? '',
      text: readLicenseText(dir),
    });
  }
  return [...seen.values()];
}

function renderSection(title, intro, entries) {
  const groups = groupLicenses(entries);
  const lines = [`## ${title}`, '', intro, '', `${entries.length} components.`, ''];
  for (const group of groups) {
    lines.push(`### ${group.license} (${group.packages.length})`, '');
    lines.push(
      group.packages
        .map((pkg) => `- ${pkg.label}${pkg.copyright ? ` — ${pkg.copyright}` : ''}`)
        .join('\n'),
      '',
    );
    lines.push('```text', group.text.trim(), '```', '');
  }
  return lines.join('\n');
}

const npm = npmEntries();
const fonts = fontEntries();
const cargo = cargoEntries();

const header = [
  '# Third-party licenses',
  '',
  'Gitastic itself is licensed under Apache-2.0 (see [LICENSE](LICENSE)). This file lists the',
  'third-party components bundled with the application, grouped by license, with one copy of each',
  'license text and the copyright notices the licenses require us to preserve.',
  '',
  'Generated by `npm run licenses`.',
  '',
].join('\n');

const output = [
  header,
  renderSection('Bundled fonts', 'Fonts shipped with the app.', fonts),
  renderSection('npm packages', 'Runtime JavaScript dependencies of the app and server.', npm),
  renderSection('Rust crates', 'Rust dependencies compiled into the desktop application.', cargo),
].join('\n');

fs.writeFileSync(path.join(root, 'THIRD_PARTY_LICENSES.md'), `${output.trim()}\n`);
console.log(
  `Wrote THIRD_PARTY_LICENSES.md (${fonts.length} fonts, ${npm.length} npm packages, ${cargo.length} crates)`,
);
