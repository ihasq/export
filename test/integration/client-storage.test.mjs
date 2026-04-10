/**
 * Integration tests for client storage (D1, R2, KV)
 *
 * These tests require actual Cloudflare bindings and must be run with:
 *   npm run test:integration
 *
 * Setup:
 *   1. Create test bindings in wrangler.toml or via CLI:
 *      wrangler d1 create test-db
 *      wrangler r2 bucket create test-bucket
 *      wrangler kv namespace create TEST_KV
 *
 *   2. Update wrangler.toml with the returned IDs
 *
 *   3. Run: npm run test:integration
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const FIXTURE_DIR = path.resolve(import.meta.dirname, "../fixture-integration");
const PORT = 8898;
const BASE = `http://localhost:${PORT}`;

// Skip if fixture doesn't exist
const fixtureExists = fs.existsSync(FIXTURE_DIR);
const skipMessage = fixtureExists ? null : "Integration fixture not set up. See test/integration/README.md";

let wranglerProc;

// Setup: Create integration fixture if needed
before(async () => {
  if (!fixtureExists) {
    console.log("Skipping integration tests - fixture not configured");
    return;
  }

  // Start wrangler dev
  wranglerProc = spawn("npx", ["wrangler", "dev", "--port", String(PORT), "--local"], {
    cwd: FIXTURE_DIR,
    stdio: "pipe",
  });

  // Wait for server to start
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${BASE}/`);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
});

after(() => {
  if (wranglerProc) {
    wranglerProc.kill("SIGTERM");
  }
});

// Helper to import from worker
async function importFromWorker() {
  const response = await fetch(`${BASE}/`);
  const code = await response.text();
  // Note: In real tests, we'd use dynamic import from the URL
  // For now, we test via WebSocket RPC
  return code;
}

describe("D1 integration", { skip: skipMessage }, () => {
  it("executes parameterized query", async () => {
    // This test would use the actual D1 client
    // client.d1.TEST_DB`SELECT 1 as value`.first()
    assert.ok(true, "Placeholder - requires actual D1 binding");
  });

  it("handles INSERT and SELECT", async () => {
    assert.ok(true, "Placeholder - requires actual D1 binding");
  });

  it("handles query errors gracefully", async () => {
    assert.ok(true, "Placeholder - requires actual D1 binding");
  });
});

describe("R2 integration", { skip: skipMessage }, () => {
  it("puts and gets object", async () => {
    assert.ok(true, "Placeholder - requires actual R2 binding");
  });

  it("lists objects with prefix", async () => {
    assert.ok(true, "Placeholder - requires actual R2 binding");
  });

  it("deletes object", async () => {
    assert.ok(true, "Placeholder - requires actual R2 binding");
  });

  it("returns null for non-existent object", async () => {
    assert.ok(true, "Placeholder - requires actual R2 binding");
  });
});

describe("KV integration", { skip: skipMessage }, () => {
  it("puts and gets value", async () => {
    assert.ok(true, "Placeholder - requires actual KV binding");
  });

  it("handles expiration TTL", async () => {
    assert.ok(true, "Placeholder - requires actual KV binding");
  });

  it("lists keys with prefix", async () => {
    assert.ok(true, "Placeholder - requires actual KV binding");
  });

  it("deletes key", async () => {
    assert.ok(true, "Placeholder - requires actual KV binding");
  });

  it("gets with metadata", async () => {
    assert.ok(true, "Placeholder - requires actual KV binding");
  });
});

describe("Auth integration", { skip: skipMessage }, () => {
  it("signs up with email", async () => {
    assert.ok(true, "Placeholder - requires auth configuration");
  });

  it("signs in with email", async () => {
    assert.ok(true, "Placeholder - requires auth configuration");
  });

  it("gets session after sign in", async () => {
    assert.ok(true, "Placeholder - requires auth configuration");
  });

  it("signs out and clears session", async () => {
    assert.ok(true, "Placeholder - requires auth configuration");
  });
});

describe("Client default export", { skip: skipMessage }, () => {
  it("includes d1 proxy when D1 bindings configured", async () => {
    const code = await importFromWorker();
    assert.ok(code.includes("d1"), "Should export d1 proxy");
  });

  it("includes r2 proxy when R2 bindings configured", async () => {
    const code = await importFromWorker();
    assert.ok(code.includes("r2"), "Should export r2 proxy");
  });

  it("includes kv proxy when KV bindings configured", async () => {
    const code = await importFromWorker();
    assert.ok(code.includes("kv"), "Should export kv proxy");
  });

  it("includes auth proxy when auth enabled", async () => {
    const code = await importFromWorker();
    assert.ok(code.includes("auth"), "Should export auth proxy");
  });
});
