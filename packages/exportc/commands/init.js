import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function init(argv) {
  const cwd = process.cwd();

  p.intro(pc.bgCyan(pc.black(" exportc init ")));

  // Check for Vite project
  const viteConfigFiles = ["vite.config.ts", "vite.config.js", "vite.config.mts", "vite.config.mjs"];
  const viteConfig = viteConfigFiles.find((f) => fs.existsSync(path.join(cwd, f)));

  if (!viteConfig) {
    p.cancel("No Vite config found. exportc currently only supports Vite projects.");
    process.exit(1);
  }

  // Check for package.json
  const pkgPath = path.join(cwd, "package.json");
  if (!fs.existsSync(pkgPath)) {
    p.cancel("No package.json found.");
    process.exit(1);
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));

  // Check if already initialized
  const exportDir = path.join(cwd, "export");
  if (fs.existsSync(exportDir)) {
    const overwrite = await p.confirm({
      message: "export/ directory already exists. Continue and overwrite?",
      initialValue: false,
    });
    if (p.isCancel(overwrite) || !overwrite) {
      p.cancel("Operation cancelled.");
      process.exit(0);
    }
  }

  // Get worker name
  const workerName = await p.text({
    message: "Worker name:",
    placeholder: pkg.name ? `${pkg.name}-api` : "my-api",
    defaultValue: pkg.name ? `${pkg.name}-api` : "my-api",
    validate: (v) => {
      if (!v) return "Worker name is required";
      if (!/^[a-z0-9-]+$/.test(v)) return "Use lowercase letters, numbers, and hyphens only";
    },
  });

  if (p.isCancel(workerName)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  // Check for TypeScript
  const isTypeScript = viteConfig.endsWith(".ts") || viteConfig.endsWith(".mts") ||
    fs.existsSync(path.join(cwd, "tsconfig.json"));

  const s = p.spinner();
  s.start("Initializing export...");

  // Create export directory
  if (!fs.existsSync(exportDir)) {
    fs.mkdirSync(exportDir, { recursive: true });
  }

  // Create export/index.ts or index.js
  const ext = isTypeScript ? "ts" : "js";
  const indexPath = path.join(exportDir, `index.${ext}`);
  if (!fs.existsSync(indexPath)) {
    const template = isTypeScript
      ? `// Server-side exports - these will be available to your client code
// Import from "export/" in your client code

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
      : `// Server-side exports - these will be available to your client code
// Import from "export/" in your client code

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

  // Detect Vite build output directory from vite.config
  let viteBuildOutDir = "dist"; // default
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
    main: `../${viteBuildOutDir}`, // Static assets from Vite build
    scripts: {
      dev: "generate-export-types && wrangler dev",
      deploy: "generate-export-types && wrangler deploy",
    },
    dependencies: {
      "export-runtime": "^0.0.14",
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

  // Add export script: build + deploy as Workers Sites
  if (!pkg.scripts["export"]) {
    pkg.scripts["export"] = "vite build && cd export && npm run deploy";
  }

  // Add exportc to devDependencies
  pkg.devDependencies = pkg.devDependencies || {};
  if (!pkg.devDependencies.exportc) {
    pkg.devDependencies.exportc = "^0.0.2";
  }

  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  // Update vite.config

  // Check if export plugin is already added
  if (!viteConfigContent.includes("exportc/vite")) {
    // Add import at the top
    const importStatement = `import { exportPlugin } from "exportc/vite";\n`;

    // Find the first import or the start of the file
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

    // Add plugin to defineConfig
    // Look for plugins array
    if (viteConfigContent.includes("plugins:")) {
      // Add to existing plugins array
      viteConfigContent = viteConfigContent.replace(
        /plugins:\s*\[/,
        "plugins: [exportPlugin(), "
      );
    } else {
      // Add plugins array to defineConfig
      viteConfigContent = viteConfigContent.replace(
        /defineConfig\(\s*\{/,
        "defineConfig({\n  plugins: [exportPlugin()],"
      );
    }

    fs.writeFileSync(viteConfigPath, viteConfigContent);
  }

  // Create .gitignore entries for export directory
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

  // Create export-env.d.ts in main project for TypeScript support
  if (isTypeScript) {
    const envDtsPath = path.join(cwd, "export-env.d.ts");
    if (!fs.existsSync(envDtsPath)) {
      const envDtsContent = `// Type declarations for export/ imports
// This file is auto-generated by exportc. You can modify it to add custom types.

// Re-export types from your export directory
// Update this when you add new exports

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

// Add more module declarations for subpaths:
// declare module "export/utils" {
//   export function myUtil(): Promise<void>;
// }
`;
      fs.writeFileSync(envDtsPath, envDtsContent);
    }

    // Update tsconfig.json to include the type declarations
    const tsconfigPath = path.join(cwd, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      try {
        const tsconfigContent = fs.readFileSync(tsconfigPath, "utf8");
        const tsconfig = JSON.parse(tsconfigContent);

        // Add export-env.d.ts to include if not already present
        tsconfig.include = tsconfig.include || [];
        if (!tsconfig.include.includes("export-env.d.ts")) {
          tsconfig.include.push("export-env.d.ts");
          fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + "\n");
        }
      } catch {
        // Ignore JSON parse errors (might have comments)
      }
    }
  }

  s.stop("Export initialized!");

  const filesCreated = isTypeScript
    ? `${pc.cyan("export/")}
├── index.${ext}        ${pc.dim("# Your server exports")}
├── package.json    ${pc.dim("# Worker configuration")}
└── .gitignore

${pc.cyan("export-env.d.ts")}     ${pc.dim("# Type declarations for export/ imports")}`
    : `${pc.cyan("export/")}
├── index.${ext}        ${pc.dim("# Your server exports")}
├── package.json    ${pc.dim("# Worker configuration")}
└── .gitignore`;

  p.note(
    `${filesCreated}

${pc.bold("Next steps:")}

1. Install export dependencies:
   ${pc.cyan("cd export && npm install && cd ..")}

2. Start development (Vite + Wrangler auto-start):
   ${pc.cyan("npm run dev")}

3. Import in your client code:
   ${pc.cyan(`import { hello } from "export/";`)}
   ${pc.cyan(`const message = await hello("World");`)}

4. Deploy to Cloudflare Workers Sites:
   ${pc.cyan("npm run export")}
   ${pc.dim("# Builds Vite + deploys everything to Workers")}`,
    "Created"
  );

  p.outro(`Run ${pc.cyan("cd export && npm install")} to get started!`);
}
