# Streaming

Functions that return `ReadableStream` or `AsyncGenerator` are automatically proxied to the client.

## AsyncIterator

**Server:**

```typescript
export async function* countUp(start: number, end: number) {
  for (let i = start; i <= end; i++) {
    await new Promise((r) => setTimeout(r, 100));
    yield i;
  }
}
```

**Client:**

```javascript
import { countUp } from "https://my-worker.workers.dev/";

for await (const num of await countUp(1, 5)) {
  console.log(num);  // 1, 2, 3, 4, 5
}
```

The async iterator protocol is fully supported -- `next()` pulls values on demand, and `return()` terminates early.

## ReadableStream

**Server:**

```typescript
export function streamData(count: number): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream({
    async pull(controller) {
      if (i >= count) { controller.close(); return; }
      controller.enqueue(new TextEncoder().encode(`chunk-${i++}\n`));
    },
  });
}
```

**Client:**

```javascript
import { streamData } from "https://my-worker.workers.dev/";

const reader = (await streamData(10)).getReader();
while (true) {
  const { value, done } = await reader.read();
  if (done) break;
  console.log(new TextDecoder().decode(value));
}
```

You can also cancel a stream mid-read:

```javascript
await reader.cancel();
```
