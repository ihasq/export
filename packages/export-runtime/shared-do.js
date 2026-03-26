import { DurableObject } from "cloudflare:workers";
import * as userExports from "__USER_MODULE__";
import { createRpcDispatcher } from "./rpc.js";

export class SharedExportDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.dispatcher = createRpcDispatcher(userExports);
  }

  // --- Workers RPC methods (Worker → DO, native serialization) ---

  async rpcCall(path, args) { return this.dispatcher.rpcCall(path, args); }
  async rpcConstruct(path, args) { return this.dispatcher.rpcConstruct(path, args); }
  async rpcInstanceCall(instanceId, path, args) { return this.dispatcher.rpcInstanceCall(instanceId, path, args); }
  async rpcGet(instanceId, path) { return this.dispatcher.rpcGet(instanceId, path); }
  async rpcSet(instanceId, path, value) { return this.dispatcher.rpcSet(instanceId, path, value); }
  async rpcRelease(instanceId) { return this.dispatcher.rpcRelease(instanceId); }
  async rpcIterateNext(iteratorId) { return this.dispatcher.rpcIterateNext(iteratorId); }
  async rpcIterateReturn(iteratorId) { return this.dispatcher.rpcIterateReturn(iteratorId); }
  async rpcStreamRead(streamId) { return this.dispatcher.rpcStreamRead(streamId); }
  async rpcStreamCancel(streamId) { return this.dispatcher.rpcStreamCancel(streamId); }
  async rpcWritableCreate() { return this.dispatcher.rpcWritableCreate(); }
  async rpcWritableWrite(writableId, chunk) { return this.dispatcher.rpcWritableWrite(writableId, chunk); }
  async rpcWritableClose(writableId) { return this.dispatcher.rpcWritableClose(writableId); }
  async rpcWritableAbort(writableId) { return this.dispatcher.rpcWritableAbort(writableId); }
}
