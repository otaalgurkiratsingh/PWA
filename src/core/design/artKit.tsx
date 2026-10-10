/**
 * Drawing kit for food illustrations. Same rendering method as the original art in foodArt.tsx:
 * a 96×96 viewBox, flat fills with one soft shadow, a white plate with a warm rim or a cream bowl,
 * food drawn from simple shapes. Everything is original vector art bundled with the app.
 *
 * Positions inside a dish are scattered with a seeded generator, so two foods that share a
 * container still get their own arrangement, colours and garnish.
 */
import type { ReactNode } from 'react';

export const C = {
  plate: '#FFFFFF', rim: '#E9E2DA', bowl: '#F4F1EC', bowlShade: '#DCD5CC',
  steel: '#D5D9DF', steelDark: '#AEB4BD', steelLight: '#EEF1F4',
  cilantro: '#2F9E44', leafDark: '#2F7A2B', chilli: '#C0392B', cream: '#FFF8EC', ghee: '#F7D774',
  char: '#7A4A22', onion: '#E9D3E8', tomato: '#E2553B', glass: '#E6EEF7', glassEdge: '#C9D6E6',
} as const;

/** Small deterministic PRNG (mulberry32) seeded from a string. */
export function rng(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Points scattered inside an ellipse (cx, cy, rx, ry). */
export function scatter(seed: string, n: number, cx: number, cy: number, rx: number, ry: number): [number, number][] {
  const r = rng(seed);
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.92;
    out.push([+(cx + Math.cos(a) * rx * d).toFixed(1), +(cy + Math.sin(a) * ry * d).toFixed(1)]);
  }
  return out;
}

export const Shadow = ({ cx = 48, cy = 80, rx = 28, ry = 5 }: { cx?: number; cy?: number; rx?: number; ry?: number }) => (
  <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="#000" opacity="0.08" />
);

export function Plate({ children }: { children?: ReactNode }) {
  return (
    <>
      <ellipse cx="48" cy="60" rx="40" ry="20" fill="#000" opacity="0.07" />
      <ellipse cx="48" cy="56" rx="40" ry="20" fill={C.rim} />
      <ellipse cx="48" cy="55" rx="31" ry="14.5" fill={C.plate} />
      {children}
    </>
  );
}

/** Cream bowl as in the original art; `fill` is the visible food surface. */
export function Bowl({ fill, children, color = C.bowl, shade = C.bowlShade }: { fill: string; children?: ReactNode; color?: string; shade?: string }) {
  return (
    <>
      <Shadow cy={78} rx={26} />
      <path d="M14 46h68c0 18-15 30-34 30S14 64 14 46Z" fill={color} />
      <path d="M14 46h68c-1 3-2 5-4 7H18c-2-2-3-4-4-7Z" fill={shade} opacity="0.6" />
      <ellipse cx="48" cy="46" rx="34" ry="10" fill={shade} />
      <ellipse cx="48" cy="45.5" rx="31" ry="8.5" fill={fill} />
      {children}
    </>
  );
}

/** Steel katori (dal/sabzi/raita bowl). */
export function Katori({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <Shadow cy={76} rx={24} />
      <path d="M18 46h60c-1 15-12 26-30 26S19 61 18 46Z" fill={C.steel} />
      <path d="M22 50c4 12 14 18 26 18" stroke={C.steelLight} strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.9" />
      <ellipse cx="48" cy="46" rx="30" ry="9" fill={C.steelDark} />
      <ellipse cx="48" cy="45.5" rx="27.5" ry="7.5" fill={fill} />
      {children}
    </>
  );
}

/** Round flat dish seen from a slight angle, used for grains/sweets/snacks piled on a plate. */
export function Mound({ fill, cx = 48, cy = 54, rx = 26, h = 20, edge }: { fill: string; cx?: number; cy?: number; rx?: number; h?: number; edge?: string }) {
  // Same dome as the original rice art: soft shoulders, flat base.
  return <path d={`M${cx - rx} ${cy}c2-${h * 0.7} ${rx * 0.55}-${h} ${rx}-${h}s${rx - 2} ${h * 0.3} ${rx} ${h}Z`} fill={fill} stroke={edge} strokeWidth={edge ? 1.2 : 0} />;
}

