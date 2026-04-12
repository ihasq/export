import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function deploy(argv) {
  const cwd = process.cwd();
  const exportDir = path.join(cwd, "export");

  // Check if export directory exists
  if (!fs.existsSync(exportDir)) {
    p.cancel(`No export/ directory found. Run ${pc.cyan("exportc init")} first.`);
    process.exit(1);
  }

  // Check if dependencies are installed
  const nodeModules = path.join(exportDir, "node_modules");
  if (!fs.existsSync(nodeModules)) {
    p.cancel(`Dependencies not installed. Run ${pc.cyan("cd export && npm install")} first.`);
    process.exit(1);
  }

  p.intro(pc.bgCyan(pc.black(" exportc deploy ")));

  // Step 1: Build Vite
  const s1 = p.spinner();
  s1.start("Building with Vite...");

  const viteBuild = spawn("npm", ["run", "build"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  let viteBuildOutput = "";
  viteBuild.stdout.on("data", (data) => { viteBuildOutput += data.toString(); });
  viteBuild.stderr.on("data", (data) => { viteBuildOutput += data.toString(); });

  const viteExitCode = await new Promise((resolve) => {
    viteBuild.on("close", resolve);
    viteBuild.on("error", () => resolve(1));
  });

  if (viteExitCode !== 0) {
    s1.stop("Vite build failed");
    console.error(viteBuildOutput);
    process.exit(1);
  }

  s1.stop("Vite build complete");

  // Step 2: Deploy to Cloudflare Workers
  const s2 = p.spinner();
  s2.start("Deploying to Cloudflare Workers...");

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
    s2.stop("Deployment failed");
    process.exit(1);
  }

  s2.stop("Deployed successfully!");

  // Read worker name from export/package.json
  const exportPkgPath = path.join(exportDir, "package.json");
  const exportPkg = JSON.parse(fs.readFileSync(exportPkgPath, "utf8"));
  const workerName = exportPkg.name;

  p.note(
    `Your app is now live at:
${pc.cyan(`https://${workerName}.workers.dev/`)}

${pc.bold("What was deployed:")}
- Static assets (Vite build output)
- Server exports (export/ directory)

${pc.bold("Client imports will resolve to:")}
${pc.cyan(`https://${workerName}.workers.dev/`)}`,
    "Workers Sites"
  );

  p.outro("Done!");
}
