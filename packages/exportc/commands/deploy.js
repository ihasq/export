import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function deploy(argv) {
  const cwd = process.cwd();
  const exportDir = path.join(cwd, "export");

  // Check if export directory exists
  if (!fs.existsSync(exportDir)) {
    console.error(pc.red("✗") + ` No export/ directory found. Run ${pc.cyan("exportc init")} first.`);
    process.exit(1);
  }

  // Check if dependencies are installed
  const nodeModules = path.join(exportDir, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    console.error(pc.red("✗") + ` Dependencies not installed. Run ${pc.cyan("cd export && npm install")} first.`);
    process.exit(1);
  }

  console.log(pc.cyan("exportc deploy"));
  console.log();

  // Step 1: Build Vite
  console.log("Building with Vite...");

  const viteBuild = spawn("npm", ["run", "build"], {
    cwd,
    stdio: "inherit",
    shell: true,
  });

  const viteExitCode = await new Promise((resolve) => {
    viteBuild.on("close", resolve);
    viteBuild.on("error", () => resolve(1));
  });

  if (viteExitCode !== 0) {
    console.error(pc.red("✗") + " Vite build failed");
    process.exit(1);
  }

  console.log(pc.green("✓") + " Vite build complete");
  console.log();

  // Step 2: Deploy to Cloudflare Workers
  console.log("Deploying to Cloudflare Workers...");

  const wranglerDeploy = spawn("npm", ["run", "deploy"], {
    cwd: exportDir,
    stdio: "inherit",
    shell: true,
  });

  const wranglerExitCode = await new Promise((resolve) => {
    wranglerDeploy.on("close", resolve);
    wranglerDeploy.on("error", () => resolve(1));
  });

  if (wranglerExitCode !== 0) {
    console.error(pc.red("✗") + " Deployment failed");
    process.exit(1);
  }

  // Read worker name from export/package.json
  const exportPkgPath = path.join(exportDir, "package.json");
  const exportPkg = JSON.parse(fs.readFileSync(exportPkgPath, "utf8"));
  const workerName = exportPkg.name;

  console.log();
  console.log(pc.green("✓") + " Deployed to " + pc.cyan(`https://${workerName}.workers.dev/`));
}
