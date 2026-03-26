---
description: "Create a new export project, write server exports, run locally, and deploy to Cloudflare Workers in minutes."
---

# Getting Started

## Create a new project

```bash
npm create export my-app
cd my-app
npm install
```

This scaffolds a project with everything you need:

```
my-app/
├── src/
│   └── index.ts       # Your exports
├── package.json
├── wrangler.toml
└── tsconfig.json
```

## Write your exports

Open `src/index.ts` and write whatever you want to expose:

```typescript
export async function greet(name: string) {
  return `Hello, ${name}!`;
}

export function add(a: number, b: number) {
  return a + b;
}

export class Counter {
  private count: number;
  constructor(initial = 0) { this.count = initial; }
  increment() { return ++this.count; }
  getCount() { return this.count; }
}
```

Every named export becomes remotely callable. Sync functions automatically become async on the client.

## Run locally

```bash
npm run dev
```

This starts a local Wrangler dev server. You can now import from `http://localhost:8787/`:

```javascript
import { greet } from "http://localhost:8787/";
await greet("World");  // "Hello, World!"
```

## Deploy

```bash
npm run export
```

This generates type definitions, minifies the client, and deploys to Cloudflare Workers. Your exports are now live at your Worker URL.

## Next steps

- [Path-based imports](/guide/path-imports) -- import individual exports
- [Classes](/guide/classes) -- remote class instantiation
- [Streaming](/guide/streaming) -- AsyncIterator and ReadableStream
- [Shared Exports](/guide/shared-exports) -- cross-client shared state
