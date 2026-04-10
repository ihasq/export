#!/usr/bin/env node

import fs from "fs";
import path from "path";

const cwd = process.cwd();
const pkgPath = path.join(cwd, "package.json");

// Supported OAuth providers and their required env vars
const PROVIDERS = {
  google: {
    clientId: "GOOGLE_CLIENT_ID",
    clientSecret: "GOOGLE_CLIENT_SECRET",
  },
  github: {
    clientId: "GITHUB_CLIENT_ID",
    clientSecret: "GITHUB_CLIENT_SECRET",
  },
  discord: {
    clientId: "DISCORD_CLIENT_ID",
    clientSecret: "DISCORD_CLIENT_SECRET",
  },
  twitter: {
    clientId: "TWITTER_CLIENT_ID",
    clientSecret: "TWITTER_CLIENT_SECRET",
  },
  facebook: {
    clientId: "FACEBOOK_CLIENT_ID",
    clientSecret: "FACEBOOK_CLIENT_SECRET",
  },
  apple: {
    clientId: "APPLE_CLIENT_ID",
    clientSecret: "APPLE_CLIENT_SECRET",
  },
  microsoft: {
    clientId: "MICROSOFT_CLIENT_ID",
    clientSecret: "MICROSOFT_CLIENT_SECRET",
  },
  linkedin: {
    clientId: "LINKEDIN_CLIENT_ID",
    clientSecret: "LINKEDIN_CLIENT_SECRET",
  },
};

function readPackageJson() {
  if (!fs.existsSync(pkgPath)) {
    console.error("package.json not found in", cwd);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(pkgPath, "utf8"));
}

function writePackageJson(pkg) {
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
}

function readEnvFile() {
  const envPath = path.join(cwd, ".dev.vars");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const content = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[key] = value;
    }
  }
  return env;
}

