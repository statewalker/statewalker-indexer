// Minimal ambient declarations for the Node APIs the on-disk tests touch.
// We avoid pulling `@types/node` package-wide because the rest of the codebase
// stays Node-agnostic; on-disk DuckDB tests are the only place this matters.

declare module "node:fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const URL: { new (input: string, base?: string): URL };
interface URL {
  readonly href: string;
}

interface ImportMeta {
  readonly url: string;
}
