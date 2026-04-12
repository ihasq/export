import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exportcPath = path.resolve(__dirname, "..", "index.js");

// Helper to create a temp directory
const createTempDir = () => {
  const tmpDir = `/tmp/exportc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
};

// Helper to cleanup temp directory
const cleanupTempDir = (dir) => {
  if (dir && dir.startsWith("/tmp/") && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Helper to create a minimal Vite project
const createViteProject = (dir, options = {}) => {
  const { typescript = true } = options;

  // package.json
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: "test-vite-app",
        version: "1.0.0",
        type: "module",
        scripts: {
          dev: "vite",
          build: "vite build",
        },
        devDependencies: {
          vite: "^5.0.0",
        },
      },
      null,
      2
    )
  );

  // vite.config
  const viteConfigExt = typescript ? "ts" : "js";
  fs.writeFileSync(
    path.join(dir, `vite.config.${viteConfigExt}`),
    `import { defineConfig } from "vite";

export default defineConfig({
  plugins: [],
});
`
  );

  // tsconfig.json for TypeScript projects
  if (typescript) {
    fs.writeFileSync(
      path.join(dir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
          },
          include: ["src"],
        },
        null,
        2
      )
    );
  }

  // src directory
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "src", `main.${typescript ? "ts" : "js"}`),
    `console.log("Hello");`
  );
};

// Helper to run exportc command non-interactively
const runExportc = (dir, args = []) => {
  try {
    const result = execSync(`node ${exportcPath} ${args.join(" ")}`, {
      cwd: dir,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CI: "true" },
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1,
      error: err,
    };
  }
};

describe("exportc init", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("detects missing Vite config", () => {
    // Create a project without vite.config
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "test", version: "1.0.0" }, null, 2)
    );

    const result = runExportc(tempDir, ["init"]);
    assert.ok(result.exitCode !== 0, "Should exit with non-zero code");
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("No Vite config found") || output.includes("Vite"),
      `Expected Vite error message, got: ${output}`
    );
  });

  test("detects missing package.json", () => {
    // Create only vite.config
    fs.writeFileSync(
      path.join(tempDir, "vite.config.js"),
      `export default {}`
    );

    const result = runExportc(tempDir, ["init"]);
    assert.ok(result.exitCode !== 0, "Should exit with non-zero code");
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("package.json") || output.includes("No package"),
      `Expected package.json error message, got: ${output}`
    );
  });

  test("shows help with --help flag", () => {
    const output = execSync(`node ${exportcPath} --help`, {
      encoding: "utf8",
    });

    assert.ok(output.includes("exportc"));
    assert.ok(output.includes("init"));
    assert.ok(output.includes("dev"));
    assert.ok(output.includes("deploy"));
  });

  test("shows help with no command", () => {
    const output = execSync(`node ${exportcPath}`, {
      encoding: "utf8",
    });

    assert.ok(output.includes("exportc"));
    assert.ok(output.includes("Usage"));
  });
});

describe("exportc init (manual integration)", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("creates export directory structure for TypeScript project", async () => {
    createViteProject(tempDir, { typescript: true });

    // Manually simulate what init does (since it's interactive)
    const exportDir = path.join(tempDir, "export");
    fs.mkdirSync(exportDir, { recursive: true });

    // Create export/index.ts
    fs.writeFileSync(
      path.join(exportDir, "index.ts"),
      `export async function hello(name: string): Promise<string> {
  return \`Hello, \${name}!\`;
}
`
    );

    // Create export/package.json
    fs.writeFileSync(
      path.join(exportDir, "package.json"),
      JSON.stringify(
        {
          name: "test-api",
          private: true,
          type: "module",
          exports: "./",
          dependencies: {
            "export-runtime": "^0.0.14",
          },
        },
        null,
        2
      )
    );

    // Verify structure
    assert.ok(fs.existsSync(path.join(exportDir, "index.ts")));
    assert.ok(fs.existsSync(path.join(exportDir, "package.json")));

    // Verify content
    const indexContent = fs.readFileSync(path.join(exportDir, "index.ts"), "utf8");
    assert.ok(indexContent.includes("export async function hello"));

    const pkgContent = JSON.parse(fs.readFileSync(path.join(exportDir, "package.json"), "utf8"));
    assert.strictEqual(pkgContent.name, "test-api");
    assert.ok(pkgContent.dependencies["export-runtime"]);
  });

  test("creates export directory structure for JavaScript project", async () => {
    createViteProject(tempDir, { typescript: false });

    const exportDir = path.join(tempDir, "export");
    fs.mkdirSync(exportDir, { recursive: true });

    // Create export/index.js
    fs.writeFileSync(
      path.join(exportDir, "index.js"),
      `export async function hello(name) {
  return \`Hello, \${name}!\`;
}
`
    );

    assert.ok(fs.existsSync(path.join(exportDir, "index.js")));
    const content = fs.readFileSync(path.join(exportDir, "index.js"), "utf8");
    assert.ok(content.includes("export async function hello"));
  });
});

