// See ../../indexer-core/src/text-codec.d.ts for rationale.
declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: { new (label?: string): { decode(input?: Uint8Array): string } };
