// Shared RPC dispatch logic used by both handler.js (per-connection) and shared-do.js (shared state)

export const getByPath = (obj, path) => {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
};

export const isAsyncIterable = (value) =>
  value != null && typeof value[Symbol.asyncIterator] === "function";

export const isReadableStream = (value) =>
  value != null && typeof value.getReader === "function" && typeof value.pipeTo === "function";

export const isClass = (fn) =>
  typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));

// Creates a stateful RPC dispatcher over a set of exports.
// Returns an object with rpc* methods that manage instances, iterators, and streams.
export function createRpcDispatcher(exports) {
  const instanceStore = new Map();
  const iteratorStore = new Map();
  const streamStore = new Map();
  const writableStreamStore = new Map();
  let nextInstanceId = 1;
  let nextIteratorId = 1;
  let nextStreamId = 1;

  return {
    async rpcCall(path, args = []) {
      let target;
      let thisArg;
      target = getByPath(exports, path);
      thisArg = path.length > 1 ? getByPath(exports, path.slice(0, -1)) : undefined;

      if (typeof target !== "function") {
        throw new Error(`${path.join(".")} is not a function`);
      }

      const result = await target.apply(thisArg, args);

      if (isReadableStream(result)) {
        const streamId = nextStreamId++;
        streamStore.set(streamId, { stream: result, reader: null });
        return { type: "result", streamId, valueType: "readablestream" };
      } else if (isAsyncIterable(result)) {
        const iterId = nextIteratorId++;
        iteratorStore.set(iterId, result[Symbol.asyncIterator]());
        return { type: "result", iteratorId: iterId, valueType: "asynciterator" };
      } else if (typeof result === "function") {
        return { type: "result", path: [...path], valueType: "function" };
      }
      return { type: "result", value: result };
    },

    async rpcConstruct(path, args = []) {
      const Ctor = getByPath(exports, path);
      if (!isClass(Ctor)) {
        throw new Error(`${path.join(".")} is not a class`);
      }
      const instance = new Ctor(...args);
      const instId = nextInstanceId++;
      instanceStore.set(instId, instance);
      return { type: "result", instanceId: instId, valueType: "instance" };
    },

    async rpcInstanceCall(instanceId, path, args = []) {
      const instance = instanceStore.get(instanceId);
      if (!instance) throw new Error("Instance not found");
      const target = getByPath(instance, path);
      const thisArg = path.length > 1 ? getByPath(instance, path.slice(0, -1)) : instance;

      if (typeof target !== "function") {
        throw new Error(`${path.join(".")} is not a function`);
      }

      const result = await target.apply(thisArg, args);

      if (isReadableStream(result)) {
        const streamId = nextStreamId++;
        streamStore.set(streamId, { stream: result, reader: null });
        return { type: "result", streamId, valueType: "readablestream" };
      } else if (isAsyncIterable(result)) {
        const iterId = nextIteratorId++;
        iteratorStore.set(iterId, result[Symbol.asyncIterator]());
        return { type: "result", iteratorId: iterId, valueType: "asynciterator" };
      } else if (typeof result === "function") {
        return { type: "result", path: [...path], valueType: "function" };
      }
      return { type: "result", value: result };
    },

    async rpcGet(instanceId, path) {
      const instance = instanceStore.get(instanceId);
      if (!instance) throw new Error("Instance not found");
      const value = getByPath(instance, path);
      if (typeof value === "function") {
        return { type: "result", valueType: "function" };
      }
      return { type: "result", value };
    },

    async rpcSet(instanceId, path, value) {
      const instance = instanceStore.get(instanceId);
      if (!instance) throw new Error("Instance not found");
      const parent = path.length > 1 ? getByPath(instance, path.slice(0, -1)) : instance;
      parent[path[path.length - 1]] = value;
      return { type: "result", value: true };
    },

    async rpcRelease(instanceId) {
      instanceStore.delete(instanceId);
      return { type: "result", value: true };
    },

    async rpcIterateNext(iteratorId) {
      const iter = iteratorStore.get(iteratorId);
      if (!iter) throw new Error("Iterator not found");
      const { value, done } = await iter.next();
      if (done) iteratorStore.delete(iteratorId);
      return { type: "iterate-result", value, done: !!done };
    },

    async rpcIterateReturn(iteratorId) {
      const iter = iteratorStore.get(iteratorId);
      if (iter?.return) await iter.return(undefined);
      iteratorStore.delete(iteratorId);
      return { type: "iterate-result", value: undefined, done: true };
    },

    async rpcStreamRead(streamId) {
      const entry = streamStore.get(streamId);
      if (!entry) throw new Error("Stream not found");
      let reader = entry.reader;
      if (!reader) {
        reader = entry.stream.getReader();
        entry.reader = reader;
      }
      const { value, done } = await reader.read();
      if (done) streamStore.delete(streamId);
      const serializedValue = value instanceof Uint8Array ? Array.from(value) : value;
      return { type: "stream-result", value: serializedValue, done: !!done };
    },

    async rpcStreamCancel(streamId) {
      const entry = streamStore.get(streamId);
      if (entry) {
        try {
          if (entry.reader) await entry.reader.cancel();
          else await entry.stream.cancel();
        } catch { /* ignore */ }
        streamStore.delete(streamId);
      }
      return { type: "result", value: true };
    },

    async rpcWritableCreate() {
      let chunks = [];
      const writableId = nextStreamId++;
      writableStreamStore.set(writableId, { chunks });
      return { type: "result", writableId, valueType: "writablestream" };
    },

    async rpcWritableWrite(writableId, chunk) {
      const entry = writableStreamStore.get(writableId);
      if (!entry) throw new Error("WritableStream not found");
      const data = Array.isArray(chunk) ? new Uint8Array(chunk) : chunk;
      entry.chunks.push(data);
      return { type: "result", value: true };
    },

    async rpcWritableClose(writableId) {
      const entry = writableStreamStore.get(writableId);
      if (!entry) throw new Error("WritableStream not found");
      writableStreamStore.delete(writableId);
      return { type: "result", value: entry.chunks };
    },

    async rpcWritableAbort(writableId) {
      writableStreamStore.delete(writableId);
      return { type: "result", value: true };
    },

    clearAll() {
      instanceStore.clear();
      iteratorStore.clear();
      streamStore.clear();
      writableStreamStore.clear();
    },
  };
}
