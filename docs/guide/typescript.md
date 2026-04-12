---
description: "Precise TypeScript type definitions generated automatically. Full type inference in Deno via X-TypeScript-Types header, auto-generated types in Vite projects."
---

# TypeScript

## Automatic Types in Vite Projects

When using `exportc` with Vite, TypeScript types are **automatically generated** from your actual export code. No manual type maintenance required.

```typescript
// Your server code (export/index.ts)
export async function greet(name: string) {
  return `Hello, ${name}!`;
}

export class Counter {
  private count: number;
  constructor(initial = 0) { this.count = initial; }
  increment() { return ++this.count; }
}
```

```typescript
// Auto-generated (export-env.d.ts)
declare module "export/" {
  export declare function greet(name: string): Promise<string>;
  export declare class Counter {
    constructor(initial?: number);
    increment(): Promise<number>;
    [Symbol.dispose](): Promise<void>;
  }
}
```

The Vite plugin:
- Generates types when `npm run dev` starts
- Watches for changes and regenerates automatically
- Creates proper `declare module "export/"` statements

## Automatic Type Inference in Deno

Deno reads the `X-TypeScript-Types` header and fetches type definitions automatically:

```typescript
import { greet, Counter } from "https://my-worker.workers.dev/";

const msg = await greet("World");  // msg: string
const counter = await new Counter(0);
await counter.increment();          // number
```

No configuration needed. Types are served at `/?types` and referenced by the header.

## Precise Types with oxc-parser

At build time, `generate-export-types` uses [oxc-parser](https://oxc.rs) to statically analyze your TypeScript source. The resulting types preserve parameter names and types:

```typescript
// Your source
export function greet(name: string): Promise<string> { ... }
export function add(a: number, b: number): number { ... }
export class Counter {
  constructor(initial?: number);
  increment(): number;
}

// Generated types (served at /?types)
export declare function greet(name: string): Promise<string>;
export declare function add(a: number, b: number): Promise<number>;
export declare class Counter {
  constructor(initial?: number);
  increment(): Promise<number>;
  // ...
}
```

All return types are wrapped in `Promise` since every call is async over the network. Private class fields are excluded.

## Fetching Types Manually

```bash
# Full type definitions
curl "https://my-worker.workers.dev/?types"

# Per-export types
curl "https://my-worker.workers.dev/greet?types"
```

Per-export types re-export from the root `/?types`, so the full definitions are only fetched once.
