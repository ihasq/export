# exportc

Add [export](https://github.com/ihasq/export) to existing Vite projects.

## Quick Start

```bash
# In your existing Vite project
npx exportc init

# Install export dependencies
cd export && npm install && cd ..

# Start development (Wrangler starts automatically!)
npm run dev

# Deploy to Cloudflare Workers Sites
npm run export
```

## Usage

After initialization, import your server exports using the `export:/` prefix:

```typescript
// In your Vite app
import { hello, Counter } from "export:/";

const message = await hello("World");  // "Hello, World!"

const counter = await new Counter(0);
await counter.increment();  // 1
```

## Commands

### `exportc init`

Initialize export in your Vite project:
- Creates `export/` directory with example server code
- Updates `vite.config.ts` with the export plugin
- Adds npm scripts for development and deployment

### `exportc dev`

Start the Wrangler development server for your exports.

### `exportc deploy`

Deploy your exports to Cloudflare Workers.

## Vite Plugin

The `exportPlugin` automatically starts Wrangler and transforms `export:/` imports:

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { exportPlugin } from "exportc/vite";

export default defineConfig({
  plugins: [
    exportPlugin(),
    // Production URL is auto-detected from export/package.json name
    // Override with: exportPlugin({ production: "https://custom.workers.dev" })
  ],
});
```

**Development** (`npm run dev`):
1. Automatically starts Wrangler dev server
2. Waits for it to be ready
3. Transforms `export:/` imports to `http://localhost:8787`

**Production** (`npm run export`):
1. Builds Vite app
2. Deploys to Workers Sites (static assets + server exports)
3. `export:/` imports resolve to `https://{worker-name}.workers.dev`

## Project Structure

After running `exportc init`:

```
my-vite-app/
├── src/                    # Your Vite app
├── export/                 # Server exports (Cloudflare Worker)
│   ├── index.ts           # Your server code
│   └── package.json       # Worker configuration
├── export-env.d.ts        # TypeScript declarations
└── vite.config.ts         # Updated with exportPlugin
```

## TypeScript Support

The `export-env.d.ts` file provides type declarations for `export:/` imports. Update it when you add new exports:

```typescript
// export-env.d.ts
declare module "export:/" {
  export function hello(name: string): Promise<string>;
  export function myNewFunction(): Promise<void>;
}

declare module "export:/utils" {
  export function formatDate(date: Date): Promise<string>;
}
```

## License

MIT
