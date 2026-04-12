# exportc

Add [export](https://github.com/ihasq/export) to existing Vite projects. One command sets up server-side functions with full TypeScript support.

## Quick Start

```bash
# In your existing Vite project
npx exportc init

# Start development (Vite + Wrangler auto-start)
npm run dev

# Build and deploy to Workers Sites
npm run export
```

That's it. Dependencies are installed automatically.

## What You Get

- **Single command dev** -- `npm run dev` starts both Vite and Wrangler
- **Auto-generated types** -- TypeScript definitions from your actual code
- **Workers Sites deploy** -- Static assets + server exports in one deployment
- **Zero config** -- Production URL auto-detected from package name

## Usage

After initialization, import your server exports using the `export/` prefix:

```typescript
// In your Vite app
import { hello, Counter } from "export/";

const message = await hello("World");  // "Hello, World!"

const counter = await new Counter(0);
await counter.increment();  // 1
```

## Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite + Wrangler together (auto-generates types) |
| `npm run export` | Build Vite app and deploy to Workers Sites |
| `exportc init` | Initialize export in your project |
| `exportc dev` | Start Wrangler dev server standalone |
| `exportc deploy` | Deploy exports only |

## Vite Plugin

The `exportPlugin` handles everything automatically:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { exportPlugin } from "exportc/vite";

export default defineConfig({
  plugins: [exportPlugin()],
});
```

The production URL is auto-detected from `cloudflare.name` in package.json (e.g., `my-app-api` becomes `https://my-app-api.workers.dev`).

### Development (`npm run dev`)

1. Automatically starts Wrangler dev server in the background
2. Waits for it to be ready before serving your app
3. Generates `export-env.d.ts` with TypeScript declarations
4. Watches for changes and regenerates types automatically
5. Transforms `export/` imports to `http://localhost:8787`

### Production (`npm run export`)

1. Builds your Vite app with `vite build`
2. Generates types and wrangler.toml from `cloudflare` config
3. Deploys to Workers Sites (static assets + server exports)
4. `export/` imports resolve to `https://{cloudflare.name}.workers.dev`

## Project Structure

After running `exportc init`:

```
my-vite-app/
├── src/                    # Your Vite app (unchanged)
├── export/                 # Server exports (Cloudflare Worker)
│   ├── index.ts           # Your server code
│   ├── package.json       # Minimal (dependencies only)
│   └── .gitignore         # Generated files excluded
├── export-env.d.ts        # TypeScript declarations (auto-generated)
├── package.json           # Contains cloudflare config
└── vite.config.ts         # Updated with exportPlugin
```

Configuration is in the root `package.json`:

```json
{
  "cloudflare": {
    "name": "my-vite-app-api",
    "exports": "./export",
    "assets": "./dist"
  }
}
```

## TypeScript Support

The `export-env.d.ts` file is **automatically generated** when you run `npm run dev`. The Vite plugin watches for changes to your export files and regenerates type declarations automatically.

```typescript
// export-env.d.ts (auto-generated)
declare module "export/" {
  export function hello(name: string): Promise<string>;
  export class Counter {
    constructor(initial?: number);
    increment(): Promise<number>;
    [Symbol.dispose](): Promise<void>;
  }
}

declare module "export/utils" {
  export function formatDate(date: Date): Promise<string>;
}
```

Types are inferred from your actual export code, so you get accurate type information with zero manual maintenance.

## License

MIT
