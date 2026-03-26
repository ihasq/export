import * as userExports from "__USER_MODULE__";
import generatedTypes, { minifiedCore, minifiedSharedCore, coreId } from "__GENERATED_TYPES__";
import { createHandler } from "./handler.js";
export { SharedExportDO } from "./shared-do.js";

export default createHandler(userExports, generatedTypes, minifiedCore, coreId, minifiedSharedCore);
