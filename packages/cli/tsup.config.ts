import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  clean: true,
  // src/index.ts already starts with a "#!/usr/bin/env node" shebang; esbuild preserves it.
  // If the build output does NOT start with the shebang, uncomment the banner below and
  // remove the shebang line from src/index.ts to avoid a double shebang.
  // banner: { js: "#!/usr/bin/env node" },
});