/** Points that sit on a Mound's visible surface. */
export function onMound(seed: string, n: number, cx = 48, cy = 54, rx = 26, h = 20): [number, number][] {
  return scatter(seed, n * 3, cx, cy - h * 0.45, rx * 0.8, h * 0.42)
    .filter(([x, y]) => {
      const t = Math.abs(x - cx) / rx; // 0 centre → 1 edge
      const top = cy - h * (1 - t * t) + 2.5;
      return y >= top && y <= cy - 1.5;
    })
    .slice(0, n);
}

export const Dots = ({ pts, r, fill, opacity }: { pts: [number, number][]; r: number; fill: string; opacity?: number }) => (
  <>{pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={r} fill={fill} opacity={opacity} />)}</>
);

export const Grains = ({ pts, fill, len = 2.6 }: { pts: [number, number][]; fill: string; len?: number }) => (
  <>{pts.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx={len} ry={len * 0.42} transform={`rotate(${(i * 47) % 180} ${x} ${y})`} fill={fill} />)}</>
);

export const Cubes = ({ pts, fill, size = 5, stroke }: { pts: [number, number][]; fill: string; size?: number; stroke?: string }) => (
  <>{pts.map(([x, y], i) => <rect key={i} x={x - size / 2} y={y - size / 2} width={size} height={size} rx={size * 0.28} fill={fill} stroke={stroke} strokeWidth={stroke ? 0.8 : 0} transform={`rotate(${(i * 29) % 90} ${x} ${y})`} />)}</>
);

/** Irregular chunks (meat, potato, paneer in gravy). */
export const Chunks = ({ pts, fill, size = 4.5, shade }: { pts: [number, number][]; fill: string; size?: number; shade?: string }) => (
  <>
    {pts.map(([x, y], i) => (
      <g key={i}>
        <path d={`M${x - size} ${y}c0-${size * 0.8} ${size * 0.9}-${size * 1.2} ${size * 1.6}-${size * 0.8}s${size * 0.6} ${size * 1.3}-${size * 0.4} ${size * 1.5}-${size * 1.8}-${size * 0.1}-${size * 1.2}-${size * 0.7}Z`} fill={fill} />
        {shade ? <path d={`M${x - size * 0.6} ${y + size * 0.3}c${size * 0.6} ${size * 0.4} ${size * 1.2} ${size * 0.3} ${size * 1.6}-${size * 0.1}`} stroke={shade} strokeWidth="0.9" fill="none" strokeLinecap="round" /> : null}
      </g>
    ))}
  </>
);

/** Small leaves (cilantro, methi, mint). */
export const Leaves = ({ pts, fill = C.cilantro, size = 2.6 }: { pts: [number, number][]; fill?: string; size?: number }) => (
  <>{pts.map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx={size} ry={size * 0.5} fill={fill} transform={`rotate(${(i * 71) % 180} ${x} ${y})`} />)}</>
);

/** Round flatbread (roti, paratha, naan family). */
export function Flatbread({ seed, fill, edge, spots = '#9C6326', nSpots = 6, rx = 25, ry = 12, cx = 50, cy = 47, under, children }: {
  seed: string; fill: string; edge: string; spots?: string; nSpots?: number; rx?: number; ry?: number; cx?: number; cy?: number; under?: string; children?: ReactNode;
}) {
  return (
    <>
      {under ? <ellipse cx={cx - 6} cy={cy + 4} rx={rx} ry={ry} fill={under} /> : null}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={fill} stroke={edge} strokeWidth="1.5" />
      {scatter(seed, nSpots, cx, cy, rx * 0.8, ry * 0.7).map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx={1.4 + (i % 3) * 0.6} ry={1 + (i % 2) * 0.5} fill={spots} opacity={0.75} />
      ))}
      {children}
    </>
  );
}

