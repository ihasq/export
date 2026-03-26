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

export const RPC_METHODS = [
  "rpcCall", "rpcConstruct", "rpcInstanceCall", "rpcGet", "rpcSet", "rpcRelease",
  "rpcIterateNext", "rpcIterateReturn", "rpcStreamRead", "rpcStreamCancel",
];

export function createRpcDispatcher(exports) {
  const instances = new Map();
  const iterators = new Map();
  const streams = new Map();
  let nextId = 1;

  const requireInstance = (id) => {
    const inst = instances.get(id);
    if (!inst) throw new Error("Instance not found");
    return inst;
  };

  const wrapResult = (result, path) => {
    if (isReadableStream(result)) {
      const id = nextId++;
      streams.set(id, { stream: result, reader: null });
      return { type: "result", streamId: id, valueType: "readablestream" };
    }
    if (isAsyncIterable(result)) {
      const id = nextId++;
      iterators.set(id, result[Symbol.asyncIterator]());
      return { type: "result", iteratorId: id, valueType: "asynciterator" };
    }
    if (typeof result === "function") {
      return { type: "result", path: [...path], valueType: "function" };
    }
    return { type: "result", value: result };
  };

  const callTarget = async (obj, path, args) => {
    const target = getByPath(obj, path);
    const thisArg = path.length > 1 ? getByPath(obj, path.slice(0, -1)) : (obj === exports ? undefined : obj);
    if (typeof target !== "function") throw new Error(`${path.join(".")} is not a function`);
    return wrapResult(await target.apply(thisArg, args), path);
  };

  return {
    rpcCall: (path, args = []) => callTarget(exports, path, args),

    async rpcConstruct(path, args = []) {
      const Ctor = getByPath(exports, path);
      if (!isClass(Ctor)) throw new Error(`${path.join(".")} is not a class`);
      const id = nextId++;
      instances.set(id, new Ctor(...args));
      return { type: "result", instanceId: id, valueType: "instance" };
    },

    rpcInstanceCall: (instanceId, path, args = []) =>
      callTarget(requireInstance(instanceId), path, args),

    async rpcGet(instanceId, path) {
      const value = getByPath(requireInstance(instanceId), path);
      return typeof value === "function"
        ? { type: "result", valueType: "function" }
        : { type: "result", value };
    },

    async rpcSet(instanceId, path, value) {
      const inst = requireInstance(instanceId);
      const parent = path.length > 1 ? getByPath(inst, path.slice(0, -1)) : inst;
      parent[path.at(-1)] = value;
      return { type: "result", value: true };
    },

    async rpcRelease(instanceId) {
      instances.delete(instanceId);
      return { type: "result", value: true };
    },

    async rpcIterateNext(iteratorId) {
      const iter = iterators.get(iteratorId);
      if (!iter) throw new Error("Iterator not found");
      const { value, done } = await iter.next();
      if (done) iterators.delete(iteratorId);
      return { type: "iterate-result", value, done: !!done };
    },

    async rpcIterateReturn(iteratorId) {
      const iter = iterators.get(iteratorId);
      if (iter?.return) await iter.return(undefined);
      iterators.delete(iteratorId);
      return { type: "iterate-result", value: undefined, done: true };
    },

    async rpcStreamRead(streamId) {
      const entry = streams.get(streamId);
      if (!entry) throw new Error("Stream not found");
      if (!entry.reader) entry.reader = entry.stream.getReader();
      const { value, done } = await entry.reader.read();
      if (done) streams.delete(streamId);
      const v = value instanceof Uint8Array ? Array.from(value) : value;
      return { type: "stream-result", value: v, done: !!done };
    },

    async rpcStreamCancel(streamId) {
      const entry = streams.get(streamId);
      if (entry) {
        try { await (entry.reader || entry.stream).cancel(); } catch {}
        streams.delete(streamId);
      }
      return { type: "result", value: true };
    },

    clearAll() {
      instances.clear();
      iterators.clear();
      streams.clear();
    },
  };
}
