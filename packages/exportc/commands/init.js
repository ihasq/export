import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export async function init(argv) {
  const cwd = process.cwd();

  console.log(pc.cyan("exportc init"));
  console.log();

  // Check for Vite project
  const viteConfigFiles = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];
  const viteConfig = viteConfigFiles.find((f) => fs.existsSync(path.join(cwd, f)));

  if (!viteConfig) {
    console.error(pc.red("✗") + " No Vite config found. exportc only supports Vite projects.");
    process.exit(1);
  }

  // Check for package.json
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    console.error(pc.red("✗") + " No package.json found.");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // Auto-generate worker name from package name
  const workerName = argv.name || (pkg.name ? `${pkg.name}-api` : "my-api");

  // Check for TypeScript
  const isTypeScript = viteConfig.endsWith(".ts") || viteConfig.endsWith(".mts") ||
    fs.existsSync(path.join(cwd, "tsconfig.json"));

  const exportDir = path.join(cwd, "export");
  const ext = isTypeScript ? "ts" : "js";

  // Create export directory
  console.log(pc.gray("Creating export directory..."));
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  // Create export/index.ts or index.js
  const indexPath = path.join(exportDir, `index.${ext}`);
  if (!fs.existsSync(indexPath)) {
    const template = isTypeScript
      ? `// Server-side exports - import from "export/" in your client code

export async function hello(name: string): Promise<string> {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export class Counter {
  private count: number;

  constructor(initial: number = 0) {
    this.count = initial;
  }

  increment(): number {
    return ++this.count;
  }

  getCount(): number {
    return this.count;
  }
}
`
      : `// Server-side exports - import from "export/" in your client code

export async function hello(name) {
  return \`Hello, \${name}!\`;
}

export function add(a, b) {
  return a + b;
}

export class Counter {
  #count;

  constructor(initial = 0) {
    this.#count = initial;
  }

  increment() {
    return ++this.#count;
  }

  getCount() {
    return this.#count;
  }
}
`;
    fs.writeFileSync(indexPath, template);
  }

  // Detect Vite build output directory
  let viteBuildOutDir = "dist";
  const viteConfigPath = path.join(cwd, viteConfig);
  let viteConfigContent = fs.readFileSync(viteConfigPath, "utf8");
  const outDirMatch = viteConfigContent.match(/outDir:\s*['"]([^'"]+)['"]/);
  if (outDirMatch) {
    viteBuildOutDir = outDirMatch[1];
  }

  // Create export/package.json
  const exportPkgPath = path.join(exportDir, "package.json");
  const exportPkg = {
    name: workerName,
    private: true,
    type: "module",
    exports: "./",
    main: `../${viteBuildOutDir}`,
    scripts: {
      dev: "generate-export-types && wrangler dev",
      deploy: "generate-export-types && wrangler deploy",
    },
    dependencies: {
      "export-runtime": "^0.0.16",
    },
    devDependencies: {
      wrangler: "^4.0.0",
    },
  };

  if (isTypeScript) {
    exportPkg.devDependencies["@cloudflare/workers-types"] = "^4.20241127.0";
  }

  fs.writeFileSync(exportPkgPath, JSON.stringify(exportPkg, null, 2) + "\n");

  // Update main package.json
  pkg.scripts = pkg.scripts || {};
  if (!pkg.scripts["export"]) {
    pkg.scripts["export"] = "vite build && cd export && npm run deploy";
  }

  pkg.devDependencies = pkg.devDependencies || {};
  if (!pkg.devDependencies.exportc) {
    pkg.devDependencies.exportc = "latest";
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // Update vite.config
  if (!viteConfigContent.includes("exportc/vite")) {
    const importStatement = `import { exportPlugin } from "exportc/vite";\n`;

    const importMatch = viteConfigContent.match(/^(import\s+.+\s+from\s+['"].+['"];?\s*\n?)+/m);
    if (importMatch) {
      const insertPos = importMatch.index + importMatch[0].length;
      viteConfigContent =
        viteConfigContent.slice(0, insertPos) +
        importStatement +
        viteConfigContent.slice(insertPos);
    } else {
      viteConfigContent = importStatement + viteConfigContent;
    }

    if (viteConfigContent.includes("plugins:")) {
      viteConfigContent = viteConfigContent.replace(
        /plugins:\s*\[/,
        "plugins: [exportPlugin(), "
      );
    } else {
      viteConfigContent = viteConfigContent.replace(
        /defineConfig\(\s*\{/,
        "defineConfig({\n  plugins: [exportPlugin()],"
      );
    }

    fs.writeFileSync(viteConfigPath, viteConfigContent);
  }

  // Create .gitignore
  const exportGitignorePath = path.join(exportDir, ".gitignore");
  const gitignoreContent = `# Generated files
.export-*.js
.export-*.d.ts
export.d.ts
wrangler.toml
.wrangler/
.dev.vars
`;
  fs.writeFileSync(exportGitignorePath, gitignoreContent);

  // Create export-env.d.ts for TypeScript
  if (isTypeScript) {
    const envDtsPath = path.join(cwd, "export-env.d.ts");
    if (!fs.existsSync(envDtsPath)) {
      const envDtsContent = `// Auto-generated by exportc - types are updated when you run npm run dev

declare module "export/" {
  export function hello(name: string): Promise<string>;
  export function add(a: number, b: number): Promise<number>;
  export class Counter {
    constructor(initial?: number);
    increment(): Promise<number>;
    getCount(): Promise<number>;
    [Symbol.dispose](): Promise<void>;
  }
}
`;
      fs.writeFileSync(envDtsPath, envDtsContent);
    }

    // Update tsconfig
    const tsconfigAppPath = path.join(cwd, "tsconfig.app.json");
    const tsconfigPath = path.join(cwd, "tsconfig.json");
    const targetTsconfig = fs.existsSync(tsconfigAppPath) ? tsconfigAppPath : tsconfigPath;

    if (fs.existsSync(targetTsconfig)) {
      try {
        const tsconfigContent = fs.readFileSync(targetTsconfig, "utf8");
        const tsconfig = JSON.parse(tsconfigContent);
        tsconfig.include = tsconfig.include || [];
        if (!tsconfig.include.includes("export-env.d.ts")) {
          tsconfig.include.push("export-env.d.ts");
          fs.writeFileSync(targetTsconfig, JSON.stringify(tsconfig, null, 2) + "\n");
        }
      } catch {
        // Ignore JSON parse errors
      }
    }
  }

  console.log(pc.green("✓") + " Created export/");

  // Install dependencies in export/
  console.log(pc.gray("Installing export dependencies..."));
  try {
    execSync("npm install", { cwd: exportDir, stdio: "inherit" });
    console.log(pc.green("✓") + " Installed export dependencies");
  } catch (err) {
    console.log(pc.yellow("!") + " Failed to install export dependencies");
    if (err.message) console.log(pc.gray(err.message));
  }

  // Install exportc in main project
  console.log(pc.gray("Installing exportc..."));
  try {
    execSync("npm install", { cwd, stdio: "inherit", encoding: "utf8" });
    console.log(pc.green("✓") + " Installed exportc");
  } catch (err) {
    console.log(pc.yellow("!") + " Failed to install exportc");
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.log(pc.red(err.stderr));
    console.log(pc.gray("Run 'npm install' manually to see the full error."));
  }

  // Done
  console.log();
  console.log(pc.green("Done!") + " Run " + pc.cyan("npm run dev") + " to start.");
  console.log();
  console.log(pc.gray("  import { hello } from \"export/\";"));
  console.log(pc.gray("  await hello(\"World\");"));
}