/** Steam curls above a hot drink or dish. */
export const Steam = ({ xs = [38, 48, 58], y = 22, color = '#C4A68A' }: { xs?: number[]; y?: number; color?: string }) => (
  <path d={xs.map((x) => `M${x} ${y}c-3 4 3 6 0 10`).join('')} fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" opacity="0.75" />
);

/** Clay-coloured chai cup (original shape) with configurable liquid. */
export function Cup({ liquid, highlight, body = '#C2693B', rim = '#B4552B', steam = true, children }: { liquid: string; highlight: string; body?: string; rim?: string; steam?: boolean; children?: ReactNode }) {
  return (
    <>
      {steam ? <Steam xs={[36, 48, 60]} y={20} /> : null}
      <ellipse cx="46" cy="80" rx="22" ry="4" fill="#000" opacity="0.08" />
      <path d="M26 40h40l-4 34a6 6 0 0 1-6 5H36a6 6 0 0 1-6-5Z" fill={body} />
      <path d="M26 40h40l-1 8H27Z" fill={rim} opacity="0.7" />
      <ellipse cx="46" cy="40" rx="20" ry="5" fill={rim} />
      <ellipse cx="46" cy="40" rx="17.5" ry="3.8" fill={liquid} />
      <ellipse cx="42" cy="39.5" rx="5" ry="1.1" fill={highlight} />
      {children}
    </>
  );
}

/** White mug with handle. */
export function Mug({ liquid, body = '#F4F1EC', steam = true, foam, children }: { liquid: string; body?: string; steam?: boolean; foam?: string; children?: ReactNode }) {
  return (
    <>
      {steam ? <Steam xs={[40, 52]} y={22} color="#B9A08A" /> : null}
      <ellipse cx="46" cy="80" rx="24" ry="4" fill="#000" opacity="0.08" />
      <path d="M24 40h42v26a12 12 0 0 1-12 12H36a12 12 0 0 1-12-12Z" fill={body} />
      <path d="M66 46h4a8 8 0 0 1 0 16h-4" fill="none" stroke={body} strokeWidth="5" />
      <path d="M28 46v18a10 10 0 0 0 6 9" stroke="#FFFFFF" strokeWidth="2.4" fill="none" opacity="0.6" strokeLinecap="round" />
      <ellipse cx="45" cy="40" rx="21" ry="5" fill={C.bowlShade} />
      <ellipse cx="45" cy="40" rx="18" ry="3.8" fill={liquid} />
      {foam ? <ellipse cx="45" cy="40" rx="11" ry="2.4" fill={foam} /> : null}
      {children}
    </>
  );
}

/** Tall glass; `level` 0–1 of the glass filled. */
export function Glass({ liquid, level = 0.8, top, ice = false, straw, children }: { liquid: string; level?: number; top?: string; ice?: boolean; straw?: string; children?: ReactNode }) {
  const y = 26 + (1 - level) * 44;
  return (
    <>
      <ellipse cx="48" cy="82" rx="18" ry="3.5" fill="#000" opacity="0.08" />
      {straw ? <path d={`M54 ${y - 2}l8-${y - 6}`} stroke={straw} strokeWidth="3" strokeLinecap="round" /> : null}
      <path d="M31 22h34l-4 54a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4Z" fill={C.glass} opacity="0.85" />
      <path d={`M${31 + (y - 22) * 0.074} ${y}h${34 - (y - 22) * 0.148}l${-(76 - y) * 0.074} ${76 - y}a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4Z`} fill={liquid} />
      {top ? <ellipse cx="48" cy={y} rx={17 - (y - 22) * 0.074} ry="2.6" fill={top} /> : null}
      {ice ? <><rect x="39" y={y + 2} width="8" height="8" rx="2" fill="#FFFFFF" opacity="0.55" transform={`rotate(12 43 ${y + 6})`} /><rect x="49" y={y + 8} width="7" height="7" rx="2" fill="#FFFFFF" opacity="0.5" transform={`rotate(-10 52 ${y + 11})`} /></> : null}
      <path d="M31 22h34" stroke={C.glassEdge} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M35 28l3 44" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
      {children}
    </>
  );
}