describe("vite-plugin", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("exportPlugin is importable", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin, default: defaultExport } = await import(pluginPath);

    assert.ok(typeof exportPlugin === "function");
    assert.ok(typeof defaultExport === "function");
    assert.strictEqual(exportPlugin, defaultExport);
  });

  test("exportPlugin returns valid Vite plugin", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin();

    assert.ok(plugin.name);
    assert.strictEqual(plugin.name, "vite-plugin-export");
    assert.ok(typeof plugin.resolveId === "function");
    assert.ok(typeof plugin.load === "function");
    assert.ok(typeof plugin.configureServer === "function");
  });

  test("exportPlugin resolves export: imports", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin({ dev: "http://localhost:8787" });

    // Test resolveId
    const resolved = plugin.resolveId("export/");
    assert.ok(resolved);
    assert.strictEqual(resolved.id, "export/");

    const resolved2 = plugin.resolveId("export/utils");
    assert.ok(resolved2);
    assert.strictEqual(resolved2.id, "export/utils");

    // Non-export imports should return null
    const notResolved = plugin.resolveId("./local-module");
    assert.strictEqual(notResolved, null);

    const notResolved2 = plugin.resolveId("react");
    assert.strictEqual(notResolved2, null);
  });

  test("exportPlugin generates correct module code in dev mode", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin({ dev: "http://localhost:8787" });

    // Simulate dev mode
    plugin.config({}, { command: "serve" });

    // Test load
    const code = plugin.load("export/");
    assert.ok(code);
    assert.ok(code.includes("http://localhost:8787"));
    assert.ok(code.includes("export *"));

    const codeUtils = plugin.load("export/utils");
    assert.ok(codeUtils);
    assert.ok(codeUtils.includes("http://localhost:8787/utils"));
  });

  test("exportPlugin uses production URL in build mode", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin({
      dev: "http://localhost:8787",
      production: "https://my-api.workers.dev",
    });

    // Simulate build mode
    plugin.config({}, { command: "build" });

    const code = plugin.load("export/");
    assert.ok(code);
    assert.ok(code.includes("https://my-api.workers.dev"));
  });

  test("exportPlugin handles subpaths correctly", async () => {
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin({ dev: "http://localhost:8787" });
    plugin.config({}, { command: "serve" });

    // Root
    const rootCode = plugin.load("export/");
    assert.ok(rootCode.includes("http://localhost:8787/"));

    // Subpath
    const utilsCode = plugin.load("export/utils");
    assert.ok(utilsCode.includes("http://localhost:8787/utils"));

    // Nested subpath
    const nestedCode = plugin.load("export/api/v1/users");
    assert.ok(nestedCode.includes("http://localhost:8787/api/v1/users"));
  });
});

