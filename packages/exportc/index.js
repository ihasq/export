#!/usr/bin/env node

import mri from "mri";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { init } from "./commands/init.js";
import { dev } from "./commands/dev.js";
import { deploy } from "./commands/deploy.js";

const argv = mri(process.argv.slice(2), {
  alias: {
    h: "help",
    v: "version",
  },
  boolean: ["help", "version"],
});

const command = argv._[0];

const HELP = `
${pc.bold("exportc")} - Add export to existing projects

${pc.bold("Usage:")}
  exportc <command> [options]

${pc.bold("Commands:")}
  init          Initialize export in an existing Vite project
  dev           Start development server (Vite + Wrangler)
  deploy        Deploy to Cloudflare Workers

${pc.bold("Options:")}
  -h, --help    Show this help message
  -v, --version Show version number

${pc.bold("Examples:")}
  ${pc.dim("# Add export to your Vite project")}
  npx exportc init

  ${pc.dim("# Start development")}
  npx exportc dev

  ${pc.dim("# Deploy to Cloudflare")}
  npx exportc deploy
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
  p.cancel(err.message);
  process.exit(1);
}
