export function sanitizePrefix(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, (ch) => `_${ch.charCodeAt(0)}_`);
}
