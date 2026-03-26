---
description: "Complete list of serializable types supported by export: Date, Map, Set, BigInt, URL, TypedArrays, ReadableStream, AsyncIterator, and more."
---

# Supported Types

All [structured-clonable](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm) types are supported via [devalue](https://github.com/sveltejs/devalue):

| Type | Example |
|------|---------|
| `string` | `"hello"` |
| `number` | `3.14`, `NaN`, `Infinity`, `-0` |
| `boolean` | `true`, `false` |
| `null` | `null` |
| `undefined` | `undefined` |
| `Date` | `new Date()` |
| `RegExp` | `/pattern/gi` |
| `Map` | `new Map([["a", 1]])` |
| `Set` | `new Set([1, 2, 3])` |
| `BigInt` | `42n` |
| `URL` | `new URL("https://example.com")` |
| `URLSearchParams` | `new URLSearchParams("a=1")` |
| `ArrayBuffer` | `new ArrayBuffer(8)` |
| TypedArrays | `Uint8Array`, `Int32Array`, `Float64Array`, etc. |
| Nested objects | `{ a: { b: [1, 2] } }` |
| Arrays | `[1, "two", null]` |
| Circular references | Handled automatically |

### Not supported

| Type | Reason |
|------|--------|
| `Function` | Cannot be serialized. Use exports instead. |
| `WeakMap` / `WeakRef` | Non-enumerable by design |
| DOM nodes | Browser-only objects |

### Streaming types

These are proxied rather than serialized:

| Type | Direction |
|------|-----------|
| `ReadableStream` | Server to client |
| `AsyncIterator` / `AsyncGenerator` | Server to client |
