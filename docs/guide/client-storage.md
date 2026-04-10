# Client Storage

Access Cloudflare D1 databases, R2 object storage, and KV namespaces directly from the client.

## Configuration

Add bindings to your `package.json`:

```json
{
  "name": "my-app",
  "exports": "./src",
  "export": {
    "d1": ["MY_DB", "ANALYTICS_DB"],
    "r2": ["UPLOADS"],
    "kv": ["SESSIONS"]
  }
}
```

Binding names must be `UPPER_SNAKE_CASE`. When you run `npm run dev` or `npm run export`, the appropriate `wrangler.toml` sections are generated automatically.

## Importing the Client

The client object is available as the **default export**:

```javascript
import client from "https://my-worker.workers.dev/";

// Or destructure alongside named exports
import client, { greet, Counter } from "https://my-worker.workers.dev/";
```

## D1 Database

Query D1 databases using tagged template literals for automatic parameter binding:

```javascript
const { d1 } = client;

// Simple query (returns all rows)
const users = await d1.MY_DB`SELECT * FROM users`;

// Parameterized queries (safe from SQL injection)
const userId = 123;
const user = await d1.MY_DB`SELECT * FROM users WHERE id = ${userId}`.first();

// Insert with parameters
const name = "Alice";
const email = "alice@example.com";
await d1.MY_DB`INSERT INTO users (name, email) VALUES (${name}, ${email})`.run();

// Complex queries
const active = true;
const limit = 10;
const results = await d1.MY_DB`
  SELECT * FROM users
  WHERE active = ${active}
  ORDER BY created_at DESC
  LIMIT ${limit}
`.all();
```

### Query Methods

| Method | Returns |
|--------|---------|
| `.all()` | `{ results: T[], success: boolean, meta: object }` |
| `.first()` | First row or `null` |
| `.first(column)` | Value of specific column from first row |
| `.run()` | `{ success: boolean, meta: object }` for INSERT/UPDATE/DELETE |
| `.raw()` | Array of arrays (raw rows without column names) |

The default behavior (calling the query directly) is equivalent to `.all()`.

## R2 Object Storage

Store and retrieve files from R2 buckets:

```javascript
const { r2 } = client;

// Get an object
const file = await r2.UPLOADS.get("images/photo.jpg");
if (file) {
  const data = file.body;  // Uint8Array
  const contentType = file.httpMetadata?.contentType;
}

// Put an object
await r2.UPLOADS.put("documents/report.pdf", pdfData, {
  httpMetadata: { contentType: "application/pdf" }
});

// Delete an object
await r2.UPLOADS.delete("temp/old-file.txt");

// List objects
const listing = await r2.UPLOADS.list({ prefix: "images/" });
for (const obj of listing.objects) {
  console.log(obj.key, obj.size);
}

// Check if object exists (without downloading)
const head = await r2.UPLOADS.head("images/photo.jpg");
if (head) {
  console.log("Size:", head.size);
}
```

## KV Key-Value Store

Fast, globally distributed key-value storage:

```javascript
const { kv } = client;

// Get a value
const session = await kv.SESSIONS.get("user:123");

// Get with type hint
const data = await kv.SESSIONS.get("config", { type: "json" });

// Put a value
await kv.SESSIONS.put("user:123", JSON.stringify({ loggedIn: true }));

// Put with expiration (TTL in seconds)
await kv.SESSIONS.put("temp:token", "abc123", { expirationTtl: 3600 });

// Delete a key
await kv.SESSIONS.delete("user:123");

// List keys
const keys = await kv.SESSIONS.list({ prefix: "user:" });
for (const key of keys.keys) {
  console.log(key.name);
}

// Get with metadata
const result = await kv.SESSIONS.getWithMetadata("user:123");
console.log(result.value, result.metadata);
```

## Creating Bindings

After configuring `package.json`, you need to create the actual resources in Cloudflare:

```bash
# Create D1 database
wrangler d1 create my-app-my-db

# Create R2 bucket
wrangler r2 bucket create my-app-uploads

# Create KV namespace
wrangler kv namespace create SESSIONS
```

Update the generated `wrangler.toml` with the returned IDs before deploying.

## Server-Side Access

On the server side, bindings are available via the standard Cloudflare `env` object:

```typescript
// src/index.ts
export async function getUser(id: number, env: Env) {
  const user = await env.MY_DB.prepare("SELECT * FROM users WHERE id = ?")
    .bind(id)
    .first();
  return user;
}
```

The client storage feature gives browser clients the same access pattern, with all operations proxied through WebSocket.
