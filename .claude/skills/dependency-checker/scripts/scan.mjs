#!/usr/bin/env node
/**
 * Collect the dependency facts of a multi-package repo that is NOT a workspace.
 *
 * Emits JSON on stdout. Everything here is measurement — no judgement, no advice.
 * The skill turns this into a report; keeping the two apart means the numbers are
 * reproducible and reviewable on their own.
 *
 * Usage: node scan.mjs [repo-root] [--json out.json]
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'clones']);
const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb'];
const MANAGER = {
  'package-lock.json': 'npm',
  'pnpm-lock.yaml': 'pnpm',
  'yarn.lock': 'yarn',
  'bun.lockb': 'bun',
};

/**
 * Strip // and /* *\/ comments while respecting string literals. A regex cannot do
 * this: tsconfig path maps contain "@/*" and "./src/*", and a naive block-comment
 * pattern treats those as an opening delimiter and eats the rest of the file.
 */
function stripJsonComments(src) {
  let out = '';
  let inStr = false;
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 1;
      } else if (c === quote) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      quote = c;
      out += c;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += c;
  }
  return out;
}

const readJson = (f) => {
  let raw;
  try {
    raw = readFileSync(f, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(stripJsonComments(raw).replace(/,(\s*[}\]])/g, '$1'));
    } catch {
      return null;
    }
  }
};

/** Every directory holding a package.json, excluding installed packages. */
function findPackages(dir, found = []) {
  if (existsSync(path.join(dir, 'package.json'))) found.push(dir);
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
    findPackages(path.join(dir, e.name), found);
  }
  return found;
}

function dirSize(dir) {
  let bytes = 0;
  let stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          bytes += statSync(full).size;
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }
  return bytes;
}

/** Installed packages under a node_modules tree, flat, scopes expanded. */
function installedPackages(nm) {
  const out = new Map();
  if (!existsSync(nm)) return out;
  const isDir = (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  // pnpm symlinks only DIRECT dependencies into node_modules/; everything transitive
  // lives under .pnpm/<name>@<version>/node_modules/<name>. Without this pass the
  // weight of a pnpm package is understated to just its direct deps.
  const pnpmStore = path.join(nm, '.pnpm');
  if (existsSync(pnpmStore)) {
    for (const entry of readdirSync(pnpmStore)) {
      const inner = path.join(pnpmStore, entry, 'node_modules');
      if (!existsSync(inner)) continue;
      for (const e of readdirSync(inner)) {
        if (e === '.bin' || e.startsWith('.')) continue;
        const at = path.join(inner, e);
        if (e.startsWith('@')) {
          for (const sc of readdirSync(at)) {
            const full = path.join(at, sc);
            if (!out.has(`${e}/${sc}`)) out.set(`${e}/${sc}`, full);
          }
        } else if (!out.has(e)) {
          out.set(e, at);
        }
      }
    }
  }

  for (const e of readdirSync(nm)) {
    if (e === '.bin' || e.startsWith('.')) continue;
    const at = path.join(nm, e);
    if (!isDir(at)) continue;
    if (e.startsWith('@')) {
      for (const sc of readdirSync(at)) {
        if (isDir(path.join(at, sc))) out.set(`${e}/${sc}`, path.join(at, sc));
      }
    } else {
      out.set(e, at);
    }
  }
  return out;
}

/**
 * Reachability from one declared dependency, and the part of it nothing else needs.
 * "exclusive" is the number that matters for a removal decision: shared transitive
 * packages do not disappear when you drop one of their dependants.
 */
function closures(rootDeps, graph) {
  const reach = (start) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop();
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const next of graph.get(cur) ?? []) stack.push(next);
    }
    seen.delete(start);
    return seen;
  };

  const per = new Map(rootDeps.map((d) => [d, reach(d)]));
  const owners = new Map();
  for (const [dep, set] of per) {
    for (const t of set) owners.set(t, (owners.get(t) ?? 0) + 1);
  }
  return { per, owners };
}

