/** `value` with every string in `aliases` replaced by its new id, however deep. */
export function rename(value: unknown, aliases: Record<string, string>): unknown {
  if (Array.isArray(value)) return value.map((v) => rename(v, aliases));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rename(v, aliases)]));
  }
  return typeof value === 'string' && Object.hasOwn(aliases, value) ? aliases[value] : value;
}

/** A stable id for a row an action makes that has no id of the phone's choosing. */
export function derivedId(...parts: string[]): string {
  // FNV-1a over the parts, stretched to 32 hex digits and shaped like a UUID.
  let hex = '';
  for (let round = 0; hex.length < 32; round += 1) {
    let h = 0x811c9dc5 ^ round;
    for (const ch of parts.join('|')) {
      h ^= ch.charCodeAt(0);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    hex += h.toString(16).padStart(8, '0');
  }
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
