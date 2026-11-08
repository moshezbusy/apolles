// Lets plain Node (22.18+, which strips TypeScript types itself) run prisma/seed.ts with
// the app's import style: "@/..." means src/..., and imports may omit the .ts extension.
// Used by `pnpm db:seed` / `prisma db seed` and by the e2e global setup
// (e2e/support/reset-and-seed.ts); no extra package needed.
import { statSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const SRC = new URL("../src/", import.meta.url);
const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

function isFile(url) {
  try {
    return statSync(fileURLToPath(url)).isFile();
  } catch {
    return false;
  }
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    let base;
    if (specifier.startsWith("@/")) base = new URL(specifier.slice(2), SRC);
    else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
      base = new URL(specifier, context.parentURL);
    }
    if (base) {
      for (const extension of EXTENSIONS) {
        const candidate = new URL(base.href + extension);
        if (isFile(candidate)) return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
