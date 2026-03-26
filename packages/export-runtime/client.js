// Core module template. __WS_SUFFIX__ is replaced: "./" for normal, "./?shared" for shared.
const CORE_TEMPLATE = `
const stringify = (value) => {
  const stringified = [];
  const indexes = new Map();
  let p = 0;
  const flatten = (thing) => {
    if (typeof thing === 'function') throw new Error('Cannot stringify a function');
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
    } else if (ArrayBuffer.isView(thing)) {
      stringified[index] = [thing[Symbol.toStringTag], ...[...thing].map(flatten)];
    } else if (thing instanceof ArrayBuffer) {
      stringified[index] = ['ArrayBuffer', ...[...new Uint8Array(thing)].map(flatten)];
    } else if (Array.isArray(thing)) {
      stringified[index] = thing.map(flatten);
    } else if (typeof thing === 'object') {
      const obj = {};
      for (const key of Object.keys(thing)) obj[key] = flatten(thing[key]);
      stringified[index] = obj;
    } else {
      throw new Error('Cannot stringify ' + typeof thing);
    }
    return index;
  };
  flatten(value);
  return JSON.stringify(stringified);
};

const parse = (serialized) => {
  if (serialized === '') return undefined;
  const values = JSON.parse(serialized);
  const hydrated = new Array(values.length);
  const hydrate = (index) => {
    if (index === -1 || index === -2) return undefined;
    if (index === -3) return NaN;
    if (index === -4) return Infinity;
    if (index === -5) return -Infinity;
    if (index === -6) return -0;
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
            const buf = new ArrayBuffer(bytes.length);
            new Uint8Array(buf).set(bytes);
            hydrated[index] = buf;
            break;
          }
          default: {
            const arr = new Array(value.length);
            hydrated[index] = arr;
            for (let i = 0; i < value.length; i++) arr[i] = hydrate(value[i]);
          }
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
let keepaliveInterval;

const ready = new Promise((resolve, reject) => {
  ws.onopen = () => {
    keepaliveInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(stringify({ type: "ping", id: 0 }));
    }, 30000);
    resolve();
  };
  ws.onerror = reject;
});

ws.onclose = () => { clearInterval(keepaliveInterval); };

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
  const resolver = pending.get(msg.id);
  if (!resolver) return;
  pending.delete(msg.id);

  if (msg.type === "error") {
    resolver.reject(new Error(msg.error));
  } else if (msg.type === "result") {
    if (msg.valueType === "function") resolver.resolve(createProxy(msg.path));
    else if (msg.valueType === "instance") resolver.resolve(createInstanceProxy(msg.instanceId));
    else if (msg.valueType === "asynciterator") resolver.resolve({
      [Symbol.asyncIterator]() { return this; },
      next: () => sendRequest({ type: "iterate-next", iteratorId: msg.iteratorId }),
      return: () => sendRequest({ type: "iterate-return", iteratorId: msg.iteratorId })
    });
    else if (msg.valueType === "readablestream") resolver.resolve(new ReadableStream({
      async pull(c) {
        try { const r = await sendRequest({ type: "stream-read", streamId: msg.streamId }); r.done ? c.close() : c.enqueue(r.value); }
        catch (e) { c.error(e); }
      },
      cancel: () => sendRequest({ type: "stream-cancel", streamId: msg.streamId })
    }));
    else resolver.resolve(msg.value);
  } else if (msg.type === "iterate-result") {
    resolver.resolve({ value: msg.value, done: msg.done });
  } else if (msg.type === "stream-result") {
    resolver.resolve({ value: Array.isArray(msg.value) ? new Uint8Array(msg.value) : msg.value, done: msg.done });
  }
};

const createInstanceProxy = (instanceId, path = []) => new Proxy(function(){}, {
  get(_, prop) {
    if (prop === "then" || prop === Symbol.toStringTag) return undefined;
    if (prop === Symbol.dispose || prop === Symbol.asyncDispose || prop === "[release]")
      return () => sendRequest({ type: "release", instanceId });
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

export const createProxy = (path = []) => new Proxy(function(){}, {
  get(_, prop) {
    if (prop === "then" || prop === Symbol.toStringTag) return undefined;
    return createProxy([...path, prop]);
  },
  async apply(_, __, args) { return sendRequest({ type: "call", path, args }); },
  construct(_, args) { return sendRequest({ type: "construct", path, args }); }
});
`;

export const CORE_CODE = CORE_TEMPLATE.replace("__WS_SUFFIX__", "./");
export const SHARED_CORE_CODE = CORE_TEMPLATE.replace("__WS_SUFFIX__", "./?shared");
