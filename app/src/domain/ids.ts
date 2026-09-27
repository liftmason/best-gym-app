/**
 * New ids made on the phone, UUIDv7 like the server's (time-ordered), so things created
 * offline keep their id when they reach the server (docs/plans/S3_SYNC.md, decision B).
 */
export function uuid7(now = Date.now(), random: (bytes: Uint8Array) => Uint8Array = fill): string {
  const bytes = random(new Uint8Array(16));
  let ms = now;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = ms % 256;
    ms = Math.floor(ms / 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fill(bytes: Uint8Array): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getRandomValues } = require('expo-crypto') as typeof import('expo-crypto');
  return getRandomValues(bytes);
}
