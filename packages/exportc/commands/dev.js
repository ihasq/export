import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function dev(argv) {
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

  console.log(pc.cyan("exportc dev"));
  console.log();
  console.log("Starting Wrangler dev server...");

  const wrangler = spawn("npm", ["run", "dev"], {
    cwd: exportDir,
    stdio: "inherit",
    shell: true,
  });

  wrangler.on("error", (err) => {
    console.error(pc.red("✗") + " Failed to start dev server");
    console.error(err.message);
    process.exit(1);
  });

  // Keep the process running
  await new Promise(() => {});
}
