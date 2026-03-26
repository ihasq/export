import { env } from "cloudflare:workers";

const getStub = (room = "default") =>
  env.SHARED_EXPORT.get(env.SHARED_EXPORT.idFromName(room));

const createSharedInstanceProxy = (stub, instanceId, path = []) =>
  new Proxy(function(){}, {
    get(_, prop) {
      if (prop === "then" || prop === Symbol.toStringTag) return undefined;
      if (prop === Symbol.dispose || prop === Symbol.asyncDispose || prop === "[release]")
        return () => stub.rpcRelease(instanceId);
      return createSharedInstanceProxy(stub, instanceId, [...path, prop]);
    },
    async apply(_, __, args) {
      const r = await stub.rpcInstanceCall(instanceId, path, args);
      return r.value;
    },
  });

const createSharedProxy = (stub, path = []) =>
  new Proxy(function(){}, {
    get(_, prop) {
      if (prop === "then" || prop === Symbol.toStringTag) return undefined;
      return createSharedProxy(stub, [...path, prop]);
    },
    async apply(_, __, args) {
      const r = await stub.rpcCall(path, args);
      return r.value;
    },
    async construct(_, args) {
      const r = await stub.rpcConstruct(path, args);
      return createSharedInstanceProxy(stub, r.instanceId);
    },
  });

const _stub = getStub();
export const greet = createSharedProxy(_stub, ["greet"]);
export const add = createSharedProxy(_stub, ["add"]);
export const willThrow = createSharedProxy(_stub, ["willThrow"]);
export const countUp = createSharedProxy(_stub, ["countUp"]);
export const math = createSharedProxy(_stub, ["math"]);
export const streamData = createSharedProxy(_stub, ["streamData"]);
export const Counter = createSharedProxy(_stub, ["Counter"]);
export const echo = createSharedProxy(_stub, ["echo"]);
export const getDate = createSharedProxy(_stub, ["getDate"]);
export const getRegExp = createSharedProxy(_stub, ["getRegExp"]);
export const getBigInt = createSharedProxy(_stub, ["getBigInt"]);
export const getSet = createSharedProxy(_stub, ["getSet"]);
export const getMap = createSharedProxy(_stub, ["getMap"]);
export const getSpecialNumbers = createSharedProxy(_stub, ["getSpecialNumbers"]);
export const getNestedObject = createSharedProxy(_stub, ["getNestedObject"]);
export const getTypedArray = createSharedProxy(_stub, ["getTypedArray"]);
export const VERSION = createSharedProxy(_stub, ["VERSION"]);
export const MAX_COUNT = createSharedProxy(_stub, ["MAX_COUNT"]);
export const emptyGen = createSharedProxy(_stub, ["emptyGen"]);
export const throwingGen = createSharedProxy(_stub, ["throwingGen"]);
export const returnUndefined = createSharedProxy(_stub, ["returnUndefined"]);
export const returnNull = createSharedProxy(_stub, ["returnNull"]);
export const largeArray = createSharedProxy(_stub, ["largeArray"]);
export const deep = createSharedProxy(_stub, ["deep"]);
export const slowFunction = createSharedProxy(_stub, ["slowFunction"]);
export const echoAll = createSharedProxy(_stub, ["echoAll"]);
export const getUrl = createSharedProxy(_stub, ["getUrl"]);
export const getUrlSearchParams = createSharedProxy(_stub, ["getUrlSearchParams"]);
export { getStub };
