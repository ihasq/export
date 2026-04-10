---
description: "export lets you write normal functions and classes on a Cloudflare Worker, then import them from any client using just the Worker URL."
---

# What is export?

**export** lets you write normal functions and classes on a Cloudflare Worker, then `import` them from any client -- browser, Node.js, Deno, or another Worker -- using just the Worker URL.

```javascript
// On the server: write functions as usual
export function greet(name) {
  return `Hello, ${name}!`;
}

// On the client: import from the Worker URL
import { greet } from "https://my-worker.workers.dev/";
await greet("World");  // "Hello, World!"
```

No SDK. No code generation. No client-side build step.

## How it works

1. Your Worker exports functions and classes in `src/index.ts`
2. When a client imports the Worker URL, a tiny ESM glue module is returned
3. That module opens a WebSocket and creates [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy) objects for each export
4. Function calls are serialized with [devalue](https://github.com/sveltejs/devalue) and sent over WebSocket
5. Results come back as promises

The core client library (~5KB) is served with immutable caching and changes path on each deploy for automatic cache busting.

## Key features

- **Zero-config client** -- just `import` from a URL
- **Path-based imports** -- `import greet from ".../greet"`
- **Static assets** -- serve HTML, CSS, and images alongside your API
- **Classes** -- remote instantiation with Comlink-style proxies
- **Streaming** -- ReadableStream and AsyncIterator support
- **Shared exports** -- cross-client shared state via Durable Objects
- **TypeScript** -- precise types generated at build time with oxc-parser
- **Rich serialization** -- Date, Map, Set, BigInt, URL, TypedArrays, and more
- **Single config** -- everything in `package.json`, `wrangler.toml` is auto-generated
