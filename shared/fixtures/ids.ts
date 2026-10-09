/** Deterministic RFC-4122-shaped v4 UUID from a label, for stable fixture ids. Not for real records. */
export function fixtureId(label: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const hex: string[] = [];
  for (let round = 0; hex.join('').length < 32; round++) {
    for (let i = 0; i < label.length; i++) {
      const c = label.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ (c + h1), 2246822519) >>> 0;
    }
    hex.push(h1.toString(16).padStart(8, '0'), h2.toString(16).padStart(8, '0'));
  }
  const s = hex.join('').slice(0, 32).split('');
  s[12] = '4';
  s[16] = ['8', '9', 'a', 'b'][parseInt(s[16]!, 16) % 4]!;
  const j = s.join('');
  return `${j.slice(0, 8)}-${j.slice(8, 12)}-${j.slice(12, 16)}-${j.slice(16, 20)}-${j.slice(20)}`;
}
