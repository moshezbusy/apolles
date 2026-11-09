// Used only inside the Docker build (see Dockerfile). Copies the named packages, and every
// package they depend on, out of the pnpm-installed node_modules into <out>/node_modules,
// keeping pnpm's layout (node_modules/.pnpm/<id>/node_modules/<name> plus relative symlinks).
// The runtime image needs this for the two things the Next standalone server does not
// cover: the Prisma CLI (migrations on start, `prisma db seed`) and the packages the seed
// script imports. Everything else in node_modules (dev tools, build tools) stays out.
//
//   node deploy/staging/collect-node-modules.mjs /out prisma @prisma/client zod
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

const [out, ...packages] = process.argv.slice(2);
if (!out || packages.length === 0) {
  console.error("usage: collect-node-modules.mjs <out-dir> <package>...");
  process.exit(2);
}

const root = realpathSync("node_modules");
const store = join(root, ".pnpm");

// .../node_modules/.pnpm/<id>/node_modules/<name> → <id>
function storeId(path) {
  const rel = relative(store, realpathSync(path));
  if (rel.startsWith("..")) throw new Error(`${path} is not inside node_modules/.pnpm`);
  return rel.split(sep)[0];
}

// The entries of .pnpm/<id>/node_modules: the package itself and symlinks to its dependencies.
function dependencyLinks(id) {
  const dir = join(store, id, "node_modules");
  const links = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const names = name.startsWith("@") ? readdirSync(join(dir, name)).map((n) => join(name, n)) : [name];
    for (const entry of names) {
      const path = join(dir, entry);
      // Optional dependencies for other platforms are not installed: their links dangle.
      if (lstatSync(path).isSymbolicLink() && existsSync(path)) links.push(path);
    }
  }
  return links;
}

const seen = new Set();
const queue = packages.map((name) => storeId(join(root, name)));
while (queue.length > 0) {
  const id = queue.pop();
  if (seen.has(id)) continue;
  seen.add(id);
  for (const link of dependencyLinks(id)) queue.push(storeId(link));
}

for (const id of seen) {
  cpSync(join(store, id), join(out, "node_modules", ".pnpm", id), {
    recursive: true,
    verbatimSymlinks: true,
  });
}

// Top-level entries (node_modules/<name>), so `require("<name>")` works from the app root.
for (const name of packages) {
  const target = join(out, "node_modules", ".pnpm", storeId(join(root, name)), "node_modules", name);
  const link = join(out, "node_modules", name);
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(relative(dirname(link), target), link);
}

console.info(`Copied ${packages.length} packages and their dependencies (${seen.size} in all).`);
