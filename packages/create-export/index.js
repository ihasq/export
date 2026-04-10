#!/usr/bin/env node

import * as p from "@clack/prompts";
import mri from "mri";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// OAuth providers configuration
const PROVIDERS = {
  google: { clientId: "GOOGLE_CLIENT_ID", clientSecret: "GOOGLE_CLIENT_SECRET" },
  github: { clientId: "GITHUB_CLIENT_ID", clientSecret: "GITHUB_CLIENT_SECRET" },
  discord: { clientId: "DISCORD_CLIENT_ID", clientSecret: "DISCORD_CLIENT_SECRET" },
  twitter: { clientId: "TWITTER_CLIENT_ID", clientSecret: "TWITTER_CLIENT_SECRET" },
  facebook: { clientId: "FACEBOOK_CLIENT_ID", clientSecret: "FACEBOOK_CLIENT_SECRET" },
  apple: { clientId: "APPLE_CLIENT_ID", clientSecret: "APPLE_CLIENT_SECRET" },
  microsoft: { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
  linkedin: { clientId: "LINKEDIN_CLIENT_ID", clientSecret: "LINKEDIN_CLIENT_SECRET" },
};

const argv = mri(process.argv.slice(2), {
  alias: {
    t: "template",
    h: "help",
  },
  string: ["template"],
  boolean: ["help"],
});

// Check if this is an auth subcommand
const command = argv._[0];
if (command === "auth") {
  await handleAuthCommand(argv._.slice(1));
  process.exit(0);
}

if (argv.help) {
  console.log(`
Usage: npm create export [project-name] [options]
       npm create export auth <command> [options]

Project Creation:
  npm create export my-app
  npm create export my-app --template typescript
  npm create export my-app -t javascript

Auth Management:
  npm create export auth add <provider> <clientId>:<clientSecret>
  npm create export auth remove <provider>
  npm create export auth list

Options:
  -t, --template <type>  Template type: typescript | javascript
  -h, --help             Show this help message

Supported OAuth providers:
  google, github, discord, twitter, facebook, apple, microsoft, linkedin
`);
  process.exit(0);
}

// --- Project Creation ---

p.intro("create-export");

let projectName = argv._[0];
let template = argv.template;

if (!projectName) {
  const result = await p.text({
    message: "Project name:",
    placeholder: "my-export-app",
    defaultValue: "my-export-app",
    validate: (value) => {
      if (!value) return "Project name is required";
      if (existsSync(resolve(process.cwd(), value))) {
        return `Directory "${value}" already exists`;
      }
    },
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  projectName = result || "my-export-app";
}

const targetDir = resolve(process.cwd(), projectName);

if (existsSync(targetDir)) {
  p.cancel(`Directory "${projectName}" already exists.`);
  process.exit(1);
}

if (!template) {
  const result = await p.select({
    message: "Select a template:",
    options: [
      { value: "typescript", label: "TypeScript", hint: "recommended" },
      { value: "javascript", label: "JavaScript" },
    ],
  });

  if (p.isCancel(result)) {
    p.cancel("Operation cancelled.");
    process.exit(0);
  }

  template = result;
}

if (template !== "typescript" && template !== "javascript") {
  p.cancel(`Invalid template: ${template}. Use "typescript" or "javascript".`);
  process.exit(1);
}

const s = p.spinner();
s.start("Creating project...");

const templateDir = join(__dirname, `template-${template}`);

mkdirSync(targetDir, { recursive: true });
cpSync(templateDir, targetDir, { recursive: true });

// Update project package.json
const pkgPath = join(targetDir, "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
pkg.name = projectName;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

s.stop("Project created!");

p.note(
  `cd ${projectName}
npm install
npm run dev     # Start local development
npm run export  # Deploy to Cloudflare Workers`,
  "Next steps"
);

p.outro(`Import from your Worker URL:

  import { greet, add } from "https://${projectName}.workers.dev/";
  const message = await greet("World");
`);

// --- Auth Management ---

async function handleAuthCommand(args) {
  const [subcommand, ...rest] = args;
  const cwd = process.cwd();
  const pkgPath = join(cwd, "package.json");

  if (!existsSync(pkgPath)) {
    console.error("package.json not found. Run this command in your project directory.");
    process.exit(1);
  }

  switch (subcommand) {
    case "add":
      await addProvider(rest, cwd, pkgPath);
      break;
    case "remove":
      await removeProvider(rest, cwd, pkgPath);
      break;
    case "list":
      await listProviders(cwd, pkgPath);
      break;
    default:
      console.log(`
Auth Management Commands:
  npm create export auth add <provider> <clientId>:<clientSecret>
  npm create export auth remove <provider>
  npm create export auth list

Supported providers: ${Object.keys(PROVIDERS).join(", ")}
`);
      break;
  }
}

function readEnvFile(cwd) {
  const envPath = join(cwd, ".dev.vars");
  if (!existsSync(envPath)) return {};
  const content = readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}

function writeEnvFile(cwd, env) {
  const envPath = join(cwd, ".dev.vars");
  const lines = [];
  if (!existsSync(envPath)) {
    lines.push("# Local development environment variables");
    lines.push("# Used by wrangler dev - DO NOT commit to git");
    lines.push("");
  }
  for (const [key, value] of Object.entries(env)) {
    const needsQuotes = /[\s"'=]/.test(value);
    lines.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
  }
  writeFileSync(envPath, lines.join("\n") + "\n");
}

function ensureGitignore(cwd) {
  const gitignorePath = join(cwd, ".gitignore");
  let content = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  if (!content.includes(".dev.vars")) {
    const lines = content ? content.split("\n") : [];
    if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
    lines.push("# Local secrets (wrangler dev)");
    lines.push(".dev.vars");
    lines.push("");
    writeFileSync(gitignorePath, lines.join("\n"));
    console.log("Added .dev.vars to .gitignore");
  }
}

function generateSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.randomBytes(32);
  return Array.from(bytes).map(b => chars[b % chars.length]).join("");
}

async function addProvider(args, cwd, pkgPath) {
  const [provider, credentials] = args;

  if (!provider || !credentials) {
    console.error("Usage: npm create export auth add <provider> <clientId>:<clientSecret>");
    process.exit(1);
  }

  const providerLower = provider.toLowerCase();
  if (!PROVIDERS[providerLower]) {
    console.error(`Unknown provider: ${provider}`);
    console.error("Supported:", Object.keys(PROVIDERS).join(", "));
    process.exit(1);
  }

  let clientId, clientSecret;
  if (credentials.includes(":")) {
    [clientId, clientSecret] = credentials.split(":", 2);
  } else {
    clientId = credentials;
    clientSecret = args[2];
  }

  if (!clientId || !clientSecret) {
    console.error("Both clientId and clientSecret are required");
    process.exit(1);
  }

  // Update package.json
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (!pkg.cloudflare) pkg.cloudflare = {};
  if (!pkg.cloudflare.auth) pkg.cloudflare.auth = {};
  if (pkg.cloudflare.auth === true) pkg.cloudflare.auth = {};
  if (!pkg.cloudflare.auth.providers) pkg.cloudflare.auth.providers = [];
  if (!pkg.cloudflare.auth.providers.includes(providerLower)) {
    pkg.cloudflare.auth.providers.push(providerLower);
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Enabled ${provider} in package.json`);

  // Update .dev.vars
  const env = readEnvFile(cwd);
  const config = PROVIDERS[providerLower];
  env[config.clientId] = clientId;
  env[config.clientSecret] = clientSecret;
  if (!env.BETTER_AUTH_SECRET) {
    env.BETTER_AUTH_SECRET = generateSecret();
    console.log("Generated BETTER_AUTH_SECRET");
  }
  writeEnvFile(cwd, env);
  ensureGitignore(cwd);

  console.log(`Saved credentials to .dev.vars`);
  console.log("");
  console.log("For production, set these in Cloudflare dashboard:");
  console.log(`  ${config.clientId}=${clientId}`);
  console.log(`  ${config.clientSecret}=***`);
  console.log(`  BETTER_AUTH_SECRET=***`);
  console.log("");
  console.log("OAuth callback URL:");
  console.log(`  https://your-worker.workers.dev/api/auth/callback/${providerLower}`);
}

async function removeProvider(args, cwd, pkgPath) {
  const [provider] = args;

  if (!provider) {
    console.error("Usage: npm create export auth remove <provider>");
    process.exit(1);
  }

  const providerLower = provider.toLowerCase();
  if (!PROVIDERS[providerLower]) {
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  // Update package.json
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  if (pkg.cloudflare?.auth?.providers) {
    pkg.cloudflare.auth.providers = pkg.cloudflare.auth.providers.filter(p => p !== providerLower);
    if (pkg.cloudflare.auth.providers.length === 0) {
      delete pkg.cloudflare.auth.providers;
    }
    if (typeof pkg.cloudflare.auth === "object" && Object.keys(pkg.cloudflare.auth).length === 0) {
      pkg.cloudflare.auth = true;
    }
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  console.log(`Removed ${provider} from package.json`);

  // Update .dev.vars
  const env = readEnvFile(cwd);
  const config = PROVIDERS[providerLower];
  delete env[config.clientId];
  delete env[config.clientSecret];
  writeEnvFile(cwd, env);
  console.log(`Removed credentials from .dev.vars`);
  console.log("");
  console.log("Remember to remove secrets from Cloudflare dashboard");
}

async function listProviders(cwd, pkgPath) {
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  const env = readEnvFile(cwd);

  console.log("OAuth Providers:");
  console.log("");

  for (const [name, config] of Object.entries(PROVIDERS)) {
    const hasCredentials = env[config.clientId] && env[config.clientSecret];
    const isEnabled = pkg.cloudflare?.auth?.providers?.includes(name);
    const status = isEnabled && hasCredentials ? "[configured]" :
                   isEnabled ? "[enabled, missing credentials]" :
                   hasCredentials ? "[credentials only]" : "";
    console.log(`  ${name} ${status}`);
  }

  console.log("");
  if (pkg.cloudflare?.auth) {
    console.log("Auth is enabled in package.json");
  } else {
    console.log("Auth not enabled. Run: npm create export auth add <provider> <credentials>");
  }
}
