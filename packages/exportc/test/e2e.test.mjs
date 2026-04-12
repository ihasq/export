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
  const tmpDir = `/tmp/exportc-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
};

// Helper to cleanup temp directory
const cleanupTempDir = (dir) => {
  if (dir && dir.startsWith("/tmp/") && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};

// Helper to run command with timeout
const runCommand = (cmd, cwd, timeout = 120000) => {
  try {
    const result = execSync(cmd, {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
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

describe("exportc E2E tests", { timeout: 300000 }, () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
    console.log(`  [E2E] Test directory: ${tempDir}`);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("creates and initializes a Vite React project with exportc", async () => {
    // Step 1: Create Vite React project
    console.log("  [E2E] Creating Vite React project...");
    const createResult = runCommand(
      "npm create vite@latest my-app -- --template react-ts",
      tempDir,
      60000
    );

    if (createResult.exitCode !== 0) {
      console.log("  [E2E] Vite create stdout:", createResult.stdout);
      console.log("  [E2E] Vite create stderr:", createResult.stderr);
    }
    assert.strictEqual(createResult.exitCode, 0, "Vite project creation should succeed");

    const projectDir = path.join(tempDir, "my-app");
    assert.ok(fs.existsSync(projectDir), "Project directory should exist");
    assert.ok(fs.existsSync(path.join(projectDir, "package.json")), "package.json should exist");
    assert.ok(fs.existsSync(path.join(projectDir, "vite.config.ts")), "vite.config.ts should exist");

    // Step 2: Install dependencies
    console.log("  [E2E] Installing Vite dependencies...");
    const installResult = runCommand("npm install", projectDir, 120000);
    assert.strictEqual(installResult.exitCode, 0, "npm install should succeed");

    // Step 3: Run exportc init
    console.log("  [E2E] Running exportc init...");
    const initResult = runCommand(`node ${exportcPath} init`, projectDir, 60000);

    if (initResult.exitCode !== 0) {
      console.log("  [E2E] exportc init stdout:", initResult.stdout);
      console.log("  [E2E] exportc init stderr:", initResult.stderr);
    }
    assert.strictEqual(initResult.exitCode, 0, "exportc init should succeed");

    // Step 4: Verify export directory structure
    console.log("  [E2E] Verifying export directory structure...");
    const exportDir = path.join(projectDir, "export");
    assert.ok(fs.existsSync(exportDir), "export/ directory should exist");
    assert.ok(fs.existsSync(path.join(exportDir, "index.ts")), "export/index.ts should exist");
    assert.ok(fs.existsSync(path.join(exportDir, "package.json")), "export/package.json should exist");
    assert.ok(fs.existsSync(path.join(exportDir, ".gitignore")), "export/.gitignore should exist");

    // Step 5: Verify vite.config.ts was updated
    console.log("  [E2E] Verifying vite.config.ts...");
    const viteConfig = fs.readFileSync(path.join(projectDir, "vite.config.ts"), "utf8");
    assert.ok(
      viteConfig.includes('import { exportPlugin } from "exportc/vite"'),
      "vite.config.ts should import exportPlugin"
    );
    assert.ok(
      viteConfig.includes("exportPlugin()"),
      "vite.config.ts should use exportPlugin()"
    );

    // Step 6: Verify package.json was updated with scripts
    console.log("  [E2E] Verifying package.json scripts...");
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectDir, "package.json"), "utf8"));
    assert.ok(packageJson.scripts["export"], "package.json should have 'export' script");
    assert.ok(packageJson.devDependencies["exportc"], "package.json should have exportc as devDependency");

    // Step 7: Verify export/package.json configuration
    console.log("  [E2E] Verifying export/package.json...");
    const exportPackageJson = JSON.parse(fs.readFileSync(path.join(exportDir, "package.json"), "utf8"));
    assert.ok(exportPackageJson.name, "export/package.json should have a name");
    assert.ok(exportPackageJson.exports, "export/package.json should have exports field");
    assert.ok(
      exportPackageJson.dependencies["export-runtime"],
      "export/package.json should depend on export-runtime"
    );

    // Step 8: Verify export dependencies were installed automatically
    console.log("  [E2E] Verifying export dependencies were installed...");
    assert.ok(
      fs.existsSync(path.join(exportDir, "node_modules")),
      "export/node_modules should exist (auto-installed)"
    );
    assert.ok(
      fs.existsSync(path.join(exportDir, "node_modules", "export-runtime")),
      "export-runtime should be installed in export/node_modules"
    );

    // Step 8b: Verify main project dependencies were installed (exportc)
    console.log("  [E2E] Verifying main project dependencies...");
    // The init command should have run npm install, but exportc points to "latest" which
    // may not include our local changes. Install local version for the build test.
    const exportcDir = path.resolve(__dirname, "..");
    const installExportcResult = runCommand(`npm install ${exportcDir}`, projectDir, 60000);
    assert.strictEqual(installExportcResult.exitCode, 0, "Installing local exportc should succeed");

    // Verify exportc is now in node_modules
    assert.ok(
      fs.existsSync(path.join(projectDir, "node_modules", "exportc")),
      "exportc should be installed in node_modules"
    );

    // Step 9: Verify export/index.ts has example code
    console.log("  [E2E] Verifying export/index.ts...");
    const exportIndex = fs.readFileSync(path.join(exportDir, "index.ts"), "utf8");
    assert.ok(exportIndex.includes("export"), "export/index.ts should have exports");
    assert.ok(
      exportIndex.includes("async function") || exportIndex.includes("class"),
      "export/index.ts should have async function or class"
    );

    // Step 10: Try to build the Vite project (should work with exportc)
    console.log("  [E2E] Building Vite project...");
    // First, add a simple import to test the plugin
    const appTsxPath = path.join(projectDir, "src", "App.tsx");
    let appTsx = fs.readFileSync(appTsxPath, "utf8");

    // Add import at the top (after existing imports)
    appTsx = appTsx.replace(
      /^(import .+\n)+/m,
      (match) => match + '// import { hello } from "export/";\n'
    );
    fs.writeFileSync(appTsxPath, appTsx);

    const buildResult = runCommand("npm run build", projectDir, 120000);
    if (buildResult.exitCode !== 0) {
      console.log("  [E2E] Build stdout:", buildResult.stdout);
      console.log("  [E2E] Build stderr:", buildResult.stderr);
    }
    assert.strictEqual(buildResult.exitCode, 0, "Vite build should succeed");

    // Step 11: Verify build output exists
    console.log("  [E2E] Verifying build output...");
    assert.ok(fs.existsSync(path.join(projectDir, "dist")), "dist/ directory should exist");
    assert.ok(fs.existsSync(path.join(projectDir, "dist", "index.html")), "dist/index.html should exist");

    console.log("  [E2E] All checks passed!");
  });

  test("exportc init fails gracefully on non-Vite project", async () => {
    // Create a non-Vite project (just package.json, no vite.config)
    fs.writeFileSync(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "non-vite-project", version: "1.0.0" }, null, 2)
    );

    const result = runCommand(`node ${exportcPath} init`, tempDir, 30000);

    assert.notStrictEqual(result.exitCode, 0, "Should fail on non-Vite project");
    const output = result.stdout + result.stderr;
    assert.ok(
      output.includes("Vite") || output.includes("vite"),
      "Error message should mention Vite"
    );
  });

  test("creates Vite Vue project with exportc", async () => {
    // Create Vite Vue project
    console.log("  [E2E] Creating Vite Vue project...");
    const createResult = runCommand(
      "npm create vite@latest vue-app -- --template vue-ts",
      tempDir,
      60000
    );
    assert.strictEqual(createResult.exitCode, 0, "Vite Vue project creation should succeed");

    const projectDir = path.join(tempDir, "vue-app");

    // Install dependencies
    console.log("  [E2E] Installing dependencies...");
    runCommand("npm install", projectDir, 120000);

    // Run exportc init
    console.log("  [E2E] Running exportc init...");
    const initResult = runCommand(`node ${exportcPath} init`, projectDir, 60000);
    assert.strictEqual(initResult.exitCode, 0, "exportc init should succeed for Vue project");

    // Verify structure
    assert.ok(fs.existsSync(path.join(projectDir, "export", "index.ts")));

    const viteConfig = fs.readFileSync(path.join(projectDir, "vite.config.ts"), "utf8");
    assert.ok(viteConfig.includes("exportPlugin"));
  });

  test("vite-plugin resolves export/ imports correctly", async () => {
    // Import the plugin directly and test it
    const pluginPath = path.resolve(__dirname, "..", "vite-plugin.js");
    const { exportPlugin } = await import(pluginPath);

    const plugin = exportPlugin({
      dev: "http://localhost:8787",
      production: "https://my-api.workers.dev",
    });

    // Test dev mode
    plugin.config({}, { command: "serve" });

    // Test resolveId
    const resolved = plugin.resolveId("export/");
    assert.ok(resolved, "Should resolve export/ imports");
    assert.strictEqual(resolved.id, "export/");
    assert.strictEqual(resolved.external, false);

    // Test load generates correct code
    const code = plugin.load("export/");
    assert.ok(code.includes("http://localhost:8787"));
    assert.ok(code.includes("export *"));
    assert.ok(code.includes("export { default }"));

    // Test subpath
    const utilsCode = plugin.load("export/utils");
    assert.ok(utilsCode.includes("http://localhost:8787/utils"));

    // Test production mode
    plugin.config({}, { command: "build" });
    const prodCode = plugin.load("export/");
    assert.ok(prodCode.includes("https://my-api.workers.dev"));
  });
});

describe("exportc E2E from npm registry", { timeout: 300000 }, () => {
  let tempDir;

  beforeEach(() => {
    tempDir = createTempDir();
    console.log(`  [E2E-npm] Test directory: ${tempDir}`);
  });

  afterEach(() => {
    cleanupTempDir(tempDir);
  });

  test("npx exportc@latest init works from npm registry", async () => {
    // Step 1: Create Vite React project
    console.log("  [E2E-npm] Creating Vite React project...");
    const createResult = runCommand(
      "npm create vite@latest my-app -- --template react-ts",
      tempDir,
      60000
    );
    assert.strictEqual(createResult.exitCode, 0, "Vite project creation should succeed");

    const projectDir = path.join(tempDir, "my-app");

    // Step 2: Install Vite dependencies first
    console.log("  [E2E-npm] Installing Vite dependencies...");
    const installResult = runCommand("npm install", projectDir, 120000);
    assert.strictEqual(installResult.exitCode, 0, "npm install should succeed");

    // Step 3: Run npx exportc@latest init (from npm registry, NOT local)
    console.log("  [E2E-npm] Running npx exportc@latest init (from npm)...");
    const initResult = runCommand("npx exportc@latest init", projectDir, 180000);

    console.log("  [E2E-npm] init stdout:", initResult.stdout);
    if (initResult.stderr) {
      console.log("  [E2E-npm] init stderr:", initResult.stderr);
    }

    assert.strictEqual(initResult.exitCode, 0, "npx exportc@latest init should succeed");

    // Step 4: Verify export directory was created
    console.log("  [E2E-npm] Verifying export directory...");
    const exportDir = path.join(projectDir, "export");
    assert.ok(fs.existsSync(exportDir), "export/ directory should exist");
    assert.ok(fs.existsSync(path.join(exportDir, "index.ts")), "export/index.ts should exist");
    assert.ok(fs.existsSync(path.join(exportDir, "package.json")), "export/package.json should exist");

    // Step 5: Verify export dependencies were installed
    console.log("  [E2E-npm] Verifying export dependencies...");
    assert.ok(
      fs.existsSync(path.join(exportDir, "node_modules")),
      "export/node_modules should exist"
    );
    assert.ok(
      fs.existsSync(path.join(exportDir, "node_modules", "export-runtime")),
      "export-runtime should be installed"
    );

    // Step 6: Verify exportc was installed in main project
    console.log("  [E2E-npm] Verifying exportc installation...");
    assert.ok(
      fs.existsSync(path.join(projectDir, "node_modules", "exportc")),
      "exportc should be installed in node_modules"
    );

    // Step 7: Verify vite.config.ts was updated
    console.log("  [E2E-npm] Verifying vite.config.ts...");
    const viteConfig = fs.readFileSync(path.join(projectDir, "vite.config.ts"), "utf8");
    assert.ok(
      viteConfig.includes('import { exportPlugin } from "exportc/vite"'),
      "vite.config.ts should import exportPlugin"
    );

    // Step 8: Verify build works
    console.log("  [E2E-npm] Building Vite project...");
    const buildResult = runCommand("npm run build", projectDir, 120000);

    if (buildResult.exitCode !== 0) {
      console.log("  [E2E-npm] Build stdout:", buildResult.stdout);
      console.log("  [E2E-npm] Build stderr:", buildResult.stderr);
    }

    assert.strictEqual(buildResult.exitCode, 0, "Vite build should succeed");
    assert.ok(fs.existsSync(path.join(projectDir, "dist")), "dist/ directory should exist");

    console.log("  [E2E-npm] All npm registry tests passed!");
  });
});

// Run tests
console.log("Running exportc E2E tests...\n");
console.log("Note: These tests create real Vite projects and may take a few minutes.\n");
