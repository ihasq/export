---
description: "Export classes from your Worker and instantiate them remotely. Comlink-style proxy with full method calls, property access, and cleanup."
---

# Classes

Export a class on the server, instantiate it remotely on the client. Instances live on the server and are accessed through proxies, similar to [Comlink](https://github.com/nicolo-ribaudo/comlink).

## Basic usage

**Server:**

```typescript
export class Counter {
  private count: number;
  constructor(initial = 0) { this.count = initial; }
  increment() { return ++this.count; }
  decrement() { return --this.count; }
  getCount() { return this.count; }
}
```

**Client:**

```javascript
import { Counter } from "https://my-worker.workers.dev/";

const counter = await new Counter(10);
await counter.increment();  // 11
await counter.increment();  // 12
await counter.getCount();   // 12
```

## Properties

You can read and write public properties:

```javascript
const counter = await new Counter(0);
// Properties are accessed as async calls
```

## Cleanup

Instances are automatically cleaned up when the WebSocket disconnects. You can also release them manually:

```javascript
// Using Symbol.dispose
await counter[Symbol.dispose]();

// Or using the release method
await counter["[release]"]();
```

## How it works

When you call `new Counter(10)`:

1. A `construct` message is sent to the server
2. The server creates the instance and stores it with a unique ID
3. A proxy is returned to the client
4. Method calls on the proxy become `call` messages with the instance ID
5. The server looks up the instance, calls the method, and returns the result

Each WebSocket connection has its own instance store. Instances on one connection are not visible to another (unless you use [Shared Exports](/guide/shared-exports)).
