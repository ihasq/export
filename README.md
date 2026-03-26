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

That's your entire API. Deploy with `npm run export`.

## Import from Anywhere

### All exports at once

```javascript
import { greet, add, Counter } from "https://my-worker.workers.dev/";
```

### Individual exports by path

```javascript
import greet from "https://my-worker.workers.dev/greet";
import Counter from "https://my-worker.workers.dev/Counter";
```

### In Deno (with full type inference)

```typescript
import { greet } from "https://my-worker.workers.dev/";

const msg = await greet("World");  // string - types just work
```

## Shared Exports

Multiple clients can share the same state via [Durable Objects](https://developers.cloudflare.com/durable-objects/). Just add `?shared` to the import URL:

```javascript
// Client A
import { Counter } from "https://my-worker.workers.dev/?shared";
const counter = await new Counter(0);
await counter.increment();  // 1

// Client B (different browser, same URL)
import { Counter } from "https://my-worker.workers.dev/?shared";
await counter.increment();  // 2 -- sees Client A's state!
```

From within another Worker, the shared state is accessible via native [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/) -- no serialization overhead:

```typescript
import { Counter } from "./.export-shared.js";
const counter = await new Counter(0);
await counter.increment();  // Direct DO call, no devalue, no WebSocket
```

Shared exports use a single Durable Object instance per room. Rooms are `"default"` unless specified via `?shared&room=lobby`.

## Streaming

### AsyncIterator

```javascript
import { countUp } from "https://my-worker.workers.dev/";

for await (const num of await countUp(1, 5)) {
  console.log(num);  // 1, 2, 3, 4, 5
}
```

### ReadableStream

```javascript
import { streamData } from "https://my-worker.workers.dev/";

const reader = (await streamData(10)).getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

## Classes

Classes work like [Comlink](https://github.com/nicolo-ribaudo/comlink) -- instantiate remotely, call methods, clean up when done:

```javascript
import { Counter } from "https://my-worker.workers.dev/";

const counter = await new Counter(10);
await counter.increment();  // 11
await counter.increment();  // 12
await counter.getCount();   // 12

// Cleanup (optional -- auto-cleaned on disconnect)
await counter[Symbol.dispose]();
```

## Rich Data Types

Powered by [devalue](https://github.com/sveltejs/devalue), all structured-clonable types round-trip seamlessly:

`string` `number` `boolean` `null` `undefined` `Date` `RegExp` `Map` `Set` `BigInt` `URL` `URLSearchParams` `ArrayBuffer` `Uint8Array` `Int32Array` *(all TypedArrays)* `nested objects` `arrays` `circular references`

## How It Works

1. You write normal `export` functions and classes on the server
2. When a client imports your Worker URL, a tiny ESM module is returned
3. That module opens a WebSocket and creates [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) objects for each export
4. Function calls are serialized and sent over WebSocket; results come back as promises
5. The core client (~5KB, minified with [oxc](https://oxc.rs)) is served with immutable caching -- only fetched once

For shared exports, the Worker bridges WebSocket messages to a Durable Object via native Workers RPC. No double serialization.

## Deploy

```bash
npm run export
```

This generates types (via [oxc-parser](https://oxc.rs)), minifies the client, and deploys to Cloudflare.

## Packages

| Package | Description |
|---------|-------------|
| [`create-export`](https://www.npmjs.com/package/create-export) | `npm create export` -- scaffold a new project |
| [`export-runtime`](https://www.npmjs.com/package/export-runtime) | The runtime that powers everything |

## Requirements

- Node.js 18+
- Cloudflare Workers account ([free tier](https://developers.cloudflare.com/workers/platform/pricing/) works)

## License

[MIT](LICENSE)
