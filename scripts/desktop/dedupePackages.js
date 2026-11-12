// An esbuild plugin that bundles one copy of a package that npm installed more than once at the same version.
// npm nests a second copy when two dependents want different ranges of something; mime-db 1.54.0 sits under accepts, express, send and
// type-is, so the sidecar carried its 146 KiB db.json four times (gzip cannot merge them: its window is 32 KiB). Same name and same version
// is the same published files, so the first copy resolved stands in for the rest. Only the packages named in `DEDUPED_PACKAGES` are touched.
// The same files can still resolve their own requires differently (a copy of mime-types whose mime-db is ^1.54.0 and one whose mime-db is
// another version), so the build checks it: when a second copy of a listed package would be folded into the first, every listed package
// either copy depends on must resolve to the same version from both places, else the build fails and names the packages and versions.
// A different version of the same package is never merged.
import fs from 'node:fs';
import path from 'node:path';

/** Packages the sidecar bundle may fold to one copy per version. */
export const DEDUPED_PACKAGES = ['mime-db', 'mime-types', 'content-type'];

/**
 * The package a file inside node_modules belongs to: its name, version and folder, read from the nearest package.json that names it.
 * @param {string} file absolute path of a resolved file
 * @param {string} name the package name the import used
 * @returns {{ version: string, dir: string } | null}
 */
export function owningPackage(file, name) {
  let dir = path.dirname(file);
  for (;;) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
        if (pkg.name === name && typeof pkg.version === 'string') return { version: pkg.version, dir };
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The version of each listed package a package folder depends on, as the install resolves it from that folder (nearest node_modules up the tree).
 * @param {string} dir the package folder
 * @param {readonly string[]} packages
 * @returns {Record<string, string | null>} dependency name to resolved version (null when it does not resolve)
 */
export function listedDependencyVersions(dir, packages) {
  let deps;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
  } catch {
    return {};
  }
  const out = {};
  for (const dep of Object.keys(deps).filter((n) => packages.includes(n)).sort()) {
    out[dep] = null;
    for (let at = dir; ; at = path.dirname(at)) {
      const manifest = path.join(at, 'node_modules', dep, 'package.json');
      if (fs.existsSync(manifest)) {
        try {
          out[dep] = JSON.parse(fs.readFileSync(manifest, 'utf8')).version ?? null;
        } catch {
          out[dep] = null;
        }
        break;
      }
      if (path.dirname(at) === at) break;
    }
  }
  return out;
}

/**
 * @param {{ packages?: readonly string[] }} [options]
 * @returns {import('esbuild').Plugin}
 */
export function dedupePackagesPlugin({ packages = DEDUPED_PACKAGES } = {}) {
  return {
    name: 'dedupe-packages',
    setup(build) {
      const names = packages.map((n) => n.replace(/[^A-Za-z0-9_]/g, '\\$&')).join('|');
      const canonical = new Map();
      const folders = new Map();
      build.onResolve({ filter: new RegExp(`^(${names})(/|$)`) }, async (args) => {
        if (args.pluginData?.dedupe) return undefined;
        const name = packages.find((n) => args.path === n || args.path.startsWith(`${n}/`));
        const result = await build.resolve(args.path, {
          importer: args.importer,
          namespace: args.namespace,
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { dedupe: true },
        });
        if (result.errors.length > 0 || result.external || !result.path.includes(`${path.sep}node_modules${path.sep}`)) return result;
        const owner = owningPackage(result.path, name);
        if (!owner) return result;
        const key = `${name}@${owner.version}:${path.relative(owner.dir, result.path)}`;
        if (!canonical.has(key)) canonical.set(key, result.path);
        const copy = `${name}@${owner.version}`;
        if (!folders.has(copy)) folders.set(copy, { dir: owner.dir, deps: listedDependencyVersions(owner.dir, packages) });
        const first = folders.get(copy);
        if (first.dir !== owner.dir) {
          const here = listedDependencyVersions(owner.dir, packages);
          for (const dep of new Set([...Object.keys(first.deps), ...Object.keys(here)])) {
            if ((first.deps[dep] ?? null) !== (here[dep] ?? null)) {
              return { errors: [{ text: `dedupe-packages: two copies of ${copy} (${first.dir} and ${owner.dir}) would resolve different versions of ${dep} (${first.deps[dep] ?? 'none'} and ${here[dep] ?? 'none'}); folding them would change what one of them requires. Remove ${name} from DEDUPED_PACKAGES or make the install resolve one ${dep}.` }] };
            }
          }
        }
        return { ...result, path: canonical.get(key) };
      });
    },
  };
}
