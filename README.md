# export

**Turn any Cloudflare Worker into an importable ES module.**

Write functions on the server. Import them on the client. That's it.

[![npm version](https://img.shields.io/npm/v/export-runtime.svg)](https://www.npmjs.com/package/export-runtime)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

```javascript
import { greet, Counter } from "https://my-worker.workers.dev/";

await greet("World");                 // "Hello, World!"

const counter = await new Counter(0);
await counter.increment();            // 1
```

No SDK. No code generation. No build step on the client. Just `import`.

## Getting Started

```bash
npm create export my-app
cd my-app
npm install
npm run dev
```

Write your server code:

```typescript
// src/index.ts
export async function greet(name: string) {
  return `Hello, ${name}!`;
}

export class Counter {
  private count: number;
  constructor(initial = 0) { this.count = initial; }
  increment() { return ++this.count; }
  getCount() { return this.count; }
}
```

Deploy with `npm run export`. Your `src/` directory is now your API.

### Add to Existing Project

Already have a Vite project? Add export with a single command:

```bash
npx exportc init
```

Then import your server exports:

```typescript
// In your Vite app
import { greet, Counter } from "export/";

const message = await greet("World");  // "Hello, World!"

const counter = await new Counter(0);
await counter.increment();  // 1
```

The Vite plugin:
- **Auto-starts Wrangler** when you run `npm run dev`
- **Auto-generates TypeScript types** from your export code
- **Transforms imports** to the local dev server or production URL

Deploy everything with `npm run export` -- builds your Vite app and deploys to Workers Sites.

## Configuration

All configuration lives in `package.json` under the `cloudflare` field:

```json
{
  "name": "my-export-app",
  "cloudflare": {
    "name": "my-export-app",
    "exports": "./src",
    "assets": "./public",
    "d1": ["MY_DB"],
    "r2": ["MY_BUCKET"],
    "kv": ["MY_KV"]
  },
  "security": {
    "access": {
      "origin": ["https://example.com"]
    }
  }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `cloudflare.name` | Yes | Worker name (used for deployment) |
| `cloudflare.exports` | Yes | Source entry point (`./src` or `./src/index.ts`) |
| `cloudflare.assets` | No | Static assets directory (e.g., `./public`, `./dist`) |
| `cloudflare.d1` | No | D1 database bindings |
| `cloudflare.r2` | No | R2 bucket bindings |
| `cloudflare.kv` | No | KV namespace bindings |
| `cloudflare.auth` | No | Enable better-auth integration |
| `security` | No | Security settings (origin restrictions, etc.) |

The `wrangler.toml` is auto-generated at build time -- you don't need to manage it.

## File-based Routing

Your file structure maps directly to URL paths:

```
src/
├── index.ts          → https://worker.dev/
├── greet.ts          → https://worker.dev/greet
├── Counter.ts        → https://worker.dev/Counter
└── utils/
    └── math.ts       → https://worker.dev/utils/math
```

```javascript
// Import a whole module
import { multiply, PI } from "https://worker.dev/utils/math";

// Import a single export
import multiply from "https://worker.dev/utils/math/multiply";

// Root module
import { greet } from "https://worker.dev/";
```

Each module gets its own type definitions at `?types`:

```bash
curl "https://worker.dev/utils/math?types"
```

> **Note:** `export default` is ignored. Use named exports only.

## Static Assets

Serve static files (HTML, CSS, images) alongside your API by setting `cloudflare.assets` in `package.json`:

```json
{
  "cloudflare": {
    "name": "my-app",
    "exports": "./src",
    "assets": "./public"
  }
}
```

```
my-app/
├── src/
│   └── index.ts      → API at /
├── public/
│   ├── index.html    → served at /
│   ├── style.css     → served at /style.css
│   └── app.js        → served at /app.js
└── package.json
```

- **API routes take precedence** -- `/greet` serves the RPC export, not a static file
- **Powered by [Cloudflare Static Assets](https://developers.cloudflare.com/workers/static-assets/)** -- globally cached, fast delivery

## Client Storage (D1, R2, KV)

Access Cloudflare storage directly from the client via the default export:

```javascript
import client, { greet } from "https://my-worker.workers.dev/";

// D1 Database with tagged template literals
const users = await client.d1.MY_DB`SELECT * FROM users WHERE active = ${true}`;
const user = await client.d1.MY_DB`SELECT * FROM users WHERE id = ${id}`.first();

// R2 Object Storage
const file = await client.r2.MY_BUCKET.get("images/logo.png");
await client.r2.MY_BUCKET.put("images/logo.png", imageData);

// KV Key-Value Store
const value = await client.kv.MY_KV.get("session:abc123");
await client.kv.MY_KV.put("session:abc123", JSON.stringify(session));
```

Configure bindings in `package.json`:

```json
{
  "cloudflare": {
    "d1": ["MY_DB"],
    "r2": ["MY_BUCKET"],
    "kv": ["MY_KV"],
    "auth": true
  }
}
```

Binding names must be `UPPER_SNAKE_CASE`. The `wrangler.toml` will be auto-generated with the correct bindings.

### Authentication

Enable authentication via [better-auth](https://better-auth.com):

```bash
# Add OAuth provider
npm run auth:add -- google YOUR_CLIENT_ID:YOUR_CLIENT_SECRET
npm run auth:add -- github YOUR_CLIENT_ID:YOUR_CLIENT_SECRET

# List/remove providers
npm run auth:list
npm run auth:remove -- google
```

Then use from the client:

```javascript
// Email/password
await client.auth.signUp.email("user@example.com", "password", "Name");
await client.auth.signIn.email("user@example.com", "password");

// OAuth (Google, GitHub, etc.)
await client.auth.signIn.social("google");

// Session
const user = await client.auth.getUser();
await client.auth.signOut();
```

## Security

### Origin Restrictions

By default, your Worker accepts requests from any origin (standard Cloudflare Workers behavior). To restrict access to specific origins:

```json
{
  "security": {
    "access": {
      "origin": ["https://example.com", "https://app.example.com"]
    }
  }
}
```

When `origin` is set:
- Only listed origins can access your Worker (HTTP and WebSocket)
- Requests from unlisted origins receive `403 Forbidden`
- CORS headers reflect the allowed origin instead of `*`

When `origin` is empty or omitted:
- All origins are allowed (default)
- CORS header is `Access-Control-Allow-Origin: *`

## Shared Exports

Multiple clients can share the same state via [Durable Objects](https://developers.cloudflare.com/durable-objects/). Add `?shared` to the import URL:

```javascript
// Client A
import { Counter } from "https://my-worker.workers.dev/?shared";
const counter = await new Counter(0);
await counter.increment();  // 1

// Client B (different browser, same URL)
import { Counter } from "https://my-worker.workers.dev/?shared";
await counter.increment();  // 2 -- sees Client A's state!
```

From within another Worker, shared state is accessible via native [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/) -- no serialization overhead:

```typescript
import { Counter } from "./.export-shared.js";
await counter.increment();  // Direct DO call, no devalue, no WebSocket
```

Rooms are `"default"` unless specified via `?shared=lobby`.

## Streaming

```javascript
// AsyncIterator
import { countUp } from "https://my-worker.workers.dev/";
for await (const num of await countUp(1, 5)) {
  console.log(num);  // 1, 2, 3, 4, 5
}

// ReadableStream
import { streamData } from "https://my-worker.workers.dev/";
const reader = (await streamData(10)).getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

## Classes

Instantiate remotely, call methods, clean up when done:

```javascript
import { Counter } from "https://my-worker.workers.dev/";

const counter = await new Counter(10);
await counter.increment();  // 11
await counter.getCount();   // 11

// Cleanup (optional -- auto-cleaned on disconnect)
await counter[Symbol.dispose]();
```

## Rich Data Types

Powered by [devalue](https://github.com/sveltejs/devalue), all structured-clonable types round-trip seamlessly:

`string` `number` `boolean` `null` `undefined` `Date` `RegExp` `Map` `Set` `BigInt` `URL` `URLSearchParams` `ArrayBuffer` `Uint8Array` `Int32Array` *(all TypedArrays)* `nested objects` `arrays` `circular references`

## Deno

Types are served via `X-TypeScript-Types` header -- full inference works automatically:

```typescript
import { greet } from "https://my-worker.workers.dev/";
const msg = await greet("World");  // string
```

## How It Works

1. `generate-export-types` reads `package.json`, scans the source directory, builds a module map, generates types with [oxc-parser](https://oxc.rs), minifies the ~5KB client core with [oxc-minify](https://oxc.rs), and generates `wrangler.toml`
2. When a client imports a URL, a tiny ESM module is returned that imports the cached core
3. The core opens a WebSocket and creates [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) objects for each export
4. Function calls are serialized with [devalue](https://github.com/sveltejs/devalue) and sent over WebSocket
5. For shared exports, the Worker bridges to a Durable Object via native Workers RPC

## Deploy

```bash
npm run export
```

## Packages

| Package | Description |
|---------|-------------|
| [`create-export`](https://www.npmjs.com/package/create-export) | `npm create export` -- scaffold a new project |
| [`exportc`](https://www.npmjs.com/package/exportc) | `npx exportc init` -- add export to existing Vite projects |
| [`export-runtime`](https://www.npmjs.com/package/export-runtime) | The runtime that powers everything |

## Documentation

[export-docs.pages.dev](https://export-docs.pages.dev)

## Requirements

- Node.js 18+
- Cloudflare Workers account ([free tier](https://developers.cloudflare.com/workers/platform/pricing/) works)

## License

[MIT](LICENSE)
