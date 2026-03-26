#!/usr/bin/env node

import { parseSync } from "oxc-parser";
import { minifySync } from "oxc-minify";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const cwd = process.cwd();

// Read wrangler.toml to find user module path
const wranglerPath = path.join(cwd, "wrangler.toml");
if (!fs.existsSync(wranglerPath)) {
  console.error("wrangler.toml not found in", cwd);
  process.exit(1);
}
const wranglerContent = fs.readFileSync(wranglerPath, "utf8");
const aliasMatch = wranglerContent.match(/"__USER_MODULE__"\s*=\s*"([^"]+)"/);
if (!aliasMatch) {
  console.error('Could not find __USER_MODULE__ alias in wrangler.toml');
  process.exit(1);
}

const userModulePath = path.resolve(cwd, aliasMatch[1]);
if (!fs.existsSync(userModulePath)) {
  console.error("User module not found:", userModulePath);
  process.exit(1);
}

const source = fs.readFileSync(userModulePath, "utf8");
const isTS = userModulePath.endsWith(".ts") || userModulePath.endsWith(".tsx");
const fileName = path.basename(userModulePath);
const result = parseSync(fileName, source, { sourceType: "module" });
const program = result.program;

// --- Type extraction helpers ---

function extractType(node) {
  if (!node) return "any";
  const ta = node.type === "TSTypeAnnotation" ? node.typeAnnotation : node;
  switch (ta.type) {
    case "TSStringKeyword": return "string";
    case "TSNumberKeyword": return "number";
    case "TSBooleanKeyword": return "boolean";
    case "TSVoidKeyword": return "void";
    case "TSAnyKeyword": return "any";
    case "TSNullKeyword": return "null";
    case "TSUndefinedKeyword": return "undefined";
    case "TSNeverKeyword": return "never";
    case "TSUnknownKeyword": return "unknown";
    case "TSBigIntKeyword": return "bigint";
    case "TSSymbolKeyword": return "symbol";
    case "TSObjectKeyword": return "object";
    case "TSArrayType":
      return `${extractType(ta.elementType)}[]`;
    case "TSTupleType":
      return `[${(ta.elementTypes || []).map(e => extractType(e)).join(", ")}]`;
    case "TSUnionType":
      return ta.types.map(t => extractType(t)).join(" | ");
    case "TSIntersectionType":
      return ta.types.map(t => extractType(t)).join(" & ");
    case "TSLiteralType": {
      const lit = ta.literal;
      if (lit.type === "StringLiteral") return JSON.stringify(lit.value);
      if (lit.type === "NumericLiteral") return String(lit.value);
      if (lit.type === "BooleanLiteral") return String(lit.value);
      if (lit.type === "UnaryExpression") return `-${lit.argument.value}`;
      return "any";
    }
    case "TSTypeReference": {
      const name = ta.typeName?.name || ta.typeName?.right?.name || "any";
      const typeArgs = ta.typeArguments || ta.typeParameters;
      if (typeArgs?.params?.length) {
        const args = typeArgs.params.map(p => extractType(p)).join(", ");
        return `${name}<${args}>`;
      }
      return name;
    }
    case "TSFunctionType": {
      const params = extractParams(ta.params);
      const ret = ta.returnType ? extractType(ta.returnType) : "any";
      return `(${params.join(", ")}) => ${ret}`;
    }
    case "TSTypeLiteral": {
      const members = (ta.members || []).map(m => {
        if (m.type === "TSPropertySignature") {
          const key = m.key?.name || m.key?.value;
          const type = m.typeAnnotation ? extractType(m.typeAnnotation) : "any";
          const opt = m.optional ? "?" : "";
          return `${key}${opt}: ${type}`;
        }
        return "";
      }).filter(Boolean);
      return `{ ${members.join("; ")} }`;
    }
    case "TSTypeAnnotation":
      return extractType(ta.typeAnnotation);
    default:
      return "any";
  }
}

function extractParams(params) {
  return params.map(p => {
    if (p.type === "AssignmentPattern") {
      const name = p.left?.name || "arg";
      const type = p.left?.typeAnnotation ? extractType(p.left.typeAnnotation) : "any";
      return `${name}?: ${type}`;
    }
    const name = p.name || p.argument?.name || "arg";
    const type = p.typeAnnotation ? extractType(p.typeAnnotation) : "any";
    const opt = p.optional ? "?" : "";
    const rest = p.type === "RestElement" ? "..." : "";
    return `${rest}${name}${opt}: ${type}`;
  });
}

