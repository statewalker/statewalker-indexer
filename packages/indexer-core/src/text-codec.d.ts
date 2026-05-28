// Ambient declarations for TextEncoder / TextDecoder. Both are universally
// available globals in modern Node and browsers, but `"lib": ["ESNext"]` does
// not include them (they're spec'd outside ECMAScript). Declared minimally
// here to keep the package's `tsc --noEmit` clean without pulling in the full
// DOM or Node lib.
declare const TextEncoder: {
  new (): {
    encode(input: string): Uint8Array;
  };
};

declare const TextDecoder: {
  new (
    label?: string,
  ): {
    decode(input?: Uint8Array): string;
  };
};
