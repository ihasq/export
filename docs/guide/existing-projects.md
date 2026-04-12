---
description: "Add export to an existing Vite project with exportc CLI."
---

# Add to Existing Projects

Use `exportc` to add export to your existing Vite project.

## Quick Start

```bash
# In your existing Vite project
npx exportc init

# Install export dependencies
cd export && npm install && cd ..

# Start development (Wrangler auto-starts!)
npm run dev
```

## Development

Just run your normal Vite dev command:

```bash
npm run dev
```

The export plugin automatically:
1. Starts Wrangler dev server in the background
2. Waits for it to be ready
3. Transforms `export:/` imports to point to the local server

Then import your server exports:

```typescript
import { hello, Counter } from "export:/";

const message = await hello("World");  // "Hello, World!"

const counter = await new Counter(0);
await counter.increment();  // 1
```

## Project Structure

After initialization:

```
my-vite-app/
├── src/                    # Your Vite app (unchanged)
├── export/                 # Server exports (new)
│   ├── index.ts           # Your server code
│   ├── package.json       # Worker configuration
│   └── .gitignore
├── export-env.d.ts        # TypeScript declarations (new)
└── vite.config.ts         # Updated with exportPlugin
```

## Writing Exports

Edit `export/index.ts` to add your server-side code:

```typescript
// export/index.ts

export async function fetchUser(id: string) {
  const res = await fetch(`https://api.example.com/users/${id}`);
  return res.json();
}

export async function saveData(data: object) {
  // Server-side only - API keys stay secure
  await fetch("https://api.example.com/data", {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.API_KEY}` },
    body: JSON.stringify(data),
  });
}

export class Session {
  private data: Map<string, unknown>;

  constructor() {
    this.data = new Map();
  }

  set(key: string, value: unknown) {
    this.data.set(key, value);
  }

  get(key: string) {
    return this.data.get(key);
  }
}
```

## Import Syntax

Use the `export:/` prefix to import your server exports:

```typescript
// Root exports
import { fetchUser, Session } from "export:/";

// Subpath exports (if you have export/utils/index.ts)
import { formatDate } from "export:/utils";

// Single export
import fetchUser from "export:/fetchUser";
```

## TypeScript Support

Update `export-env.d.ts` when you add new exports:

```typescript
// export-env.d.ts
declare module "export:/" {
  export function fetchUser(id: string): Promise<User>;
  export function saveData(data: object): Promise<void>;
  export class Session {
    constructor();
    set(key: string, value: unknown): Promise<void>;
    get(key: string): Promise<unknown>;
    [Symbol.dispose](): Promise<void>;
  }
}

declare module "export:/utils" {
  export function formatDate(date: Date): Promise<string>;
}
```

## Vite Plugin Options

Configure the plugin in `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { exportPlugin } from "exportc/vite";

export default defineConfig({
  plugins: [
    exportPlugin({
      // Development server URL (default: http://localhost:8787)
      dev: "http://localhost:8787",

      // Production Worker URL (required for production builds)
      production: "https://my-api.workers.dev",
    }),
  ],
});
```

## Deploy

Deploy your exports to Cloudflare Workers:

```bash
npm run export:deploy
```

Then update your Vite config with the production URL:

```typescript
exportPlugin({
  production: "https://my-api.workers.dev",
})
```

## Commands

| Command | Description |
|---------|-------------|
| `exportc init` | Initialize export in your project |
| `exportc dev` | Start Wrangler dev server |
| `exportc deploy` | Deploy to Cloudflare Workers |
| `npm run export:dev` | Alias for `exportc dev` |
| `npm run export:deploy` | Alias for `exportc deploy` |

## Cloudflare Bindings

Add D1, R2, or KV bindings in `export/package.json`:

```json
{
  "name": "my-api",
  "exports": "./",
  "cloudflare": {
    "d1": ["MY_DB"],
    "r2": ["MY_BUCKET"],
    "kv": ["MY_KV"]
  }
}
```

Then import the client in your Vite app:

```typescript
import client from "export:/";

const users = await client.d1.MY_DB`SELECT * FROM users`;
```
