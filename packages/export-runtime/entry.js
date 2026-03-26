import * as userExports from "__USER_MODULE__";
import generatedTypes, { minifiedCore, coreId } from "__GENERATED_TYPES__";
import { createHandler } from "./handler.js";

export default createHandler(userExports, generatedTypes, minifiedCore, coreId);
