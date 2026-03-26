---
description: "Share state across multiple clients and Workers using Durable Objects. Add ?shared to the import URL for real-time collaboration."
---

# Shared Exports

By default, each client connection has its own isolated state. **Shared Exports** let multiple clients -- and even other Workers -- share the same state via [Durable Objects](https://developers.cloudflare.com/durable-objects/).

## Client-side usage

Add `?shared` to the import URL:

```javascript
import { Counter } from "https://my-worker.workers.dev/?shared";

const counter = await new Counter(0);
await counter.increment();  // 1
```

Any other client importing with `?shared` connects to the same Durable Object and sees the same state:

```javascript
// Another browser tab, another device, another continent
import { Counter } from "https://my-worker.workers.dev/?shared";
await counter.getCount();  // 1 -- sees the first client's increment
await counter.increment();  // 2
```

Everything that works in normal mode -- functions, classes, nested objects, streaming, iterators -- works in shared mode.

## Worker-side usage

From within another Worker, shared exports are available through native [Workers RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/). No serialization overhead, no WebSocket:

```typescript
import { Counter } from "./.export-shared.js";

const counter = await new Counter(0);
await counter.increment();  // Direct DO RPC call
```

The `.export-shared.js` module is generated at build time. It uses `import { env } from "cloudflare:workers"` to access the Durable Object binding.

## Rooms

By default, all shared clients connect to a single room called `"default"`. You can specify a room name to create isolated shared instances:

```javascript
import { Counter } from "https://my-worker.workers.dev/?shared&room=lobby";
import { Counter } from "https://my-worker.workers.dev/?shared&room=game-1";
// These are separate Durable Object instances
```

## Configuration

Shared exports require Durable Object bindings in `wrangler.toml`. The `create-export` template includes these by default:

```toml
[durable_objects]
bindings = [
  { name = "SHARED_EXPORT", class_name = "SharedExportDO" }
]

[[migrations]]
tag = "v1"
new_classes = ["SharedExportDO"]
```

## Architecture

```
Client A ──WebSocket──> Worker (bridge) ──Workers RPC──> Durable Object
Client B ──WebSocket──> Worker (bridge) ──Workers RPC──> ↑ same instance
Worker C ─────────────────────Workers RPC─────────────> ↑ same instance
```

- **Client to DO**: The Worker bridges WebSocket messages to the DO via Workers RPC. Only the WebSocket leg uses devalue serialization.
- **Worker to DO**: Direct Workers RPC -- native V8 serialization, streams and objects pass through natively.
- **Concurrency**: Durable Objects are single-threaded. Requests are processed sequentially, preventing race conditions.