// Wrap return type: all functions become async over the network
function wrapReturnType(returnType, isAsync, isGenerator) {
  if (isGenerator) {
    // async generator → AsyncIterable<YieldType>
    // extract inner type from AsyncGenerator<T> if present
    if (returnType.startsWith("AsyncGenerator")) {
      const inner = returnType.match(/^AsyncGenerator<(.+?)(?:,.*)?>/);
      return `Promise<AsyncIterable<${inner ? inner[1] : "any"}>>`;
    }
    return `Promise<AsyncIterable<${returnType === "any" ? "any" : returnType}>>`;
  }
  // Already Promise<T> → keep as-is
  if (returnType.startsWith("Promise<")) return returnType;
  // ReadableStream<T> → Promise<ReadableStream<T>>
  if (returnType.startsWith("ReadableStream")) return `Promise<${returnType}>`;
  // Wrap in Promise
  return `Promise<${returnType}>`;
}

// --- Generate .d.ts ---

const lines = [
  "// Auto-generated type definitions (oxc-parser)",
  "// All functions are async over the network",
  "",
];

for (const node of program.body) {
  if (node.type !== "ExportNamedDeclaration" || !node.declaration) continue;
  const decl = node.declaration;

  if (decl.type === "FunctionDeclaration") {
    const name = decl.id.name;
    const params = extractParams(decl.params);
    const rawRet = decl.returnType ? extractType(decl.returnType) : "any";
    const ret = wrapReturnType(rawRet, decl.async, decl.generator);
    lines.push(`export declare function ${name}(${params.join(", ")}): ${ret};`);
    lines.push("");

  } else if (decl.type === "ClassDeclaration") {
    const name = decl.id.name;
    lines.push(`export declare class ${name} {`);
    for (const member of decl.body.body) {
      if (member.type === "MethodDefinition") {
        const mName = member.key.name || member.key.value;
        if (member.kind === "constructor") {
          const params = extractParams(member.value.params);
          lines.push(`  constructor(${params.join(", ")});`);
        } else {
          const params = extractParams(member.value.params);
          const rawRet = member.value.returnType ? extractType(member.value.returnType) : "any";
          const ret = wrapReturnType(rawRet, member.value.async, member.value.generator);
          lines.push(`  ${mName}(${params.join(", ")}): ${ret};`);
        }
      } else if (member.type === "PropertyDefinition") {
        // Skip private members
        if (member.accessibility === "private") continue;
        const mName = member.key.name;
        const type = member.typeAnnotation ? extractType(member.typeAnnotation) : "any";
        lines.push(`  ${mName}: ${type};`);
      }
    }
    lines.push(`  [Symbol.dispose](): Promise<void>;`);
    lines.push(`  "[release]"(): Promise<void>;`);
    lines.push(`}`);
    lines.push("");

  } else if (decl.type === "VariableDeclaration") {
    for (const d of decl.declarations) {
      const name = d.id.name;
      if (d.init?.type === "ObjectExpression") {
        lines.push(`export declare const ${name}: {`);
        for (const prop of d.init.properties) {
          if (prop.type === "SpreadElement") continue;
          const key = prop.key?.name || prop.key?.value;
          if (prop.value?.type === "FunctionExpression" || prop.value?.type === "ArrowFunctionExpression") {
            const params = extractParams(prop.value.params);
            const rawRet = prop.value.returnType ? extractType(prop.value.returnType) : "any";
            const ret = wrapReturnType(rawRet, prop.value.async, prop.value.generator);
            lines.push(`  ${key}(${params.join(", ")}): ${ret};`);
          } else {
            const type = d.id.typeAnnotation ? "any" : "any";
            lines.push(`  ${key}: any;`);
          }
        }
        lines.push(`};`);
        lines.push("");
      } else {
        const type = d.id.typeAnnotation ? extractType(d.id.typeAnnotation) : "any";
        lines.push(`export declare const ${name}: ${type};`);
        lines.push("");
      }
    }
  }
}

// Add createUploadStream helper type
lines.push("export declare function createUploadStream(): Promise<{");
lines.push("  stream: WritableStream<any>;");
lines.push("  writableId: number;");
lines.push("}>;");

const typeDefinitions = lines.join("\n");

// --- Minify core module ---

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { CORE_CODE } = await import(path.join(__dirname, "..", "client.js"));

// CORE_CODE uses import.meta.url for WS URL — no placeholders needed.
const minified = minifySync("_core.js", CORE_CODE);
if (minified.errors?.length) {
  console.error("Minification errors:", minified.errors);
}

// Generate a unique ID per build for cache-busting the core module path
const coreId = crypto.randomUUID();

// Write as a JS module that exports type definitions, minified core, and core ID
const outPath = path.join(cwd, ".export-types.js");
fs.writeFileSync(outPath, [
  `export default ${JSON.stringify(typeDefinitions)};`,
  `export const minifiedCore = ${JSON.stringify(minified.code)};`,
  `export const coreId = ${JSON.stringify(coreId)};`,
].join("\n") + "\n");
console.log("Generated type definitions + minified core →", outPath);
