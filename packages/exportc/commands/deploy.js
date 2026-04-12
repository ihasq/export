import pc from "picocolors";
import fs from "node:fs";
import path from "node:path";
import { spawn, execSync } from "node:child_process";

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

  // Read root package.json
  const pkgPath = path.join(cwd, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const cloudflare = pkg.cloudflare || {};
  const workerName = cloudflare.name;

  if (!workerName) {
    console.error(pc.red("✗") + ` Missing ${pc.cyan("cloudflare.name")} in package.json`);
    process.exit(1);
  }

  // Check if subdomain is already saved
  let subdomain = cloudflare.subdomain;

  if (!subdomain) {
    // First deploy: need to deploy once to get the subdomain
    console.log(pc.yellow("First deploy detected. Deploying to discover your workers.dev subdomain..."));
    console.log();

    // Generate types first
    try {
      execSync("npx generate-export-types", { cwd: exportDir, stdio: "inherit" });
    } catch {
      console.error(pc.red("✗") + " Failed to generate types");
      process.exit(1);
    }

    // Deploy and capture output
    const deployOutput = await runWranglerDeploy(exportDir);

    // Parse subdomain from output (e.g., "https://my-app.my-subdomain.workers.dev")
    const urlMatch = deployOutput.match(/https:\/\/([^.]+)\.([^.]+)\.workers\.dev/);
    if (urlMatch) {
      subdomain = urlMatch[2];

      // Save subdomain to package.json
      pkg.cloudflare = pkg.cloudflare || {};
      pkg.cloudflare.subdomain = subdomain;
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

      console.log();
      console.log(pc.green("✓") + ` Saved subdomain ${pc.cyan(subdomain)} to package.json`);
      console.log();
    } else {
      console.error(pc.red("✗") + " Could not detect subdomain from deploy output");
      console.error(pc.gray("Add 'cloudflare.subdomain' to package.json manually, or use 'production' option in exportPlugin()"));
      process.exit(1);
    }
  }

  const workerUrl = `https://${workerName}.${subdomain}.workers.dev`;

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

  // Step 2: Generate types and deploy to Cloudflare Workers
  console.log("Deploying to Cloudflare Workers...");

  try {
    execSync("npx generate-export-types", { cwd: exportDir, stdio: "inherit" });
  } catch {
    console.error(pc.red("✗") + " Failed to generate types");
    process.exit(1);
  }

  await runWranglerDeploy(exportDir, true);

  console.log();
  console.log(pc.green("✓") + " Deployed to " + pc.cyan(workerUrl));
}

async function runWranglerDeploy(exportDir, inheritStdio = false) {
  return new Promise((resolve, reject) => {
    let output = "";

    const wrangler = spawn("npx", ["wrangler", "deploy"], {
      cwd: exportDir,
      stdio: inheritStdio ? "inherit" : ["pipe", "pipe", "pipe"],
      shell: true,
    });

    if (!inheritStdio) {
      wrangler.stdout.on("data", (data) => {
        const text = data.toString();
        output += text;
        process.stdout.write(text);
      });

      wrangler.stderr.on("data", (data) => {
        const text = data.toString();
        output += text;
        process.stderr.write(text);
      });
    }

    wrangler.on("close", (code) => {
      if (code !== 0) {
        console.error(pc.red("✗") + " Deployment failed");
        process.exit(1);
      }
      resolve(output);
    });

    wrangler.on("error", (err) => {
      reject(err);
    });
  });
}
