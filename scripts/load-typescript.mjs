// Load dependency-free TypeScript utilities for Node test and fixture tooling.
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
export async function loadTypeScript(url) {
  const source = await readFile(url, "utf8");
  const exports = {};
  const context = vm.createContext({ exports, crypto: webcrypto, TextEncoder, Date, console });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, context, { filename: String(url) });
  return exports;
}
