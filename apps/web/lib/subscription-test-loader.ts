/** Test helper: load a lib/*.ts module through the TypeScript transpiler (node:test has no TS path resolution). */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
const cache = new Map<string, Record<string, unknown>>();

export function loadLib<T = Record<string, unknown>>(name: string): T {
  const hit = cache.get(name);
  if (hit) return hit as T;
  const source = readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  const module = { exports: {} as Record<string, unknown> };
  const localRequire = (spec: string) => (spec.startsWith('./') ? loadLib(spec.slice(2)) : nodeRequire(spec));
  new Function('require', 'module', 'exports', outputText)(localRequire, module, module.exports);
  cache.set(name, module.exports);
  return module.exports as T;
}