/** Lidded jar (pickle, jam, ghee, nut butters, honey). */
export function Jar({ fill, lid = '#C6A35A', children, label }: { fill: string; lid?: string; children?: ReactNode; label?: string }) {
  return (
    <>
      <ellipse cx="46" cy="82" rx="22" ry="4" fill="#000" opacity="0.08" />
      <rect x="28" y="24" width="36" height="9" rx="3" fill={lid} />
      <path d="M26 33h40v38a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8Z" fill={C.glass} opacity="0.9" />
      <path d="M28 40h36v31a6 6 0 0 1-6 6H34a6 6 0 0 1-6-6Z" fill={fill} />
      {label ? <rect x="31" y="50" width="30" height="13" rx="3" fill={label} opacity="0.95" /> : null}
      <path d="M31 42v26" stroke="#FFFFFF" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      {children}
    </>
  );
}

/** A steel spoon holding something (for "added" ingredients measured in tsp). */
export function Spoon({ fill, children }: { fill: string; children?: ReactNode }) {
  return (
    <>
      <ellipse cx="44" cy="70" rx="30" ry="6" fill="#000" opacity="0.07" />
      <path d="M58 58l26 14" stroke={C.steelDark} strokeWidth="5" strokeLinecap="round" />
      <path d="M58 58l26 14" stroke={C.steel} strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="40" cy="54" rx="22" ry="13" fill={C.steelDark} />
      <ellipse cx="40" cy="53" rx="20" ry="11" fill={C.steel} />
      <ellipse cx="40" cy="53" rx="15" ry="7.5" fill={fill} />
      {children}
    </>
  );
}

/** Wrap / roll seen from the side, cut to show the filling. */
export function Wrap({ shell, filling, seed, accents }: { shell: string; filling: string; seed: string; accents: string[] }) {
  return (
    <Plate>
      <path d="M22 58l40-26c6-3 12 2 10 8L36 68c-6 4-16-4-14-10Z" fill={shell} />
      <path d="M22 58l40-26" stroke="#C99A5B" strokeWidth="1.3" opacity="0.6" />
      <ellipse cx="68" cy="37" rx="7" ry="9" transform="rotate(35 68 37)" fill={filling} />
      {accents.map((a, i) => <Dots key={i} pts={scatter(`${seed}${i}`, 4, 68, 37, 4, 5.5)} r={1.5} fill={a} />)}
    </Plate>
  );
}

/** Two-piece sandwich/burger stack from the side. */
export function Stack({ layers, bun, top, sesame }: { layers: { color: string; h: number; wavy?: boolean }[]; bun: string; top?: string; sesame?: boolean }) {
  let y = 66;
  const out: ReactNode[] = [];
  out.push(<path key="b" d={`M24 ${y}h48a4 4 0 0 1-4 5H28a4 4 0 0 1-4-5Z`} fill={bun} />);
  for (const [i, l] of layers.entries()) {
    y -= l.h;
    out.push(l.wavy
      ? <path key={i} d={`M22 ${y + l.h}c3-${l.h} 5 0 8 0s5-${l.h} 8 0 5-${l.h} 8 0 5-${l.h} 8 0 5-${l.h} 8 0 5-${l.h} 9 0Z`} fill={l.color} />
      : <rect key={i} x="23" y={y} width="50" height={l.h} rx={l.h / 2} fill={l.color} />);
  }
  out.push(<path key="t" d={`M24 ${y}c0-14 10-20 24-20s24 6 24 20Z`} fill={top ?? bun} />);
  if (sesame) out.push(<Dots key="s" pts={scatter('sesame', 9, 48, y - 9, 15, 5)} r={0.9} fill="#FFF3D6" />);
  return <><Shadow cy={74} rx={30} /><g>{out}</g></>;
}
