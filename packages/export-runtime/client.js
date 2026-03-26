// Core module template. __WS_SUFFIX__ is replaced: "./" for normal, "./?shared" for shared.
const CORE_TEMPLATE = `
const stringify = (value) => {
  const stringified = [];
  const indexes = new Map();
  let p = 0;

  const flatten = (thing) => {
    if (typeof thing === 'function') {
      throw new Error('Cannot stringify a function');
    }

    if (indexes.has(thing)) return indexes.get(thing);

    if (thing === undefined) return -1;
    if (Number.isNaN(thing)) return -3;
    if (thing === Infinity) return -4;
    if (thing === -Infinity) return -5;
    if (thing === 0 && 1 / thing < 0) return -6;

    const index = p++;
    indexes.set(thing, index);

    if (typeof thing === 'boolean' || typeof thing === 'number' || typeof thing === 'string' || thing === null) {
      stringified[index] = thing;
    } else if (thing instanceof Date) {
      stringified[index] = ['Date', thing.toISOString()];
    } else if (thing instanceof URL) {
      stringified[index] = ['URL', thing.href];
    } else if (thing instanceof URLSearchParams) {
      stringified[index] = ['URLSearchParams', thing.toString()];
    } else if (thing instanceof RegExp) {
      stringified[index] = ['RegExp', thing.source, thing.flags];
    } else if (typeof thing === 'bigint') {
      stringified[index] = ['BigInt', thing.toString()];
    } else if (thing instanceof Set) {
      stringified[index] = ['Set', ...[...thing].map(flatten)];
    } else if (thing instanceof Map) {
      stringified[index] = ['Map', ...[...thing].map(([k, v]) => [flatten(k), flatten(v)])];
    } else if (thing instanceof Int8Array) {
      stringified[index] = ['Int8Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Uint8Array) {
      stringified[index] = ['Uint8Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Uint8ClampedArray) {
      stringified[index] = ['Uint8ClampedArray', ...[...thing].map(flatten)];
    } else if (thing instanceof Int16Array) {
      stringified[index] = ['Int16Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Uint16Array) {
      stringified[index] = ['Uint16Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Int32Array) {
      stringified[index] = ['Int32Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Uint32Array) {
      stringified[index] = ['Uint32Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Float32Array) {
      stringified[index] = ['Float32Array', ...[...thing].map(flatten)];
    } else if (thing instanceof Float64Array) {
      stringified[index] = ['Float64Array', ...[...thing].map(flatten)];
    } else if (thing instanceof BigInt64Array) {
      stringified[index] = ['BigInt64Array', ...[...thing].map(flatten)];
    } else if (thing instanceof BigUint64Array) {
      stringified[index] = ['BigUint64Array', ...[...thing].map(flatten)];
    } else if (thing instanceof ArrayBuffer) {
      stringified[index] = ['ArrayBuffer', ...[...new Uint8Array(thing)].map(flatten)];
    } else if (Array.isArray(thing)) {
      stringified[index] = thing.map(flatten);
    } else if (typeof thing === 'object') {
      const obj = {};
      for (const key of Object.keys(thing)) {
        obj[key] = flatten(thing[key]);
      }
      stringified[index] = obj;
    } else {
      throw new Error('Cannot stringify ' + typeof thing);
    }

    return index;
  };

  flatten(value);
  return JSON.stringify(stringified);
};

const UNDEFINED = -1;
const HOLE = -2;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

const parse = (serialized) => {
  if (serialized === '') return undefined;
  const values = JSON.parse(serialized);
  const hydrated = new Array(values.length);

  const hydrate = (index) => {
    if (index === UNDEFINED) return undefined;
    if (index === HOLE) return undefined;
    if (index === NAN) return NaN;
    if (index === POSITIVE_INFINITY) return Infinity;
    if (index === NEGATIVE_INFINITY) return -Infinity;
    if (index === NEGATIVE_ZERO) return -0;

    if (hydrated[index] !== undefined) return hydrated[index];

    const value = values[index];

    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' || value === null) {
      hydrated[index] = value;
    } else if (Array.isArray(value)) {
      if (typeof value[0] === 'string') {
        const type = value[0];
        switch (type) {
          case 'Date': hydrated[index] = new Date(value[1]); break;
          case 'Set': hydrated[index] = new Set(value.slice(1).map(hydrate)); break;
          case 'Map': hydrated[index] = new Map(value.slice(1).map(([k, v]) => [hydrate(k), hydrate(v)])); break;
          case 'RegExp': hydrated[index] = new RegExp(value[1], value[2]); break;
          case 'BigInt': hydrated[index] = BigInt(value[1]); break;
          case 'URL': hydrated[index] = new URL(value[1]); break;
          case 'URLSearchParams': hydrated[index] = new URLSearchParams(value[1]); break;
          case 'Int8Array': case 'Uint8Array': case 'Uint8ClampedArray':
          case 'Int16Array': case 'Uint16Array': case 'Int32Array': case 'Uint32Array':
          case 'Float32Array': case 'Float64Array': case 'BigInt64Array': case 'BigUint64Array':
            hydrated[index] = new globalThis[type](value.slice(1).map(hydrate));
            break;
          case 'ArrayBuffer': {
            const bytes = value.slice(1).map(hydrate);
            const buffer = new ArrayBuffer(bytes.length);
            new Uint8Array(buffer).set(bytes);
            hydrated[index] = buffer;
            break;
          }
          default:
            const arr = new Array(value.length);
            hydrated[index] = arr;
            for (let i = 0; i < value.length; i++) arr[i] = hydrate(value[i]);
        }
      } else {
        const arr = new Array(value.length);
        hydrated[index] = arr;
        for (let i = 0; i < value.length; i++) arr[i] = hydrate(value[i]);
      }
    } else {
      const obj = {};
      hydrated[index] = obj;
      for (const key in value) obj[key] = hydrate(value[key]);
    }

    return hydrated[index];
  };

  return hydrate(0);
};

const _u = new URL("__WS_SUFFIX__", import.meta.url);
_u.protocol = _u.protocol === "https:" ? "wss:" : "ws:";
const ws = new WebSocket(_u.href);
const pending = new Map();
let nextId = 1;
let keepaliveInterval = null;

const ready = new Promise((resolve, reject) => {
  ws.onopen = () => {
    keepaliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(stringify({ type: "ping", id: 0 }));
      }
    }, 30000);
    resolve(undefined);
  };
  ws.onerror = (e) => reject(e);
});

ws.onclose = () => {
  if (keepaliveInterval) {
    clearInterval(keepaliveInterval);
    keepaliveInterval = null;
  }
};

const sendRequest = async (msg) => {
  await ready;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(stringify({ ...msg, id }));
  });
};

ws.onmessage = (event) => {
  const msg = parse(event.data);

  if (msg.type === "pong") return;

  const resolver = pending.get(msg.id);
  if (!resolver) return;

  if (msg.type === "error") {
    resolver.reject(new Error(msg.error));
    pending.delete(msg.id);
  } else if (msg.type === "result") {
    if (msg.valueType === "function") {
      resolver.resolve(createProxy(msg.path));
    } else if (msg.valueType === "instance") {
      resolver.resolve(createInstanceProxy(msg.instanceId));
    } else if (msg.valueType === "asynciterator") {
      const iteratorProxy = {
        [Symbol.asyncIterator]() { return this; },
        async next() {
          return sendRequest({ type: "iterate-next", iteratorId: msg.iteratorId });
        },
        async return(value) {
          return sendRequest({ type: "iterate-return", iteratorId: msg.iteratorId, value });
        }
      };
      resolver.resolve(iteratorProxy);
    } else if (msg.valueType === "readablestream") {
      const streamId = msg.streamId;
      const stream = new ReadableStream({
        async pull(controller) {
          try {
            const result = await sendRequest({ type: "stream-read", streamId });
            if (result.done) {
              controller.close();
            } else {
              controller.enqueue(result.value);
            }
          } catch (err) {
            controller.error(err);
          }
        },
        async cancel() {
          await sendRequest({ type: "stream-cancel", streamId });
        }
      });
      resolver.resolve(stream);
    } else if (msg.valueType === "writablestream") {
      const writableId = msg.writableId;
      const stream = new WritableStream({
        async write(chunk) {
          const data = chunk instanceof Uint8Array ? Array.from(chunk) : chunk;
          await sendRequest({ type: "writable-write", writableId, chunk: data });
        },
        async close() {
          await sendRequest({ type: "writable-close", writableId });
        },
        async abort(reason) {
          await sendRequest({ type: "writable-abort", writableId });
        }
      });
      resolver.resolve(stream);
    } else {
      resolver.resolve(msg.value);
    }
    pending.delete(msg.id);
  } else if (msg.type === "iterate-result") {
    resolver.resolve({ value: msg.value, done: msg.done });
    pending.delete(msg.id);
  } else if (msg.type === "stream-result") {
    const value = Array.isArray(msg.value) ? new Uint8Array(msg.value) : msg.value;
    resolver.resolve({ value, done: msg.done });
    pending.delete(msg.id);
  }
};

const createInstanceProxy = (instanceId, path = []) => {
  const proxy = new Proxy(function(){}, {
    get(_, prop) {
      if (prop === "then" || prop === Symbol.toStringTag) return undefined;
      if (prop === Symbol.dispose || prop === Symbol.asyncDispose) {
        return () => sendRequest({ type: "release", instanceId });
      }
      if (prop === "[release]") {
        return () => sendRequest({ type: "release", instanceId });
      }
      return createInstanceProxy(instanceId, [...path, prop]);
    },
    set(_, prop, value) {
      sendRequest({ type: "set", instanceId, path: [...path, prop], args: [value] });
      return true;
    },
    async apply(_, __, args) {
      return sendRequest({ type: "call", instanceId, path, args });
    }
  });
  return proxy;
};

export const createProxy = (path = []) => new Proxy(function(){}, {
  get(_, prop) {
    if (prop === "then" || prop === Symbol.toStringTag) return undefined;
    return createProxy([...path, prop]);
  },
  async apply(_, __, args) {
    return sendRequest({ type: "call", path, args });
  },
  construct(_, args) {
    return sendRequest({ type: "construct", path, args });
  }
});

export const createUploadStream = async () => {
  const result = await sendRequest({ type: "writable-create" });
  const writableId = result.writableId;

  const stream = new WritableStream({
    async write(chunk) {
      const data = chunk instanceof Uint8Array ? Array.from(chunk) : chunk;
      await sendRequest({ type: "writable-write", writableId, chunk: data });
    },
    async close() {
      return sendRequest({ type: "writable-close", writableId });
    },
    async abort(reason) {
      await sendRequest({ type: "writable-abort", writableId });
    }
  });

  return { stream, writableId };
};
`;

export const CORE_CODE = CORE_TEMPLATE.replace("__WS_SUFFIX__", "./");
export const SHARED_CORE_CODE = CORE_TEMPLATE.replace("__WS_SUFFIX__", "./?shared");
