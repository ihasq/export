---
description: "Add export to an existing Vite project with exportc CLI. Auto-starts Wrangler, auto-generates TypeScript types, and deploys to Workers Sites."
---

# Add to Existing Projects

Use `exportc` to add export to your existing Vite project. One command sets up everything.

## Quick Start

```bash
# In your existing Vite project
npx exportc init

# Start development (Wrangler auto-starts!)
npm run dev

# Deploy to Workers Sites
npm run export
```

That's it. Dependencies are installed automatically, just like shadcn.

## How It Works

The `exportPlugin` for Vite handles everything automatically:

1. **Auto-starts Wrangler** -- no separate terminal needed
2. **Auto-generates TypeScript types** -- full autocompletion from your actual code
3. **Transforms `export/` imports** -- resolves to local dev server or production URL
4. **Hot reloads types** -- regenerates `export-env.d.ts` when your exports change

## Development

Just run your normal Vite dev command:

```bash
npm run dev
```

The export plugin automatically:
1. Starts Wrangler dev server in the background
2. Waits for it to be ready
3. Generates `export-env.d.ts` from your export code
4. Transforms `export/` imports to `http://localhost:8787`
5. Watches for changes and regenerates types

Import your server exports:

```typescript
import { hello, Counter } from "export/";

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

Use the `export/` prefix to import your server exports:

```typescript
// Root exports
import { fetchUser, Session } from "export/";

// Subpath exports (if you have export/utils/index.ts)
import { formatDate } from "export/utils";

// Single export
import fetchUser from "export/fetchUser";
```

## TypeScript Support

TypeScript declarations are **automatically generated** when you run `npm run dev`. The Vite plugin watches for changes to your export files and regenerates `export-env.d.ts` automatically.

```typescript
// export-env.d.ts (auto-generated - do not edit manually)
declare module "export/" {
  export function fetchUser(id: string): Promise<User>;
  export function saveData(data: object): Promise<void>;
  export class Session {
    constructor();
    set(key: string, value: unknown): Promise<void>;
    get(key: string): Promise<unknown>;
    [Symbol.dispose](): Promise<void>;
  }
}

declare module "export/utils" {
  export function formatDate(date: Date): Promise<string>;
}
```

Types are inferred from your actual export code, providing accurate autocompletion and type checking with zero manual maintenance.

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

Deploy your entire app (Vite frontend + server exports) to Cloudflare Workers Sites:

```bash
npm run export
```

This command:
1. Builds your Vite app (`vite build`)
2. Deploys static assets + server exports to Workers Sites
3. Your app is now live at `https://{worker-name}.workers.dev`

The production URL is auto-detected from `export/package.json` name field. Override it in your Vite config if needed:

```typescript
exportPlugin({
  production: "https://custom-domain.workers.dev",
})
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite + Wrangler together |
| `npm run export` | Build Vite app and deploy to Workers Sites |
| `exportc init` | Initialize export in your project |
| `exportc dev` | Start Wrangler dev server standalone |
| `exportc deploy` | Deploy exports only (without Vite build) |

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
import client from "export/";

const users = await client.d1.MY_DB`SELECT * FROM users`;
```
