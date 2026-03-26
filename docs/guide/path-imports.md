---
description: "Import individual exports by URL path, like esm.sh. The ~5KB core module is immutably cached for instant subsequent imports."
---

# Path-based Imports

You can import individual exports by adding the export name to the URL path, similar to [esm.sh](https://esm.sh).

## Usage

```javascript
// Import everything from the root
import { greet, Counter } from "https://my-worker.workers.dev/";

// Or import a single export by path
import greet from "https://my-worker.workers.dev/greet";
import Counter from "https://my-worker.workers.dev/Counter";
```

Each path provides both a default export and a named export:

```javascript
import greetDefault from "https://my-worker.workers.dev/greet";
import { greet } from "https://my-worker.workers.dev/greet";
// Both work
```

## How it works

When you request `GET /greet`, the server returns a tiny module (~130 bytes):

```javascript
import { createProxy } from "./<uuid>.js";
const _export = createProxy(["greet"]);
export default _export;
export { _export as greet };
```

The `<uuid>.js` core module is shared across all imports and cached immutably by the browser. Only the first import fetches the ~5KB core; subsequent path imports are near-instant.

## Type definitions

Each path also serves scoped types:

```
GET /greet?types
→ export { greet as default, greet } from "./?types";
```

The full type definitions at `/?types` are the single source of truth. Per-path types simply re-export from there, keeping the payload minimal.