function writeEnvFile(env) {
  const envPath = path.join(cwd, ".dev.vars");
  const lines = [];

  // Add header comment if file is new
  if (!fs.existsSync(envPath)) {
    lines.push("# Local development environment variables");
    lines.push("# These are used by wrangler dev and should NOT be committed to git");
    lines.push("");
  }

  for (const [key, value] of Object.entries(env)) {
    // Quote values that contain spaces or special characters
    const needsQuotes = /[\s"'=]/.test(value);
    lines.push(`${key}=${needsQuotes ? `"${value}"` : value}`);
  }

  fs.writeFileSync(envPath, lines.join("\n") + "\n");
}

function ensureGitignore() {
  const gitignorePath = path.join(cwd, ".gitignore");
  let content = "";
  if (fs.existsSync(gitignorePath)) {
    content = fs.readFileSync(gitignorePath, "utf8");
  }

  if (!content.includes(".dev.vars")) {
    const lines = content ? content.split("\n") : [];
    if (lines.length > 0 && lines[lines.length - 1] !== "") {
      lines.push("");
    }
    lines.push("# Local secrets (wrangler dev)");
    lines.push(".dev.vars");
    lines.push("");
    fs.writeFileSync(gitignorePath, lines.join("\n"));
    console.log("Added .dev.vars to .gitignore");
  }
}

function addProvider(provider, credentials) {
  const providerLower = provider.toLowerCase();

  if (!PROVIDERS[providerLower]) {
    console.error(`Unknown provider: ${provider}`);
    console.error("Supported providers:", Object.keys(PROVIDERS).join(", "));
    process.exit(1);
  }

  // Parse credentials (format: clientId:clientSecret or just clientId if secret provided separately)
  let clientId, clientSecret;
  if (credentials.includes(":")) {
    [clientId, clientSecret] = credentials.split(":", 2);
  } else {
    clientId = credentials;
    clientSecret = process.argv[5]; // Fourth argument
  }

  if (!clientId || !clientSecret) {
    console.error("Usage: npx export-auth add <provider> <clientId>:<clientSecret>");
    console.error("   or: npx export-auth add <provider> <clientId> <clientSecret>");
    process.exit(1);
  }

  // Update package.json to enable auth
  const pkg = readPackageJson();
  if (!pkg.cloudflare) pkg.cloudflare = {};
  if (!pkg.cloudflare.auth) pkg.cloudflare.auth = {};
  if (pkg.cloudflare.auth === true) pkg.cloudflare.auth = {};

  // Add provider to auth config
  if (!pkg.cloudflare.auth.providers) pkg.cloudflare.auth.providers = [];
  if (!pkg.cloudflare.auth.providers.includes(providerLower)) {
    pkg.cloudflare.auth.providers.push(providerLower);
  }

  writePackageJson(pkg);
  console.log(`Enabled ${provider} authentication in package.json`);

  // Update .dev.vars with credentials
  const env = readEnvFile();
  const providerConfig = PROVIDERS[providerLower];
  env[providerConfig.clientId] = clientId;
  env[providerConfig.clientSecret] = clientSecret;

  // Ensure BETTER_AUTH_SECRET exists
  if (!env.BETTER_AUTH_SECRET) {
    env.BETTER_AUTH_SECRET = generateSecret();
    console.log("Generated BETTER_AUTH_SECRET");
  }

  writeEnvFile(env);
  ensureGitignore();

  console.log(`Saved ${provider} credentials to .dev.vars`);
  console.log("");
  console.log("For production, set these secrets in Cloudflare dashboard:");
  console.log(`  ${providerConfig.clientId}=${clientId}`);
  console.log(`  ${providerConfig.clientSecret}=***`);
  console.log(`  BETTER_AUTH_SECRET=***`);
  console.log("");
  console.log("OAuth callback URL:");
  console.log(`  https://your-worker.workers.dev/api/auth/callback/${providerLower}`);
}

function removeProvider(provider) {
  const providerLower = provider.toLowerCase();

  if (!PROVIDERS[providerLower]) {
    console.error(`Unknown provider: ${provider}`);
    process.exit(1);
  }

  // Update package.json
  const pkg = readPackageJson();
  if (pkg.cloudflare?.auth?.providers) {
    pkg.cloudflare.auth.providers = pkg.cloudflare.auth.providers.filter(p => p !== providerLower);
    if (pkg.cloudflare.auth.providers.length === 0) {
      delete pkg.cloudflare.auth.providers;
    }
    // If auth config is empty object, set to true for simpler config
    if (Object.keys(pkg.cloudflare.auth).length === 0) {
      pkg.cloudflare.auth = true;
    }
  }

  writePackageJson(pkg);
  console.log(`Removed ${provider} from package.json`);

  // Remove from .dev.vars
  const env = readEnvFile();
  const providerConfig = PROVIDERS[providerLower];
  delete env[providerConfig.clientId];
  delete env[providerConfig.clientSecret];

  writeEnvFile(env);
  console.log(`Removed ${provider} credentials from .dev.vars`);
  console.log("");
  console.log("Remember to also remove the secrets from Cloudflare dashboard");
}

function listProviders() {
  const pkg = readPackageJson();
  const env = readEnvFile();

  console.log("Available OAuth providers:");
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
    console.log("Auth is not enabled. Run: npx export-auth add <provider> <credentials>");
  }
}

function generateSecret() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  const randomValues = new Uint8Array(32);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < 32; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
}

function showHelp() {
  console.log(`
export-auth - Manage OAuth providers for export-runtime

Usage:
  npx export-auth add <provider> <clientId>:<clientSecret>
  npx export-auth add <provider> <clientId> <clientSecret>
  npx export-auth remove <provider>
  npx export-auth list

Commands:
  add      Add an OAuth provider with credentials
  remove   Remove an OAuth provider
  list     List available providers and their status

Supported providers:
  ${Object.keys(PROVIDERS).join(", ")}

Examples:
  npx export-auth add google 123456.apps.googleusercontent.com:GOCSPX-xxx
  npx export-auth add github Iv1.abc123:ghp_xxx
  npx export-auth remove google
  npx export-auth list
`);
}

// Main
const [,, command, ...args] = process.argv;

switch (command) {
  case "add":
    if (args.length < 2) {
      console.error("Usage: npx export-auth add <provider> <clientId>:<clientSecret>");
      process.exit(1);
    }
    addProvider(args[0], args[1]);
    break;
  case "remove":
    if (args.length < 1) {
      console.error("Usage: npx export-auth remove <provider>");
      process.exit(1);
    }
    removeProvider(args[0]);
    break;
  case "list":
    listProviders();
    break;
  case "help":
  case "--help":
  case "-h":
    showHelp();
    break;
  default:
    showHelp();
    process.exit(command ? 1 : 0);
}