const packages = findPackages(ROOT).map((dir) => {
  const rel = path.relative(ROOT, dir) || '.';
  const pkg = readJson(path.join(dir, 'package.json')) ?? {};
  const locks = LOCKFILES.filter((l) => existsSync(path.join(dir, l)));
  const tsconfig = readJson(path.join(dir, 'tsconfig.json'));
  const aliases = tsconfig?.compilerOptions?.paths ?? {};

  const nm = path.join(dir, 'node_modules');
  const installed = installedPackages(nm);

  // Manifest graph over what is actually installed: manager-agnostic, and it reads
  // only package.json files rather than trying to parse four lockfile formats.
  const graph = new Map();
  const sizes = new Map();
  for (const [name, at] of installed) {
    const meta = readJson(path.join(at, 'package.json')) ?? {};
    graph.set(name, Object.keys(meta.dependencies ?? {}).filter((d) => installed.has(d)));
    sizes.set(name, dirSize(at));
  }

  const declared = Object.keys(pkg.dependencies ?? {});
  const declaredDev = Object.keys(pkg.devDependencies ?? {});
  const { per, owners } = closures([...declared, ...declaredDev].filter((d) => installed.has(d)), graph);

  const weigh = (dep) => {
    const set = per.get(dep) ?? new Set();
    const own = sizes.get(dep) ?? 0;
    let transitive = 0;
    let exclusive = 0;
    for (const t of set) {
      transitive += sizes.get(t) ?? 0;
      if ((owners.get(t) ?? 0) === 1) exclusive += sizes.get(t) ?? 0;
    }
    return {
      name: dep,
      kind: declared.includes(dep) ? 'prod' : 'dev',
      version: (pkg.dependencies ?? pkg.devDependencies ?? {})[dep] ?? null,
      ownBytes: own,
      transitiveBytes: transitive,
      totalBytes: own + transitive,
      exclusiveBytes: own + exclusive,
      transitiveCount: set.size,
    };
  };

  return {
    path: rel,
    name: pkg.name ?? rel,
    version: pkg.version ?? null,
    private: pkg.private ?? false,
    managers: locks.map((l) => MANAGER[l]),
    lockfiles: locks,
    lockfileConflict: locks.length > 1,
    declaredCounts: { prod: declared.length, dev: declaredDev.length },
    installedCount: installed.size,
    installedBytes: existsSync(nm) ? dirSize(nm) : 0,
    aliases,
    dependencies: [...declared, ...declaredDev]
      .filter((d) => installed.has(d))
      .map(weigh)
      .sort((a, b) => b.totalBytes - a.totalBytes),
    notInstalled: [...declared, ...declaredDev].filter((d) => !installed.has(d)),
  };
});

/** Internal edges come from tsconfig path aliases, not from dependencies. */
const internalEdges = [];
for (const p of packages) {
  for (const [alias, targets] of Object.entries(p.aliases)) {
    for (const t of targets) {
      const resolved = path.relative(ROOT, path.resolve(ROOT, p.path, t));
      const owner = packages
        .filter((q) => q.path !== '.' && resolved.startsWith(`${q.path}/`))
        .sort((a, b) => b.path.length - a.path.length)[0];
      // The alias makes it compile; a manifest entry is what makes it resolve at
      // runtime. An alias whose package name is declared nowhere emits an import
      // specifier that exists in no node_modules.
      const pkgName = alias.replace(/\/\*$/, '');
      const manifest = readJson(path.join(ROOT, p.path === '.' ? '.' : p.path, 'package.json')) ?? {};
      const declared =
        pkgName in (manifest.dependencies ?? {}) ||
        pkgName in (manifest.devDependencies ?? {}) ||
        pkgName in (manifest.peerDependencies ?? {}) ||
        pkgName.startsWith('.') ||
        pkgName === '@/*' ||
        pkgName === '@';

      internalEdges.push({
        from: p.path,
        alias,
        aliasPackage: pkgName,
        target: resolved,
        toPackage: owner ? owner.path : null,
        crossesPackage: Boolean(owner && owner.path !== p.path),
        intoSource: /\/src\//.test(resolved),
        declaredInManifest: declared,
      });
    }
  }
}

/** Same alias specifier resolving to different files = more than one copy in play. */
const aliasTargets = new Map();
for (const e of internalEdges) {
  if (!aliasTargets.has(e.alias)) aliasTargets.set(e.alias, new Set());
  aliasTargets.get(e.alias).add(e.target);
}
const duplicatedAliases = [...aliasTargets]
  .filter(([, set]) => set.size > 1)
  .map(([alias, set]) => ({ alias, targets: [...set] }));

/** Aliases that compile but resolve to nothing at runtime. */
const undeclaredAliases = internalEdges
  .filter((e) => !e.declaredInManifest && !e.alias.startsWith('@/'))
  .map((e) => ({ from: e.from, alias: e.alias, target: e.target }));

const out = {
  root: ROOT,
  undeclaredAliases,
  generatedBy: 'dependency-checker/scripts/scan.mjs',
  totals: {
    packages: packages.length,
    installedBytes: packages.reduce((s, p) => s + p.installedBytes, 0),
    managers: [...new Set(packages.flatMap((p) => p.managers))],
  },
  packages,
  internalEdges,
  duplicatedAliases,
};

const jsonFlag = process.argv.indexOf('--json');
const text = JSON.stringify(out, null, 2);
if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.argv[jsonFlag + 1], `${text}\n`);
  process.stderr.write(`wrote ${process.argv[jsonFlag + 1]}\n`);
} else {
  process.stdout.write(`${text}\n`);
}
