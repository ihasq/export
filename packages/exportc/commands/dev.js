import * as p from "@clack/prompts";
import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export async function dev(argv) {
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

  p.intro(pc.bgCyan(pc.black(" exportc dev ")));

  const s = p.spinner();
  s.start("Starting export dev server...");

  // Generate types first
  const generateTypes = spawn("npm", ["run", "dev"], {
    cwd: exportDir,
    stdio: "inherit",
    shell: true,
  });

  generateTypes.on("error", (err) => {
    s.stop("Failed to start dev server");
    console.error(pc.red(err.message));
    process.exit(1);
  });

  s.stop("Export dev server started!");

  p.note(
    `Wrangler dev server is running at ${pc.cyan("http://localhost:8787")}

${pc.bold("In your Vite app:")}
${pc.cyan(`import { hello } from "export/";`)}
${pc.cyan(`const message = await hello("World");`)}

${pc.dim("Press Ctrl+C to stop")}`,
    "Running"
  );

  // Keep the process running
  await new Promise(() => {});
}
