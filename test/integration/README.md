# Integration Tests

These tests require actual Cloudflare bindings (D1, R2, KV) and cannot run in the standard test suite.

## Setup

1. Create the integration fixture:

```bash
mkdir -p test/fixture-integration
cd test/fixture-integration
npm init -y
npm install export-runtime@file:../../packages/export-runtime
```

2. Create `package.json`:

```json
{
  "name": "export-integration-test",
  "type": "module",
  "exports": "./src",
  "cloudflare": {
    "d1": ["TEST_DB"],
    "r2": ["TEST_BUCKET"],
    "kv": ["TEST_KV"],
    "auth": true
  }
}
```

3. Create test source `src/index.ts`:

```typescript
export function ping() {
  return "pong";
}
```

4. Create the actual Cloudflare resources:

```bash
# D1 database
wrangler d1 create export-integration-test-db
# Copy the database_id to wrangler.toml

# R2 bucket
wrangler r2 bucket create export-integration-test-bucket

# KV namespace
wrangler kv namespace create TEST_KV
# Copy the id to wrangler.toml
```

5. Generate types and update wrangler.toml with the IDs:

```bash
npx generate-export-types
# Edit wrangler.toml to add the database_id and kv id
```

6. Initialize the D1 database:

```bash
wrangler d1 execute TEST_DB --local --command "CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, value TEXT)"
```

## Running

```bash
npm run test:integration
```

Or run individual test files:

```bash
node --test test/integration/client-storage.test.mjs
```

## Notes

- These tests use `--local` mode for wrangler dev
- For full cloud testing, deploy to a test worker and update the BASE URL
- Auth tests require better-auth to be properly configured with a BETTER_AUTH_SECRET