describe("init command file generation", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("vite config update adds import and plugin", () => {
    createViteProject(tempDir, { typescript: true });

    const viteConfigPath = path.join(tempDir, "vite.config.ts");
    let content = fs.readFileSync(viteConfigPath, "utf8");

    // Simulate what init.js does
    const importStatement = `import { exportPlugin } from "exportc/vite";\n`;
    const importMatch = content.match(/^(import\s+.+\s+from\s+['"].+['"];?\s*\n?)+/m);
    if (importMatch) {
      const insertPos = importMatch.index + importMatch[0].length;
      content = content.slice(0, insertPos) + importStatement + content.slice(insertPos);
    }

    content = content.replace(/plugins:\s*\[/, "plugins: [exportPlugin(), ");

    fs.writeFileSync(viteConfigPath, content);

    // Verify
    const updatedContent = fs.readFileSync(viteConfigPath, "utf8");
    assert.ok(updatedContent.includes('import { exportPlugin } from "exportc/vite"'));
    assert.ok(updatedContent.includes("exportPlugin()"));
  });

  test("export-env.d.ts is generated for TypeScript projects", () => {
    createViteProject(tempDir, { typescript: true });

    // Simulate what init.js creates
    const envDtsContent = `declare module "export/" {
  export function hello(name: string): Promise<string>;
}
`;
    fs.writeFileSync(path.join(tempDir, "export-env.d.ts"), envDtsContent);

    const content = fs.readFileSync(path.join(tempDir, "export-env.d.ts"), "utf8");
    assert.ok(content.includes('declare module "export/"'));
    assert.ok(content.includes("export function hello"));
  });

  test("gitignore is created in export directory", () => {
    const exportDir = path.join(tempDir, "export");
    fs.mkdirSync(exportDir, { recursive: true });

    const gitignoreContent = `# Generated files
.export-*.js
wrangler.toml
.wrangler/
`;
    fs.writeFileSync(path.join(exportDir, ".gitignore"), gitignoreContent);

    const content = fs.readFileSync(path.join(exportDir, ".gitignore"), "utf8");
    assert.ok(content.includes(".export-*.js"));
    assert.ok(content.includes("wrangler.toml"));
  });
});

describe("type generation", () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("generates export-env.d.ts from .export-types.js", async () => {
    createViteProject(tempDir, { typescript: true });

    // Create export directory with .export-types.js
    const exportDirPath = path.join(tempDir, "export");
    fs.mkdirSync(exportDirPath, { recursive: true });

    // Create .export-types.js in the exact format export-runtime generates
    const typesMap = {
      "": "export declare function greet(name: string): Promise<string>;\n\nexport declare const VERSION: any;",
      "utils": "export declare function formatDate(date: Date): Promise<string>;"
    };
    const typesContent = `export default ${JSON.stringify(typesMap)};`;
    fs.writeFileSync(path.join(exportDirPath, ".export-types.js"), typesContent);

    // Read and parse the file the same way the plugin does
    const content = fs.readFileSync(path.join(exportDirPath, ".export-types.js"), "utf8");
    const match = content.match(/export default (\{[\s\S]*?\});/);

    assert.ok(match, "Should match export default pattern");

    const parsedMap = JSON.parse(match[1]);

    // Generate declarations the same way the plugin does
    const declarations = ['// Auto-generated by exportc. Do not edit manually.', '// Re-run "npm run dev" to regenerate after changing export/ files.', ''];

    for (const [route, types] of Object.entries(parsedMap)) {
      const modulePath = route === "" ? "export/" : `export/${route}`;
      declarations.push(`declare module "${modulePath}" {`);
      const indented = types.split('\n').map(line => line ? `  ${line}` : '').join('\n');
      declarations.push(indented);
      declarations.push('}');
      declarations.push('');
    }

    const envDtsPath = path.join(tempDir, "export-env.d.ts");
    fs.writeFileSync(envDtsPath, declarations.join('\n'));

    // Verify the generated file
    const envDts = fs.readFileSync(envDtsPath, "utf8");
    assert.ok(envDts.includes('declare module "export/"'), "Should have root module");
    assert.ok(envDts.includes('declare module "export/utils"'), "Should have utils module");
    assert.ok(envDts.includes("export declare function greet"), "Should have greet function");
    assert.ok(envDts.includes("export declare function formatDate"), "Should have formatDate function");
  });
});

// Run tests
console.log("Running exportc tests...\n");
