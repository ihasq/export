import { DurableObject } from "cloudflare:workers";
import * as userExports from "__USER_MODULE__";
import { createRpcDispatcher } from "./rpc.js";

export class SharedExportDO extends DurableObject {
  #d;
  constructor(ctx, env) {
    super(ctx, env);
    this.#d = createRpcDispatcher(userExports);
  }
  rpcCall(p, a) { return this.#d.rpcCall(p, a); }
  rpcConstruct(p, a) { return this.#d.rpcConstruct(p, a); }
  rpcInstanceCall(i, p, a) { return this.#d.rpcInstanceCall(i, p, a); }
  rpcGet(i, p) { return this.#d.rpcGet(i, p); }
  rpcSet(i, p, v) { return this.#d.rpcSet(i, p, v); }
  rpcRelease(i) { return this.#d.rpcRelease(i); }
  rpcIterateNext(i) { return this.#d.rpcIterateNext(i); }
  rpcIterateReturn(i) { return this.#d.rpcIterateReturn(i); }
  rpcStreamRead(s) { return this.#d.rpcStreamRead(s); }
  rpcStreamCancel(s) { return this.#d.rpcStreamCancel(s); }
}
