#!/usr/bin/env node

import mri from "mri";
import pc from "picocolors";
import { init } from "./commands/init.js";
import { dev } from "./commands/dev.js";
import { deploy } from "./commands/deploy.js";

const argv = mri(process.argv.slice(2), {
  alias: {
    h: "help",
    v: "version",
    y: "yes",
  },
  boolean: ["help", "version", "yes"],
});

const command = argv._[0];

const HELP = `
${pc.bold("exportc")} - Add export to existing Vite projects

${pc.bold("Usage:")}
  exportc <command> [options]

${pc.bold("Commands:")}
  init          Initialize export in a Vite project
  dev           Start Wrangler dev server
  deploy        Deploy to Cloudflare Workers

${pc.bold("Options:")}
  -h, --help    Show this help message
  -v, --version Show version number

${pc.bold("Example:")}
  ${pc.dim("# Add export to your Vite project")}
  npx exportc init
  npm run dev
`;

if (argv.help || !command) {
  console.log(HELP);
  process.exit(0);
}

if (argv.version) {
  const pkg = await import("./package.json", { with: { type: "json" } });
  console.log(pkg.default.version);
  process.exit(0);
}

const commands = {
  init,
  dev,
  deploy,
};

const handler = commands[command];
if (!handler) {
  console.error(pc.red(`Unknown command: ${command}`));
  console.log(HELP);
  process.exit(1);
}

try {
  await handler(argv);
} catch (err) {
  console.error(pc.red("Error:"), err.message);
  process.exit(1);
}
