/**
 * Food-specific artwork for every catalogue entry, keyed by catalogue id (asset key = `food-<id>`).
 * Built from the shared kit (artKit.tsx) in the same style as the original meal art. Close variants
 * share a container but differ deliberately in colour, shape, filling and garnish.
 */
import type { ReactNode } from 'react';
import {
  Bowl, C, Chunks, Cubes, Cup, Dots, Flatbread, Glass, Grains, Jar, Katori, Leaves, Mound, Mug, Plate, Shadow, Spoon, Stack, Steam, Wrap, onMound, scatter,
} from './artKit';

type Draw = () => ReactNode;
const A: Record<string, Draw> = {};

// ---------------------------------------------------------------------------------------------
// Shared dish builders
// ---------------------------------------------------------------------------------------------
interface CurryOpts {
  surface: string; // gravy top colour
  rim?: string; // darker ring colour for depth
  chunks?: { fill: string; shade?: string; n: number; size?: number };
  chunks2?: { fill: string; shade?: string; n: number; size?: number };
  beans?: { fill: string; n: number; r?: number; eye?: string };
  bits?: [string, number, number][]; // [colour, count, radius]
  cubes?: { fill: string; n: number; size?: number };
  cream?: boolean;
  ghee?: boolean;
  leaves?: number;
  chilli?: boolean;
  katori?: boolean;
  leafy?: string; // greens texture colour
}

function curry(id: string, o: CurryOpts): Draw {
  return () => {
    const inner = (
      <>
        <ellipse cx="48" cy="45" rx="24" ry="6" fill={o.surface} />
        {o.leafy ? <Dots pts={scatter(`${id}l`, 16, 48, 45, 22, 5)} r={1.8} fill={o.leafy} opacity={0.85} /> : null}
        {o.chunks ? <Chunks pts={scatter(`${id}c`, o.chunks.n, 48, 44, 18, 4)} fill={o.chunks.fill} shade={o.chunks.shade} size={o.chunks.size ?? 4} /> : null}
        {o.chunks2 ? <Chunks pts={scatter(`${id}d`, o.chunks2.n, 48, 45, 18, 4)} fill={o.chunks2.fill} shade={o.chunks2.shade} size={o.chunks2.size ?? 3.4} /> : null}
        {o.cubes ? <Cubes pts={scatter(`${id}q`, o.cubes.n, 48, 44, 18, 4)} fill={o.cubes.fill} size={o.cubes.size ?? 4.6} /> : null}
        {o.beans ? (
          <>
            <Dots pts={scatter(`${id}b`, o.beans.n, 48, 45, 20, 4.5)} r={o.beans.r ?? 1.9} fill={o.beans.fill} />
            {o.beans.eye ? <Dots pts={scatter(`${id}b`, o.beans.n, 48, 45, 20, 4.5)} r={0.6} fill={o.beans.eye} /> : null}
          </>
        ) : null}
        {(o.bits ?? []).map(([fill, n, r], i) => <Dots key={i} pts={scatter(`${id}x${i}`, n, 48, 45, 20, 4.5)} r={r} fill={fill} />)}
        {o.cream ? <path d="M36 44c4-3 8 2 12 0s8-3 11 0" fill="none" stroke={C.cream} strokeWidth="2.2" strokeLinecap="round" /> : null}
        {o.ghee ? <ellipse cx="44" cy="43.5" rx="6" ry="1.6" fill={C.ghee} opacity="0.9" /> : null}
        {o.chilli ? <path d="M54 41c3-1 6 0 7 2" stroke={C.chilli} strokeWidth="2" fill="none" strokeLinecap="round" /> : null}
        <Leaves pts={scatter(`${id}g`, o.leaves ?? 3, 48, 43, 16, 3)} />
      </>
    );
    return o.katori ? <Katori fill={o.rim ?? o.surface}>{inner}</Katori> : <Bowl fill={o.rim ?? o.surface}>{inner}</Bowl>;
  };
}

interface RiceOpts {
  base: string;
  grain: string;
  bits?: [string, number, number][];
  leaves?: number;
  cubes?: { fill: string; n: number };
  chunks?: { fill: string; shade?: string; n: number };
  bowl?: boolean;
}
function rice(id: string, o: RiceOpts): Draw {
  return () => {
    if (o.bowl) {
      return (
        <Bowl fill={o.base}>
          <Grains pts={scatter(`${id}r`, 26, 48, 44, 22, 5)} fill={o.grain} />
          {o.cubes ? <Cubes pts={scatter(`${id}q`, o.cubes.n, 48, 44, 18, 4)} fill={o.cubes.fill} size={3.6} /> : null}
          {o.chunks ? <Chunks pts={scatter(`${id}c`, o.chunks.n, 48, 44, 16, 4)} fill={o.chunks.fill} shade={o.chunks.shade} size={3.6} /> : null}
          {(o.bits ?? []).map(([fill, n, r], i) => <Dots key={i} pts={scatter(`${id}x${i}`, n, 48, 44, 20, 4.5)} r={r} fill={fill} />)}
          <Leaves pts={scatter(`${id}g`, o.leaves ?? 0, 48, 42, 16, 3)} />
        </Bowl>
      );
    }
    return (
      <Plate>
        <Mound fill={o.base} />
        <Grains pts={onMound(`${id}r`, 30)} fill={o.grain} len={2.8} />
        {o.cubes ? <Cubes pts={onMound(`${id}q`, o.cubes.n)} fill={o.cubes.fill} size={3.8} /> : null}
        {o.chunks ? <Chunks pts={onMound(`${id}c`, o.chunks.n)} fill={o.chunks.fill} shade={o.chunks.shade} size={3.8} /> : null}
        {(o.bits ?? []).map(([fill, n, r], i) => <Dots key={i} pts={onMound(`${id}x${i}`, n)} r={r} fill={fill} />)}
        <Leaves pts={onMound(`${id}g`, o.leaves ?? 0)} />
      </Plate>
    );
  };
}

function paratha(id: string, o: { fill: string; edge: string; filling?: string[]; layers?: boolean; ghee?: boolean; spots?: string }): Draw {
  return () => (
    <Plate>
      <Flatbread seed={id} fill={o.fill} edge={o.edge} spots={o.spots ?? '#8E5A24'} nSpots={8} under="#C88F46">
        {o.layers ? [16, 11, 6].map((r) => <ellipse key={r} cx="50" cy="47" rx={r} ry={r * 0.48} fill="none" stroke={o.edge} strokeWidth="1.3" opacity="0.8" />) : null}
        {o.filling ? o.filling.map((f, i) => <Dots key={i} pts={scatter(`${id}f${i}`, 5, 50, 47, 18, 8)} r={1.5} fill={f} />) : null}
        {o.filling ? <path d="M30 52c6 4 14 5 22 4" stroke={o.filling[0]} strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.85" /> : null}
        {o.ghee ? <ellipse cx="54" cy="44" rx="6" ry="2.4" fill={C.ghee} opacity="0.9" /> : null}
      </Flatbread>
    </Plate>
  );
}

function naan(id: string, o: { fill: string; spots: string; butter?: boolean; garlic?: boolean; stuffed?: string; round?: boolean }): Draw {
  return () => (
    <Plate>
      {o.round
        ? <ellipse cx="48" cy="48" rx="23" ry="12" fill={o.fill} stroke="#C99A5B" strokeWidth="1.4" />
        : <path d="M20 54c-2-10 14-18 32-19 12-1 24 2 24 9s-12 14-30 15c-16 1-25 0-26-5Z" fill={o.fill} stroke="#C99A5B" strokeWidth="1.4" />}
      <Dots pts={scatter(`${id}s`, 9, 48, 47, 20, 7)} r={1.6} fill={o.spots} opacity={0.8} />
      {o.butter ? <ellipse cx="44" cy="45" rx="9" ry="3" fill={C.ghee} opacity="0.85" /> : null}
      {o.garlic ? <><Dots pts={scatter(`${id}g`, 8, 48, 46, 18, 6)} r={1.1} fill="#FFF8E0" /><Leaves pts={scatter(`${id}l`, 5, 48, 46, 16, 5)} size={2} /></> : null}
      {o.stuffed ? <path d="M30 50c8 3 18 3 28 0" stroke={o.stuffed} strokeWidth="2.6" fill="none" strokeLinecap="round" /> : null}
    </Plate>
  );
}

function puffed(id: string, o: { fill: string; edge: string; big?: boolean; n: number }): Draw {
  return () => (
    <Plate>
      {(o.big ? [[48, 46, 22, 14]] : [[38, 50, 13, 8], [56, 46, 14, 9], [47, 41, 11, 7]].slice(0, o.n)).map(([x, y, rx, ry], i) => (
        <g key={i}>
          <ellipse cx={x} cy={y} rx={rx} ry={ry} fill={o.fill} stroke={o.edge} strokeWidth="1.3" />
          <ellipse cx={x! - rx! * 0.3} cy={y! - ry! * 0.35} rx={rx! * 0.35} ry={ry! * 0.22} fill="#FFF3D6" opacity="0.7" />
        </g>
      ))}
      <Dots pts={scatter(id, 5, 48, 46, 18, 8)} r={1} fill={o.edge} opacity={0.6} />
    </Plate>
  );
}

function eggsPlate(id: string, kind: 'boiled' | 'scrambled' | 'bhurji' | 'omelette' | 'masala-omelette' | 'fried' | 'whites'): Draw {
  return () => {
    switch (kind) {
      case 'boiled':
        return (
          <Plate>
            {[[36, 50], [58, 50]].map(([x, y]) => (
              <g key={x}>
                <ellipse cx={x} cy={y} rx="11" ry="8" fill="#FFFFFF" stroke="#EFE9DF" strokeWidth="1.4" />
                <circle cx={x} cy={y} r="5" fill="#F4B63A" />
                <circle cx={x! - 1.5} cy={y! - 1.5} r="1.6" fill="#FFD66B" />
              </g>
            ))}
            <Dots pts={[[47, 42], [50, 44]]} r={0.8} fill="#555" />
          </Plate>
        );
      case 'scrambled':
      case 'bhurji':
        return (
          <Plate>
            <path d="M24 54c0-8 12-14 24-14s24 5 24 12c-6 5-42 7-48 2Z" fill={kind === 'bhurji' ? '#F0BF48' : '#F8D864'} />
            <Chunks pts={scatter(id, 11, 48, 48, 18, 6)} fill={kind === 'bhurji' ? '#F2C14E' : '#FBE38A'} shade="#E3B23C" size={5.2} />
            {kind === 'bhurji' ? <><Dots pts={scatter(`${id}t`, 5, 48, 50, 16, 6)} r={1.4} fill={C.tomato} /><Dots pts={scatter(`${id}o`, 4, 48, 50, 16, 6)} r={1.3} fill={C.onion} /></> : null}
            <Leaves pts={scatter(`${id}g`, kind === 'bhurji' ? 5 : 2, 48, 48, 15, 6)} size={2} />
          </Plate>
        );
      case 'omelette':
      case 'masala-omelette':
        return (
          <Plate>
            <path d="M22 54c0-12 16-18 28-17s24 7 24 15c-8 5-44 8-52 2Z" fill="#F6D15C" stroke="#E2B23A" strokeWidth="1.4" />
            <path d="M26 52c10 2 34 2 44-2" stroke="#E2B23A" strokeWidth="1.4" fill="none" />
            {kind === 'masala-omelette'
              ? <><Dots pts={scatter(`${id}t`, 6, 48, 46, 16, 5)} r={1.4} fill={C.tomato} /><Dots pts={scatter(`${id}o`, 5, 48, 46, 16, 5)} r={1.2} fill={C.onion} /><Leaves pts={scatter(`${id}g`, 6, 48, 46, 16, 5)} size={1.9} /></>
              : <Dots pts={scatter(`${id}p`, 4, 48, 46, 14, 4)} r={0.7} fill="#6B5B4B" />}
          </Plate>
        );
      case 'fried':
        return (
          <Plate>
            <path d="M24 52c-2-8 8-14 18-13 6-4 18-3 22 2 8 1 11 8 6 12-6 5-40 6-46-1Z" fill="#FFFFFF" stroke="#EFE9DF" strokeWidth="1.4" />
            <circle cx="40" cy="48" r="6.5" fill="#F7B21E" />
            <circle cx="58" cy="49" r="6" fill="#F7B21E" />
            <circle cx="38.5" cy="46.5" r="2" fill="#FFD66B" />
            <circle cx="56.5" cy="47.5" r="1.8" fill="#FFD66B" />
          </Plate>
        );
      default:
        return (
          <Plate>
            <path d="M24 52c-1-9 12-14 24-13s24 5 24 12c-6 6-42 7-48 1Z" fill="#F4F1E6" stroke="#D9D2BE" strokeWidth="1.6" />
            <path d="M30 50c8 3 26 3 36-1" stroke="#E2DCC8" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M34 47c6-3 14-3 22 0" stroke="#ECE7DB" strokeWidth="2" fill="none" strokeLinecap="round" />
            <Dots pts={[[44, 44], [52, 46]]} r={0.8} fill="#6B5B4B" />
          </Plate>
        );
    }
  };
}

function skewerPlate(id: string, o: { piece: string; char: string; shape: 'cube' | 'log'; onion?: boolean; lemon?: boolean }): Draw {
  return () => (
    <Plate>
      <path d="M18 60L78 38" stroke="#B88A55" strokeWidth="2.2" strokeLinecap="round" />
      {(o.shape === 'cube' ? [[30, 55], [42, 51], [54, 46], [66, 42]] : [[33, 54], [52, 47], [70, 40]]).map(([x, y], i) => (
        o.shape === 'cube'
          ? <rect key={i} x={x! - 5} y={y! - 5} width="10" height="10" rx="2.8" fill={o.piece} stroke={o.char} strokeWidth="1.2" transform={`rotate(-18 ${x} ${y})`} />
          : <rect key={i} x={x! - 8} y={y! - 4} width="16" height="8" rx="4" fill={o.piece} stroke={o.char} strokeWidth="1.2" transform={`rotate(-20 ${x} ${y})`} />
      ))}
      <Dots pts={scatter(`${id}c`, 7, 48, 48, 18, 6)} r={1} fill={o.char} opacity={0.8} />
      {o.onion ? <><ellipse cx="34" cy="62" rx="6" ry="2.6" fill="none" stroke="#C987C4" strokeWidth="1.6" /><ellipse cx="44" cy="63" rx="5" ry="2.2" fill="none" stroke="#C987C4" strokeWidth="1.6" /></> : null}
      {o.lemon ? <path d="M62 60a6 6 0 0 1 12 0Z" fill="#F4D03F" stroke="#D4AC0D" strokeWidth="1" /> : null}
    </Plate>
  );
}

function sweetPieces(id: string, o: { shape: 'ball' | 'diamond' | 'square' | 'disc' | 'cylinder' | 'block'; fill: string; edge?: string; n?: number; topping?: [string, number]; silver?: boolean; syrup?: string; bowl?: boolean; tex?: string }): Draw {
  return () => {
    const pos: [number, number][] = o.n === 1 ? [[48, 48]] : o.n === 2 ? [[39, 50], [57, 47]] : [[36, 52], [58, 52], [47, 43]];
    const pieces = pos.map(([x, y], i) => {
      switch (o.shape) {
        case 'ball':
          return <g key={i}><circle cx={x} cy={y} r="8.5" fill={o.fill} stroke={o.edge} strokeWidth={o.edge ? 1 : 0} /><circle cx={x - 3} cy={y - 3} r="2.4" fill="#FFFFFF" opacity="0.35" /></g>;
        case 'diamond':
          return <path key={i} d={`M${x} ${y - 8}l11 8-11 8-11-8Z`} fill={o.fill} stroke={o.edge} strokeWidth="1" />;
        case 'square':
          return <g key={i}><path d={`M${x - 9} ${y - 3}l9-5 9 5v6l-9 5-9-5Z`} fill={o.edge ?? o.fill} /><path d={`M${x - 9} ${y - 3}l9-5 9 5-9 5Z`} fill={o.fill} /></g>;
        case 'disc':
          return <g key={i}><ellipse cx={x} cy={y + 2} rx="10" ry="5" fill={o.edge ?? o.fill} /><ellipse cx={x} cy={y} rx="10" ry="5" fill={o.fill} /><circle cx={x} cy={y} r="1.6" fill={o.edge ?? '#B07533'} opacity="0.7" /></g>;
        case 'cylinder':
          return <g key={i}><ellipse cx={x} cy={y + 3} rx="9" ry="5" fill={o.edge ?? o.fill} /><rect x={x - 9} y={y - 3} width="18" height="6" fill={o.edge ?? o.fill} /><ellipse cx={x} cy={y - 3} rx="9" ry="5" fill={o.fill} /></g>;
        default:
          return <g key={i}><path d={`M${x - 12} ${y}l12-6 12 6v8l-12 6-12-6Z`} fill={o.edge ?? o.fill} /><path d={`M${x - 12} ${y}l12-6 12 6-12 6Z`} fill={o.fill} /></g>;
      }
    });
    const top = (
      <>
        {o.syrup ? <ellipse cx="48" cy="54" rx="26" ry="9" fill={o.syrup} opacity="0.75" /> : null}
        {pieces}
        {o.tex ? <Dots pts={scatter(`${id}t`, 14, 48, 48, 18, 7)} r={0.8} fill={o.tex} opacity={0.8} /> : null}
        {o.topping ? <Dots pts={scatter(`${id}p`, o.topping[1], 48, 46, 16, 6)} r={1.2} fill={o.topping[0]} /> : null}
        {o.silver ? pos.map(([x, y], i) => <path key={i} d={`M${x - 4} ${y - 2}l3-1.6 3 1 2-1.2`} stroke="#E6E9EE" strokeWidth="1.6" fill="none" strokeLinecap="round" />) : null}
      </>
    );
    return o.bowl ? <Bowl fill={o.syrup ?? '#F4E9D8'}>{top}</Bowl> : <Plate>{top}</Plate>;
  };
}

function fruitOne(draw: () => ReactNode): Draw {
  return () => <><Shadow cy={78} rx={26} />{draw()}</>;
}

function nutPile(id: string, o: { fill: string; edge: string; shape: 'almond' | 'walnut' | 'cashew' | 'pistachio' | 'peanut' | 'seed' | 'tiny'; n?: number; size?: number; mixed?: string[] }): Draw {
  return () => {
    const pts = scatter(id, o.n ?? 11, 48, 47, 20, 7);
    const s = o.size ?? 1;
    const piece = (x: number, y: number, i: number, fill: string) => {
      const rot = (i * 53) % 180;
      switch (o.shape) {
        case 'almond':
          return <ellipse key={i} cx={x} cy={y} rx={4.2 * s} ry={2.4 * s} fill={fill} stroke={o.edge} strokeWidth="0.8" transform={`rotate(${rot} ${x} ${y})`} />;
        case 'walnut':
          return <g key={i} transform={`rotate(${rot} ${x} ${y})`}><ellipse cx={x} cy={y} rx={4.6 * s} ry={3.6 * s} fill={fill} /><path d={`M${x - 3} ${y}c1-2 2 2 3 0s2 2 3 0`} stroke={o.edge} strokeWidth="0.9" fill="none" /></g>;
        case 'cashew':
          return <path key={i} d={`M${x - 4.5 * s} ${y}c0-${3.6 * s} ${3.4 * s}-${5 * s} ${6.4 * s}-${3.4 * s}c${1.4 * s} ${0.8 * s} ${0.6 * s} ${2.4 * s}-${0.8 * s} ${2}c-${1.6 * s}-${0.4 * s}-${3 * s} ${0.4 * s}-${3 * s} ${2 * s}c0 ${1.4 * s}-${2.6 * s} ${1.4 * s}-${2.6 * s}-${0.6 * s}Z`} fill={fill} stroke={o.edge} strokeWidth="0.7" transform={`rotate(${rot} ${x} ${y})`} />;
        case 'pistachio':
          return <g key={i} transform={`rotate(${rot} ${x} ${y})`}><ellipse cx={x} cy={y} rx={4.2 * s} ry={3 * s} fill="#E8D9B8" stroke={o.edge} strokeWidth="0.8" /><ellipse cx={x + 0.6} cy={y} rx={2.4 * s} ry={1.6 * s} fill={fill} /></g>;
        case 'peanut':
          return <g key={i} transform={`rotate(${rot} ${x} ${y})`}><ellipse cx={x} cy={y} rx={2.8 * s} ry={2 * s} fill={fill} stroke={o.edge} strokeWidth="0.6" /></g>;
        case 'seed':
          return <ellipse key={i} cx={x} cy={y} rx={2.6 * s} ry={1.3 * s} fill={fill} stroke={o.edge} strokeWidth="0.4" transform={`rotate(${rot} ${x} ${y})`} />;
        default:
          return <circle key={i} cx={x} cy={y} r={0.9 * s} fill={fill} />;
      }
    };
    return (
      <Bowl fill="#EADFCB" color="#E7D8BF" shade="#CDBBA0">
        {pts.map(([x, y], i) => piece(x, y - 1, i, o.mixed ? o.mixed[i % o.mixed.length]! : o.fill))}
      </Bowl>
    );
  };
}

// ---------------------------------------------------------------------------------------------
// Breads
// ---------------------------------------------------------------------------------------------
A['whole-wheat-roti'] = () => (
  <Plate>
    <ellipse cx="44" cy="51" rx="25" ry="12" fill="#D9A55B" />
    <Flatbread seed="roti" fill="#E9BE78" edge="#C98F45" nSpots={5} />
  </Plate>
);
A['makki-di-roti'] = () => <Plate><Flatbread seed="makki" fill="#F2C442" edge="#D49B1D" spots="#B7741A" nSpots={9} under="#DDAA2C" rx={22} ry={11}><ellipse cx="56" cy="44" rx="5" ry="2" fill="#FFF3B0" opacity="0.8" /></Flatbread></Plate>;
A['missi-roti'] = () => <Plate><Flatbread seed="missi" fill="#E8B04C" edge="#C38A2D" spots="#7E5A1E" nSpots={9} under="#D29A3C"><Leaves pts={scatter('missig', 6, 50, 47, 18, 8)} size={1.8} fill="#4E8F2E" /></Flatbread></Plate>;
A['bajra-roti'] = () => <Plate><Flatbread seed="bajra" fill="#A99A86" edge="#7F705E" spots="#5D5145" nSpots={14} under="#8E7F6C" rx={22} ry={11} /></Plate>;
A['tandoori-roti'] = () => <Plate><Flatbread seed="tandoor" fill="#E3AE62" edge="#B9813D" spots="#6B3E16" nSpots={12} under="#C88F46"><path d="M34 44c6-2 10 2 14 0" stroke="#6B3E16" strokeWidth="1.4" fill="none" opacity="0.5" /></Flatbread></Plate>;
A['plain-paratha'] = paratha('plain-paratha', { fill: '#E6B566', edge: '#B98034', ghee: true });
A['aloo-paratha'] = paratha('aloo-paratha', { fill: '#E3B060', edge: '#B27A2F', filling: ['#F2D27A', '#4E8F2E'], ghee: true });
A['gobhi-paratha'] = paratha('gobhi-paratha', { fill: '#E3B060', edge: '#B27A2F', filling: ['#F7F0DC', '#4E8F2E'] });
A['mooli-paratha'] = paratha('mooli-paratha', { fill: '#E7B868', edge: '#B27A2F', filling: ['#FAFAF2', '#7BB661'] });
A['paneer-paratha'] = paratha('paneer-paratha', { fill: '#E3B060', edge: '#B27A2F', filling: ['#FFF8E7', C.chilli] });
A['methi-paratha'] = paratha('methi-paratha', { fill: '#D9B062', edge: '#A9792F', filling: ['#3E8E3A', '#2F7A2B'] });
A['onion-paratha'] = paratha('onion-paratha', { fill: '#E3B060', edge: '#B27A2F', filling: ['#D7A6D4', '#4E8F2E'] });
A['mixed-vegetable-paratha'] = paratha('mixed-vegetable-paratha', { fill: '#E3B060', edge: '#B27A2F', filling: ['#F0A33A', '#4E8F2E', '#E2553B'] });
A['lachha-paratha'] = paratha('lachha-paratha', { fill: '#E9B966', edge: '#B27A2F', layers: true });
A['plain-naan'] = naan('plain-naan', { fill: '#F3DDB0', spots: '#B9813D' });
A['butter-naan'] = naan('butter-naan', { fill: '#F3D9A4', spots: '#B9813D', butter: true });
A['garlic-naan'] = naan('garlic-naan', { fill: '#F3DDB0', spots: '#B9813D', garlic: true });
A['kulcha'] = naan('kulcha', { fill: '#F6E2B8', spots: '#C28E45', round: true });
A['amritsari-stuffed-kulcha'] = naan('amritsari-stuffed-kulcha', { fill: '#EFCB8A', spots: '#A8692A', round: true, butter: true, stuffed: '#F2D27A' });
A['bhatura'] = puffed('bhatura', { fill: '#F3D49A', edge: '#C9963F', big: true, n: 1 });
A['puri'] = puffed('puri', { fill: '#EDB960', edge: '#C08A33', n: 3 });

// ---------------------------------------------------------------------------------------------
// Rice and grains
// ---------------------------------------------------------------------------------------------
A['plain-basmati-rice'] = rice('plain-basmati-rice', { base: '#F6F2E7', grain: '#DCD3BC', leaves: 1 });
A['brown-rice'] = rice('brown-rice', { base: '#D8BE94', grain: '#B8955E' });
A['jeera-rice'] = rice('jeera-rice', { base: '#F6F0DE', grain: '#DED3B6', bits: [['#6B4A2A', 12, 0.9]], leaves: 3 });
A['vegetable-pulao'] = rice('vegetable-pulao', { base: '#F7EED6', grain: '#E7DBBB', cubes: { fill: '#F0A33A', n: 4 }, bits: [['#5FAE3E', 6, 1.6]], leaves: 2 });
A['matar-pulao'] = rice('matar-pulao', { base: '#FAF4E2', grain: '#E8DEC4', bits: [['#5FAE3E', 11, 1.8]] });
A['vegetable-biryani'] = rice('vegetable-biryani', { base: '#F1D193', grain: '#E39B2B', bits: [['#FFFFFF', 6, 1.4], ['#5FAE3E', 4, 1.5]], cubes: { fill: '#F0A33A', n: 3 }, leaves: 3 });
A['moong-dal-khichdi'] = rice('moong-dal-khichdi', { base: '#F1D27C', grain: '#E7C25A', bowl: true, bits: [['#DDAF3E', 8, 1.2]], leaves: 2 });
A['dalia-khichdi'] = rice('dalia-khichdi', { base: '#D7B47A', grain: '#B99258', bowl: true, bits: [['#5FAE3E', 6, 1.5], ['#F0A33A', 4, 1.4]] });
A['sweet-rice'] = rice('sweet-rice', { base: '#F7CF4E', grain: '#F0B421', bits: [['#B06A2C', 5, 1.4], ['#FFFFFF', 4, 1.2]] });
A['lemon-rice'] = rice('lemon-rice', { base: '#F6E27A', grain: '#E9CC3E', bits: [['#6B4A2A', 6, 0.9], ['#C9A14B', 4, 1.6]], leaves: 3 });
A['curd-rice'] = rice('curd-rice', { base: '#FBFAF5', grain: '#EDEADF', bowl: true, bits: [['#1F1F1F', 6, 0.7], ['#C0392B', 2, 1.2]], leaves: 2 });
A['quinoa-bowl'] = rice('quinoa-bowl', { base: '#EADBB8', grain: '#D2BC8C', bowl: true, bits: [['#E2553B', 4, 2], ['#5FAE3E', 6, 1.8], ['#6C3483', 3, 1.6]] });

// ---------------------------------------------------------------------------------------------
// Dal, chole and beans
// ---------------------------------------------------------------------------------------------
A['yellow-moong-dal'] = curry('yellow-moong-dal', { surface: '#F7CF57', rim: '#F2C14E', bits: [['#E2A92F', 6, 1.3]], leaves: 3, katori: true });
A['whole-green-moong-dal'] = curry('whole-green-moong-dal', { surface: '#9DAE52', rim: '#86973E', beans: { fill: '#5E7A2A', n: 16, r: 1.5 }, leaves: 2, katori: true });
A['masoor-dal'] = curry('masoor-dal', { surface: '#F09A4A', rim: '#E8873A', bits: [['#C2611F', 7, 1.2]], leaves: 3, katori: true });
A['whole-masoor-dal'] = curry('whole-masoor-dal', { surface: '#8E5B3E', rim: '#7A4A30', beans: { fill: '#5A3420', n: 14, r: 1.4 }, leaves: 2, katori: true });
A['toor-dal'] = curry('toor-dal', { surface: '#F4BE3A', rim: '#EBAE25', bits: [['#B4441B', 3, 1.3], ['#1F1F1F', 5, 0.7]], leaves: 4, katori: true });
A['chana-dal'] = curry('chana-dal', { surface: '#ECB94C', rim: '#DEA63A', beans: { fill: '#F6D06A', n: 14, r: 1.7 }, leaves: 2, katori: true });
A['urad-dal'] = curry('urad-dal', { surface: '#EDE2C8', rim: '#E0D2B2', beans: { fill: '#FAF5E8', n: 13, r: 1.6 }, ghee: true, leaves: 2, katori: true });
A['whole-black-urad-dal'] = curry('whole-black-urad-dal', { surface: '#5A3A30', rim: '#4A2E26', beans: { fill: '#2A1A16', n: 15, r: 1.5, eye: '#EDE2C8' }, leaves: 1, katori: true });
A['dal-makhani'] = curry('dal-makhani', { surface: '#7E3B2A', rim: '#6A3022', beans: { fill: '#3B1C16', n: 12, r: 1.5 }, cream: true, leaves: 2 });
A['mixed-dal'] = curry('mixed-dal', { surface: '#DFA449', rim: '#D0923A', beans: { fill: '#8A5A2E', n: 6, r: 1.4 }, bits: [['#F6D06A', 6, 1.5], ['#3F6B2A', 4, 1.3]], leaves: 2, katori: true });
A['dal-tadka'] = curry('dal-tadka', { surface: '#F2B233', rim: '#E59E22', bits: [['#B4441B', 3, 1.4], ['#3F2A1A', 6, 0.8]], ghee: true, chilli: true, leaves: 3, katori: true });
A['rajma'] = curry('rajma', { surface: '#9A3C25', rim: '#84301C', beans: { fill: '#5E1A12', n: 10, r: 2.4 }, leaves: 3 });
A['chole'] = curry('chole', { surface: '#9A5A2E', rim: '#854A22', beans: { fill: '#E5B56C', n: 11, r: 2.3 }, bits: [['#E9D3E8', 3, 1.6]], leaves: 3 });
A['kala-chana'] = curry('kala-chana', { surface: '#6E4430', rim: '#5D3826', beans: { fill: '#3A2418', n: 13, r: 1.9 }, leaves: 3 });
A['lobia'] = curry('lobia', { surface: '#B07A45', rim: '#9C6735', beans: { fill: '#EFE3C8', n: 11, r: 2.1, eye: '#2A1A16' }, leaves: 2 });
A['punjabi-kadhi'] = curry('punjabi-kadhi', { surface: '#F7D65B', rim: '#F0C843', chunks: { fill: '#D99A3A', shade: '#B97C25', n: 4, size: 4 }, bits: [['#B4441B', 2, 1.3]], leaves: 3 });

// ---------------------------------------------------------------------------------------------
// Sabzi and greens
// ---------------------------------------------------------------------------------------------
const POTATO = { fill: '#F3CF6E', shade: '#D9AE45' };
A['aloo-gobhi'] = curry('aloo-gobhi', { surface: '#EDC458', rim: '#E2B240', chunks: { ...POTATO, n: 4 }, chunks2: { fill: '#FBF1D6', shade: '#E9D6A6', n: 4, size: 4.2 }, leaves: 4 });
A['aloo-matar'] = curry('aloo-matar', { surface: '#D9762E', rim: '#C9682A', chunks: { ...POTATO, n: 5 }, bits: [['#5FAE3E', 9, 1.7]], leaves: 2 });
A['aloo-beans'] = curry('aloo-beans', { surface: '#D8B45A', rim: '#C8A04A', chunks: { ...POTATO, n: 4 }, bits: [['#4E9A34', 8, 1.3]], leaves: 1 });
A['aloo-palak'] = curry('aloo-palak', { surface: '#3F7A2E', rim: '#356A26', chunks: { ...POTATO, n: 5 }, leafy: '#2F5E22', leaves: 0 });
A['aloo-methi'] = curry('aloo-methi', { surface: '#A4A43C', rim: '#909030', chunks: { ...POTATO, n: 5 }, leafy: '#4E7A22', leaves: 2 });
A['jeera-aloo'] = curry('jeera-aloo', { surface: '#F2D27A', rim: '#E3BE5C', chunks: { ...POTATO, n: 7, size: 4.6 }, bits: [['#5A3A20', 8, 0.8]], leaves: 4 });
A['bhindi-sabzi'] = curry('bhindi-sabzi', { surface: '#7E9A3A', rim: '#6C882E', bits: [['#4E7A22', 8, 2], ['#EAF0D2', 8, 0.8]], leaves: 1 });
A['bhindi-masala'] = curry('bhindi-masala', { surface: '#B85A2A', rim: '#A44C22', bits: [['#5D8A2A', 9, 2], ['#E9D3E8', 3, 1.6]], leaves: 2 });
A['baingan-bharta'] = curry('baingan-bharta', { surface: '#8A5A46', rim: '#784A38', leafy: '#5E3A2E', bits: [['#E2553B', 4, 1.4], ['#5B2C6F', 3, 1.6]], leaves: 4 });
A['aloo-baingan'] = curry('aloo-baingan', { surface: '#B36A3A', rim: '#9E5A2E', chunks: { ...POTATO, n: 4 }, chunks2: { fill: '#5B2C6F', shade: '#3E1D4C', n: 4 }, leaves: 2 });
A['sarson-da-saag'] = curry('sarson-da-saag', { surface: '#4E7A2A', rim: '#416A22', leafy: '#355C1C', ghee: true, bits: [['#F7D774', 2, 2]], leaves: 0 });
A['palak-saag'] = curry('palak-saag', { surface: '#2F6E2C', rim: '#285E26', leafy: '#22521F', cream: true, leaves: 0 });
A['methi-sabzi'] = curry('methi-sabzi', { surface: '#5E8E2E', rim: '#527E28', leafy: '#3E6E22', bits: [['#C9E28A', 6, 0.9]], leaves: 3 });
A['bathua-saag'] = curry('bathua-saag', { surface: '#6E9246', rim: '#5E823A', leafy: '#9DB878', ghee: true, leaves: 1 });
A['lauki-sabzi'] = curry('lauki-sabzi', { surface: '#D7DFA8', rim: '#C6CF94', cubes: { fill: '#E9F0C6', n: 7 }, leaves: 3 });
A['lauki-chana-dal'] = curry('lauki-chana-dal', { surface: '#E5C46A', rim: '#D8B358', cubes: { fill: '#E2EAC0', n: 5 }, beans: { fill: '#F6D06A', n: 8, r: 1.5 }, leaves: 2 });
A['tori-sabzi'] = curry('tori-sabzi', { surface: '#C5CF8A', rim: '#B4BF78', chunks: { fill: '#9DB35A', shade: '#6E8A30', n: 6 }, leaves: 2 });
A['tinda-sabzi'] = curry('tinda-sabzi', { surface: '#D9C36A', rim: '#C9B158', chunks: { fill: '#C4D69A', shade: '#8EA45E', n: 5, size: 4.8 }, bits: [['#E2553B', 3, 1.3]], leaves: 3 });
A['karela-sabzi'] = curry('karela-sabzi', { surface: '#5D6E2A', rim: '#4F5E22', bits: [['#3D5A1A', 8, 2.2], ['#C9D88A', 8, 0.9]], leaves: 0 });
A['patta-gobhi-matar'] = curry('patta-gobhi-matar', { surface: '#E5E6B5', rim: '#D4D6A0', leafy: '#C6D89A', bits: [['#5FAE3E', 9, 1.7]], leaves: 1 });
A['gajar-matar'] = curry('gajar-matar', { surface: '#E9B55A', rim: '#DCA448', cubes: { fill: '#F08A24', n: 8, size: 4 }, bits: [['#5FAE3E', 7, 1.7]], leaves: 1 });
A['mixed-vegetable-sabzi'] = curry('mixed-vegetable-sabzi', { surface: '#9DC75A', rim: '#8DBB4C', cubes: { fill: '#F0A33A', n: 3 }, chunks: { ...POTATO, n: 2 }, bits: [['#4E8F2E', 4, 2.2], ['#F5E6B8', 3, 1.6]], leaves: 2 });
A['mushroom-matar'] = curry('mushroom-matar', { surface: '#C27A3E', rim: '#AE6A32', bits: [['#5FAE3E', 8, 1.6]], chunks: { fill: '#E9DCC6', shade: '#B9A483', n: 5, size: 4 }, leaves: 2 });
A['shalgam-sabzi'] = curry('shalgam-sabzi', { surface: '#CFA0B8', rim: '#BD8CA6', cubes: { fill: '#F6EFF3', n: 6, size: 4.6 }, bits: [['#9B4F86', 4, 1.4]], leaves: 3 });
A['gajar-gobhi-shalgam-sabzi'] = curry('gajar-gobhi-shalgam-sabzi', { surface: '#E8B860', rim: '#DCA84E', cubes: { fill: '#F08A24', n: 4, size: 4 }, chunks2: { fill: '#FBF1D6', shade: '#E9D6A6', n: 3 }, bits: [['#C987C4', 4, 1.7]], leaves: 2 });
A['soya-chunk-curry'] = curry('soya-chunk-curry', { surface: '#B9562A', rim: '#A44A22', chunks: { fill: '#D9B07A', shade: '#A97E48', n: 7, size: 4 }, leaves: 3 });

// ---------------------------------------------------------------------------------------------
// Paneer and vegetarian protein
// ---------------------------------------------------------------------------------------------
const PANEER = { fill: '#FFF8E7', n: 6 };
A['paneer-bhurji'] = () => (
  <Plate>
    <Chunks pts={scatter('pbh', 10, 48, 50, 18, 7)} fill="#FBF0CF" shade="#E8D6A2" size={4.6} />
    <Dots pts={scatter('pbht', 6, 48, 50, 16, 6)} r={1.4} fill={C.tomato} />
    <Dots pts={scatter('pbhy', 6, 48, 50, 16, 6)} r={1.1} fill="#F2C14E" />
    <Leaves pts={scatter('pbhg', 6, 48, 48, 15, 6)} size={2} />
  </Plate>
);
A['matar-paneer'] = curry('matar-paneer', { surface: '#D9682E', rim: '#C85C28', cubes: PANEER, bits: [['#5FAE3E', 8, 1.7]], leaves: 2 });
A['palak-paneer'] = curry('palak-paneer', { surface: '#3C7A2E', rim: '#336A28', leafy: '#2F6224', cubes: PANEER, cream: true, leaves: 0 });
A['shahi-paneer'] = curry('shahi-paneer', { surface: '#F2B266', rim: '#E7A256', cubes: PANEER, cream: true, bits: [['#B9814A', 4, 1.3]], leaves: 2 });
A['paneer-butter-masala'] = curry('paneer-butter-masala', { surface: '#E8642A', rim: '#D95A24', cubes: PANEER, cream: true, ghee: true, leaves: 2 });
A['kadai-paneer'] = curry('kadai-paneer', { surface: '#B8452A', rim: '#A63C22', cubes: { fill: '#FFF8E7', n: 5 }, chunks: { fill: '#4E9A34', shade: '#2F7A2B', n: 3, size: 3.6 }, bits: [['#E9D3E8', 3, 1.6]], leaves: 1 });
A['paneer-tikka'] = skewerPlate('paneer-tikka', { piece: '#F6C46A', char: '#9C5B24', shape: 'cube', onion: true, lemon: true });
A['paneer-tikka-masala'] = curry('paneer-tikka-masala', { surface: '#D4532A', rim: '#C24824', cubes: { fill: '#F2B05A', n: 6 }, cream: true, bits: [['#4E9A34', 3, 1.7]], leaves: 1 });
A['chilli-paneer'] = () => (
  <Plate>
    <Cubes pts={scatter('chp', 8, 48, 49, 18, 7)} fill="#D9874A" size={6.4} stroke="#8E4A1E" />
    <Chunks pts={scatter('chpg', 4, 48, 49, 18, 7)} fill="#4E9A34" shade="#2F7A2B" size={3.4} />
    <Chunks pts={scatter('chpr', 3, 48, 49, 18, 7)} fill="#E2553B" size={3} />
    <path d="M30 56c8 3 26 3 36-1" stroke="#6E2A12" strokeWidth="2" fill="none" opacity="0.5" strokeLinecap="round" />
  </Plate>
);
A['malai-kofta'] = curry('malai-kofta', { surface: '#F0B060', rim: '#E4A050', cream: true, bits: [['#B9814A', 3, 1.2]], chunks: { fill: '#C98A45', shade: '#9C6326', n: 3, size: 5.2 }, leaves: 2 });
A['tofu-stir-fry'] = () => (
  <Plate>
    <Cubes pts={scatter('tofu', 6, 48, 49, 18, 7)} fill="#F4E4BE" size={6.2} stroke="#D9C38E" />
    <Chunks pts={scatter('tofug', 4, 48, 49, 18, 7)} fill="#5FAE3E" shade="#2F7A2B" size={3.4} />
    <Chunks pts={scatter('tofur', 3, 48, 49, 18, 7)} fill="#E2553B" size={3} />
    <Dots pts={scatter('tofus', 6, 48, 49, 16, 6)} r={0.8} fill="#F5EBD0" />
  </Plate>
);
A['soy-keema'] = curry('soy-keema', { surface: '#B3743E', rim: '#9E6534', leafy: '#8E5A2E', bits: [['#5FAE3E', 6, 1.6]], leaves: 3 });

// ---------------------------------------------------------------------------------------------
// Eggs
// ---------------------------------------------------------------------------------------------
A['boiled-eggs'] = eggsPlate('boiled-eggs', 'boiled');
A['scrambled-eggs'] = eggsPlate('scrambled-eggs', 'scrambled');
A['egg-bhurji'] = eggsPlate('egg-bhurji', 'bhurji');
A['plain-omelette'] = eggsPlate('plain-omelette', 'omelette');
A['masala-omelette'] = eggsPlate('masala-omelette', 'masala-omelette');
A['fried-eggs'] = eggsPlate('fried-eggs', 'fried');
A['egg-whites'] = eggsPlate('egg-whites', 'whites');
A['egg-curry'] = () => (
  <Bowl fill="#B54C24">
    <ellipse cx="48" cy="45" rx="24" ry="6" fill="#C9582A" />
    {[[37, 45], [50, 43], [60, 46]].map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y} rx="6" ry="3.2" fill="#FFFFFF" /><ellipse cx={x} cy={y} rx="2.8" ry="1.7" fill="#F4B63A" /></g>)}
    <Leaves pts={scatter('eggcg', 3, 48, 43, 16, 3)} />
  </Bowl>
);
A['egg-and-toast'] = () => (
  <Plate>
    <path d="M22 54V40c0-5 4-8 9-8h10c5 0 9 3 9 8v14Z" fill="#D9A55B" />
    <path d="M24.5 52V41c0-3.5 3-6 6.5-6h10c3.5 0 6.5 2.5 6.5 6v11Z" fill="#F3DDB0" />
    <path d="M50 54c-1-6 6-10 13-9s13 4 12 8c-4 4-21 5-25 1Z" fill="#FFFFFF" stroke="#EFE9DF" strokeWidth="1.2" />
    <circle cx="62" cy="50" r="5" fill="#F7B21E" />
    <circle cx="60.8" cy="48.8" r="1.6" fill="#FFD66B" />
  </Plate>
);
A['egg-paratha'] = paratha('egg-paratha', { fill: '#E6B566', edge: '#B98034', filling: ['#F6D15C', '#FFFFFF', '#4E8F2E'] });

// ---------------------------------------------------------------------------------------------
// Chicken, meat and fish
// ---------------------------------------------------------------------------------------------
const CHICKEN = { fill: '#E9B27A', shade: '#B9814A' };
A['punjabi-chicken-curry'] = curry('punjabi-chicken-curry', { surface: '#B8452A', rim: '#A33A22', chunks: { ...CHICKEN, n: 5 }, bits: [['#E2553B', 2, 1.4]], leaves: 4 });
A['butter-chicken'] = curry('butter-chicken', { surface: '#E8762E', rim: '#DA6A28', chunks: { fill: '#D98A4A', shade: '#9C5B24', n: 5 }, cream: true, ghee: true, leaves: 2 });
A['chicken-tikka'] = skewerPlate('chicken-tikka', { piece: '#E2793A', char: '#7A3A16', shape: 'cube', onion: true, lemon: true });
A['tandoori-chicken'] = () => (
  <Plate>
    <path d="M28 58c-4-10 6-20 18-20 10 0 14 6 12 12-2 7-10 10-18 12-6 2-10 1-12-4Z" fill="#D5502A" stroke="#8E2E14" strokeWidth="1.2" />
    <path d="M56 46l14-8" stroke="#F3E3C8" strokeWidth="4" strokeLinecap="round" />
    <circle cx="71" cy="37.5" r="3" fill="#F3E3C8" />
    <Dots pts={scatter('tand', 6, 42, 50, 10, 6)} r={1.2} fill="#7A2A12" opacity={0.7} />
    <ellipse cx="62" cy="60" rx="6" ry="2.4" fill="none" stroke="#C987C4" strokeWidth="1.6" />
    <path d="M66 54a6 6 0 0 1 12 0Z" fill="#F4D03F" stroke="#D4AC0D" strokeWidth="1" />
  </Plate>
);
A['chicken-tikka-masala'] = curry('chicken-tikka-masala', { surface: '#D9562B', rim: '#C84B24', chunks: { fill: '#C9692E', shade: '#7A3A16', n: 5 }, cream: true, leaves: 3 });
A['chicken-saag'] = curry('chicken-saag', { surface: '#3F7A2E', rim: '#356A26', leafy: '#2F5E22', chunks: { ...CHICKEN, n: 5 }, leaves: 0 });
A['grilled-chicken-breast'] = () => (
  <Plate>
    <path d="M24 54c-2-10 10-16 24-16s26 5 24 13c-2 7-14 9-26 9s-20-1-22-6Z" fill="#E7B57E" stroke="#B9814A" strokeWidth="1.3" />
    {[34, 42, 50, 58].map((x) => <path key={x} d={`M${x} 42l-6 14`} stroke="#8A5228" strokeWidth="2" strokeLinecap="round" opacity="0.7" />)}
    <Leaves pts={[[62, 56], [66, 54]]} size={2.6} />
  </Plate>
);
A['chicken-thigh'] = () => (
  <Plate>
    <path d="M26 56c-3-9 8-17 20-17 9 0 18 4 18 11 0 8-10 11-20 11-9 0-16 0-18-5Z" fill="#C97A3E" stroke="#8A4A1E" strokeWidth="1.3" />
    <path d="M32 50c6-4 16-5 24-2" stroke="#E6A56A" strokeWidth="2.2" fill="none" strokeLinecap="round" opacity="0.8" />
    <Dots pts={scatter('thigh', 5, 46, 50, 12, 5)} r={0.9} fill="#5A2A10" />
    <Leaves pts={[[66, 58], [70, 55]]} size={2.4} />
  </Plate>
);
A['chicken-keema'] = curry('chicken-keema', { surface: '#B3743E', rim: '#9E6534', leafy: '#E3B07A', bits: [['#5FAE3E', 5, 1.6]], leaves: 3 });
A['chicken-biryani'] = rice('chicken-biryani', { base: '#F0D29A', grain: '#E39B33', chunks: { fill: '#C9692E', shade: '#7A3A16', n: 4 }, bits: [['#FFFFFF', 5, 1.3], ['#7A4A22', 4, 1.2]], leaves: 3 });
A['lamb-or-goat-curry'] = curry('lamb-or-goat-curry', { surface: '#7E3420', rim: '#6C2C1A', chunks: { fill: '#6A3420', shade: '#3E1A0E', n: 5, size: 4.6 }, bits: [['#E2C29A', 2, 1.5]], leaves: 3 });
A['lamb-or-goat-keema'] = curry('lamb-or-goat-keema', { surface: '#7A3E26', rim: '#68341E', leafy: '#4E2414', bits: [['#5FAE3E', 7, 1.6]], leaves: 2 });
A['seekh-kebab'] = skewerPlate('seekh-kebab', { piece: '#8E4A28', char: '#4A2210', shape: 'log', onion: true, lemon: true });
A['fish-curry'] = curry('fish-curry', { surface: '#E39B2E', rim: '#D58A24', chunks: { fill: '#F6E7D0', shade: '#D6BE98', n: 4, size: 5.2 }, bits: [['#2F7A2B', 3, 1.8]], leaves: 2 });
A['amritsari-fish'] = () => (
  <Plate>
    {scatter('amfish', 5, 46, 50, 16, 6).map(([x, y], i) => (
      <path key={i} d={`M${x - 7} ${y}c0-4 4-6 8-6s7 2 7 5-3 6-8 6-7-2-7-5Z`} fill="#E3A23E" stroke="#B5741E" strokeWidth="1" transform={`rotate(${i * 37} ${x} ${y})`} />
    ))}
    <Dots pts={scatter('amfishd', 10, 46, 50, 16, 6)} r={0.8} fill="#9C5B14" />
    <path d="M64 56a6 6 0 0 1 12 0Z" fill="#F4D03F" stroke="#D4AC0D" strokeWidth="1" />
    <Leaves pts={[[60, 60], [57, 62]]} size={2.2} />
  </Plate>
);
A['grilled-fish'] = () => (
  <Plate>
    <path d="M22 52c6-10 22-14 36-12 6 1 10 4 12 6l8-6v14l-8-4c-4 4-14 8-26 8-12 0-20-2-22-6Z" fill="#EEDCC0" stroke="#B99A6A" strokeWidth="1.3" />
    {[34, 42, 50].map((x) => <path key={x} d={`M${x} 44l-4 12`} stroke="#8A6A3A" strokeWidth="1.8" strokeLinecap="round" opacity="0.6" />)}
    <path d="M60 58a5 5 0 0 1 10 0Z" fill="#F4D03F" stroke="#D4AC0D" strokeWidth="1" />
    <Leaves pts={[[28, 58], [32, 60]]} size={2.2} />
  </Plate>
);
A['salmon-fillet'] = () => (
  <Plate>
    <path d="M24 56c-2-8 6-16 20-17 14-1 28 3 28 10 0 6-10 10-24 11-12 1-22 0-24-4Z" fill="#F08A5D" stroke="#C9643A" strokeWidth="1.3" />
    {[34, 42, 50, 58].map((x) => <path key={x} d={`M${x} 42c-3 5-3 10 0 15`} stroke="#FFD3C0" strokeWidth="1.6" fill="none" opacity="0.9" />)}
    <path d="M60 60c4-2 8-2 12 0" stroke={C.cilantro} strokeWidth="2.4" strokeLinecap="round" />
  </Plate>
);
A['canned-tuna'] = () => (
  <>
    <Shadow cy={76} rx={26} />
    <path d="M22 50v14c0 6 12 10 26 10s26-4 26-10V50Z" fill="#C9CED6" />
    <path d="M22 54h52" stroke="#AEB4BD" strokeWidth="1.4" />
    <path d="M22 60h52" stroke="#AEB4BD" strokeWidth="1.4" />
    <ellipse cx="48" cy="50" rx="26" ry="9" fill="#AEB4BD" />
    <ellipse cx="48" cy="49.5" rx="23" ry="7.4" fill="#E9C9A6" />
    <Chunks pts={scatter('tuna', 8, 48, 49, 18, 5)} fill="#D9AE82" shade="#B58658" size={3.6} />
  </>
);
A['turkey-slices'] = () => (
  <Plate>
    {[[34, 50], [48, 46], [62, 50]].map(([x, y], i) => (
      <g key={i}>
        <ellipse cx={x} cy={y} rx="11" ry="6" fill="#F2D6C2" stroke="#D9B39A" strokeWidth="1.2" />
        <path d={`M${x! - 7} ${y}c4-2 10-2 14 0`} stroke="#E6C0A8" strokeWidth="1.4" fill="none" />
      </g>
    ))}
    <Leaves pts={[[48, 58], [52, 60]]} size={2.4} fill="#5FAE3E" />
  </Plate>
);
A['roast-chicken'] = () => (
  <Plate>
    <path d="M24 54c-2-12 10-20 24-20s26 8 24 20c-2 6-12 8-24 8s-22-2-24-8Z" fill="#C9722E" stroke="#8E4A1A" strokeWidth="1.4" />
    <path d="M32 44c6-4 18-6 28-2" stroke="#E6A05A" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.8" />
    <path d="M70 50l8-4M26 50l-8-4" stroke="#F3E3C8" strokeWidth="3.4" strokeLinecap="round" />
    <Leaves pts={[[40, 60], [56, 61]]} size={2.4} />
  </Plate>
);

// ---------------------------------------------------------------------------------------------
// Milk, dahi and raita
// ---------------------------------------------------------------------------------------------
function dahiBowl(id: string, o: { white?: string; bits?: [string, number, number][]; thick?: boolean; cup?: string; leaves?: number; swirl?: string }): Draw {
  return () => (
    <>
      <ellipse cx="48" cy="78" rx="26" ry="5" fill="#000" opacity="0.08" />
      <path d="M16 46h64c0 18-14 30-32 30S16 64 16 46Z" fill={o.cup ?? '#7FB3E8'} />
      <ellipse cx="48" cy="46" rx="32" ry="10" fill={o.cup ? '#00000022' : '#5E97D6'} />
      <ellipse cx="48" cy="45.5" rx="29" ry="8.5" fill={o.white ?? '#FBFBF7'} />
      {o.thick ? <path d="M34 44c5-5 12 3 16-1s9-3 12 1" fill="none" stroke="#E7E5DC" strokeWidth="3" strokeLinecap="round" /> : <ellipse cx="42" cy="43" rx="6" ry="1.5" fill="#FFFFFF" />}
      {o.swirl ? <path d="M38 46c4-3 10 2 14-1" fill="none" stroke={o.swirl} strokeWidth="2" strokeLinecap="round" /> : null}
      {(o.bits ?? []).map(([fill, n, r], i) => <Dots key={i} pts={scatter(`${id}x${i}`, n, 48, 45, 22, 5)} r={r} fill={fill} />)}
      <Leaves pts={scatter(`${id}g`, o.leaves ?? 0, 48, 44, 18, 4)} size={2} />
    </>
  );
}
A['plain-dahi'] = dahiBowl('plain-dahi', {});
A['greek-yogurt'] = dahiBowl('greek-yogurt', { thick: true, cup: '#E8EEF4', white: '#FFFFFF', bits: [['#3B5BA9', 3, 1.8]] });
A['skyr'] = dahiBowl('skyr', { thick: true, cup: '#D8E6D2', white: '#FCFCF8', swirl: '#E8E4D8' });
A['boondi-raita'] = dahiBowl('boondi-raita', { bits: [['#E9A83A', 12, 1.8], ['#9C5B24', 4, 0.7]], leaves: 2 });
A['cucumber-raita'] = dahiBowl('cucumber-raita', { bits: [['#8CC152', 12, 1.4], ['#3F7A2E', 5, 0.9]], leaves: 2 });
A['mixed-vegetable-raita'] = dahiBowl('mixed-vegetable-raita', { bits: [['#E2553B', 6, 1.5], ['#C987C4', 6, 1.4], ['#8CC152', 5, 1.3]], leaves: 2 });
A['paneer-cubes'] = () => (
  <Plate>
    {([[34, 52], [46, 48], [58, 52], [40, 44], [54, 43], [50, 56]] as [number, number][]).map(([x, y], i) => (
      <g key={i}><path d={`M${x - 6} ${y - 2}l6-3.5 6 3.5v5l-6 3.5-6-3.5Z`} fill="#EFE3C6" /><path d={`M${x - 6} ${y - 2}l6-3.5 6 3.5-6 3.5Z`} fill="#FFF9EA" /></g>
    ))}
  </Plate>
);
A['cottage-cheese'] = () => (
  <Bowl fill="#EFE8D2" color="#DCE7F0" shade="#B9CBDB">
    {scatter('cottage', 18, 48, 45, 23, 5).map(([x, y], i) => <circle key={i} cx={x} cy={y} r={2.2} fill="#FFFFFF" stroke="#DCD3B8" strokeWidth="0.7" />)}
  </Bowl>
);
A['milk'] = () => <Glass liquid="#FBFBF7" level={0.82} top="#FFFFFF" />;
A['cheese-slice'] = () => (
  <Plate>
    <path d="M28 48l18-12 26 8-18 14Z" fill="#F4B63A" />
    <path d="M28 48l26 10v4L28 52Z" fill="#E09A20" />
    <path d="M54 58l18-14v4L54 62Z" fill="#D18A18" />
    <circle cx="44" cy="45" r="2" fill="#E09A20" />
    <circle cx="56" cy="47" r="1.6" fill="#E09A20" />
  </Plate>
);
A['khoa'] = () => (
  <Plate>
    <Mound fill="#F3E1BD" rx={18} h={14} cy={54} edge="#DCC394" />
    <Dots pts={scatter('khoa', 14, 48, 47, 14, 5)} r={1.2} fill="#E5CF9F" />
  </Plate>
);
A['unsweetened-soy-beverage'] = () => <Glass liquid="#EFE3C4" level={0.78} top="#F6ECD3"><ellipse cx="68" cy="74" rx="5" ry="3.4" fill="#D9C27A" stroke="#B89F52" strokeWidth="0.8" /><ellipse cx="74" cy="76" rx="4" ry="2.8" fill="#D9C27A" stroke="#B89F52" strokeWidth="0.8" /></Glass>;
A['unsweetened-almond-beverage'] = () => <Glass liquid="#F4EEE2" level={0.78} top="#FAF6EE"><ellipse cx="70" cy="74" rx="5" ry="2.8" fill="#B07A4A" transform="rotate(-20 70 74)" /><ellipse cx="76" cy="77" rx="4.4" ry="2.4" fill="#A06A3A" transform="rotate(15 76 77)" /></Glass>;

// ---------------------------------------------------------------------------------------------
// Chai, coffee and drinks
// ---------------------------------------------------------------------------------------------
A['milk-chai'] = () => <Cup liquid="#C99460" highlight="#DDB27F" />;
A['masala-chai'] = () => <Cup liquid="#B9804C" highlight="#D5A06A"><path d="M66 70l8-6 2 4-8 4Z" fill="#7A4A22" /><circle cx="72" cy="74" r="2" fill="#5A3A20" /></Cup>;
A['ginger-chai'] = () => <Cup liquid="#C8955A" highlight="#E0B77F"><path d="M64 72c2-4 8-4 10-1 2 3-1 6-5 5" fill="#E8C27A" stroke="#C49A4A" strokeWidth="1" /></Cup>;
A['elaichi-chai'] = () => <Cup liquid="#CC9A66" highlight="#E2BA88"><ellipse cx="68" cy="74" rx="3" ry="1.8" fill="#9DB35A" transform="rotate(25 68 74)" /><ellipse cx="74" cy="76" rx="3" ry="1.8" fill="#8BA24A" transform="rotate(-20 74 76)" /></Cup>;
A['black-tea'] = () => <Mug liquid="#8A3B12" body="#FFFFFF" />;
A['green-tea'] = () => <Mug liquid="#C9C35A" body="#FFFFFF"><Leaves pts={[[70, 74], [75, 76]]} size={3} fill="#6E9A3A" /></Mug>;
A['black-coffee'] = () => <Mug liquid="#3B2416" />;
A['coffee-with-milk'] = () => <Mug liquid="#8E5E3A" />;
A['double-double-style-coffee'] = () => (
  <>
    <Steam xs={[42, 52]} y={14} color="#B9A08A" />
    <Shadow cx={48} cy={82} rx={20} ry={4} />
    <path d="M30 28h36l-5 50a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4Z" fill="#F4F1EC" />
    <rect x="28" y="22" width="40" height="8" rx="3" fill="#DCD5CC" />
    <path d="M33 46h30l-1.6 16H34.6Z" fill="#C0392B" opacity="0.85" />
    <path d="M44 22v-3h8v3" fill="#DCD5CC" />
  </>
);
A['latte'] = () => <Mug liquid="#B78456" foam="#F3E3CC" steam={false}><path d="M41 39.5c2-2 6-2 8 0-2 1.6-6 1.6-8 0Z" fill="#B78456" /></Mug>;
A['iced-coffee'] = () => <Glass liquid="#8A5A36" level={0.75} ice straw="#2F9E44" top="#B3825A" />;
A['sweet-lassi'] = () => <Glass liquid="#FBF4E2" level={0.85} top="#FFFFFF"><Dots pts={[[44, 33], [50, 32]]} r={1.4} fill="#E9C46A" /></Glass>;
A['salted-lassi'] = () => <Glass liquid="#F7F6EE" level={0.85} top="#FFFFFF"><Leaves pts={[[46, 33], [50, 34]]} size={2.2} fill="#4E8F2E" /><Dots pts={[[54, 33]]} r={0.8} fill="#6B4A2A" /></Glass>;
A['mango-lassi'] = () => <Glass liquid="#F6B53C" level={0.85} top="#F9CB64"><Dots pts={[[46, 33]]} r={1.4} fill="#B5651D" /></Glass>;
A['chaas'] = () => <Glass liquid="#F1F2E8" level={0.72} top="#F8F9F2"><Leaves pts={[[44, 40], [50, 41], [54, 39]]} size={2.4} fill="#3F8E3A" /><Dots pts={scatter('chaas', 4, 48, 41, 8, 1)} r={0.7} fill="#6B4A2A" /></Glass>;
A['badam-milk'] = () => <Glass liquid="#F5E3A8" level={0.8} top="#F8EBC0"><Dots pts={[[44, 31], [50, 32], [53, 30]]} r={1.2} fill="#C8915A" /><Dots pts={[[47, 30]]} r={1} fill="#C0392B" /></Glass>;
A['turmeric-milk'] = () => <Mug liquid="#F2B21E" foam="#F7CC58" />;
A['fruit-juice'] = () => <Glass liquid="#F59B23" level={0.82} top="#F8B24A"><path d="M60 22a7 7 0 0 1 12 6Z" fill="#F6A623" stroke="#E08A10" strokeWidth="1" /></Glass>;
A['soft-drink'] = () => <Glass liquid="#5A2E1E" level={0.8} ice straw="#E2553B"><Dots pts={scatter('soda', 7, 48, 52, 8, 14)} r={0.9} fill="#C8A08A" /></Glass>;
A['lemon-water'] = () => <Glass liquid="#EEF6D8" level={0.8} ice><circle cx="62" cy="26" r="7" fill="#F4E04D" stroke="#D4C10D" strokeWidth="1" /><path d="M62 19v14M55 26h14" stroke="#FFF7B0" strokeWidth="1" /><Leaves pts={[[46, 34], [50, 36]]} size={2.2} fill="#3F8E3A" /></Glass>;
A['sweet-lemonade'] = () => <Glass liquid="#F6E98A" level={0.82} ice straw="#F4D03F"><path d="M60 22a7 7 0 0 1 12 6Z" fill="#F4E04D" stroke="#D4C10D" strokeWidth="1" /></Glass>;
A['coconut-water'] = () => (
  <>
    <Shadow cy={80} rx={24} />
    <circle cx="48" cy="52" r="24" fill="#5E8E2E" />
    <path d="M30 40c6-8 16-12 26-10" stroke="#7FB04A" strokeWidth="3" fill="none" strokeLinecap="round" />
    <ellipse cx="48" cy="34" rx="12" ry="5" fill="#F5F2E2" stroke="#4E7A22" strokeWidth="2" />
    <path d="M52 34l10-18" stroke="#E2553B" strokeWidth="3" strokeLinecap="round" />
  </>
);
A['water'] = () => <Glass liquid="#DDEEFB" level={0.82} top="#EAF5FD"><path d="M42 52c2-2 4-2 6 0" stroke="#FFFFFF" strokeWidth="1.4" fill="none" /></Glass>;
A['sports-drink'] = () => (
  <>
    <Shadow cx={48} cy={84} rx={16} ry={3.4} />
    <rect x="42" y="12" width="12" height="8" rx="2" fill="#2E6FD8" />
    <path d="M38 20h20v6l4 6v44a6 6 0 0 1-6 6H40a6 6 0 0 1-6-6V32l4-6Z" fill="#7FC8F5" />
    <path d="M34 44h28v14H34Z" fill="#FFFFFF" opacity="0.85" />
    <path d="M38 30v40" stroke="#FFFFFF" strokeWidth="2" opacity="0.6" strokeLinecap="round" />
  </>
);

// ---------------------------------------------------------------------------------------------
// Breakfast and simple meals
// ---------------------------------------------------------------------------------------------
A['oatmeal'] = curry('oatmeal', { surface: '#EBD5AB', rim: '#E2C899', bits: [['#3B5BA9', 3, 2.6], ['#C0392B', 2, 2.6]], leaves: 0 });
A['overnight-oats'] = () => (
  <Jar fill="#EADBB9" lid="#B8C5D6">
    <path d="M28 52h36" stroke="#F4EAD4" strokeWidth="5" />
    <Dots pts={scatter('ovn', 6, 46, 44, 12, 3)} r={2} fill="#C0392B" />
    <Dots pts={scatter('ovn2', 4, 46, 62, 12, 8)} r={0.9} fill="#9C8A6A" />
  </Jar>
);
A['sweet-dalia'] = curry('sweet-dalia', { surface: '#EEDDB8', rim: '#E4CFA4', bits: [['#B9814A', 9, 0.9], ['#C8915A', 3, 1.5]], leaves: 0 });
A['savoury-dalia'] = curry('savoury-dalia', { surface: '#D8B87E', rim: '#C9A86C', bits: [['#5FAE3E', 7, 1.6], ['#F0A33A', 4, 1.5], ['#B9814A', 8, 0.8]], leaves: 3 });
A['poha'] = rice('poha', { base: '#F6E27A', grain: '#F2D24A', bits: [['#5FAE3E', 5, 1.6], ['#C9A14B', 6, 1.4], ['#3F2A1A', 4, 0.8]], leaves: 4 });
A['upma'] = () => (
  <Plate>
    <Mound fill="#F1E3BE" rx={22} h={16} cy={56} edge="#DCC78F" />
    <Dots pts={scatter('upma', 18, 48, 48, 17, 6)} r={0.9} fill="#E2CF9E" />
    <Dots pts={scatter('upmav', 5, 48, 48, 16, 6)} r={1.5} fill="#5FAE3E" />
    <Dots pts={scatter('upmac', 3, 48, 48, 16, 6)} r={1.5} fill="#F0A33A" />
    <Leaves pts={scatter('upmal', 3, 48, 44, 12, 4)} size={2.2} />
  </Plate>
);
A['besan-chilla'] = () => <Plate><Flatbread seed="besan-chilla" fill="#F0BE4A" edge="#C9932A" spots="#9C6B1A" nSpots={6} rx={24}><Leaves pts={scatter('bchl', 6, 50, 47, 18, 8)} size={1.9} /><Dots pts={scatter('bcho', 4, 50, 47, 18, 8)} r={1.2} fill={C.onion} /></Flatbread></Plate>;
A['moong-dal-chilla'] = () => <Plate><Flatbread seed="moong-chilla" fill="#D9C35A" edge="#B4A03A" spots="#7E8A2A" nSpots={7} rx={24}><Leaves pts={scatter('mchl', 5, 50, 47, 18, 8)} size={1.9} /><Dots pts={scatter('mcht', 3, 50, 47, 18, 8)} r={1.2} fill={C.tomato} /></Flatbread></Plate>;
function toast(id: string, spread?: string, top?: ReactNode): Draw {
  return () => (
    <Plate>
      <path d="M30 56V38c0-6 5-10 11-10h14c6 0 11 4 11 10v18Z" fill="#C98F45" />
      <path d="M33 54V39c0-4 4-7 8-7h14c4 0 8 3 8 7v15Z" fill={spread ?? '#F1D49A'} />
      {spread ? null : <Dots pts={scatter(id, 6, 48, 44, 9, 7)} r={0.8} fill="#D9B06A" />}
      {top}
    </Plate>
  );
}
A['plain-toast'] = toast('plain-toast', undefined, <ellipse cx="46" cy="42" rx="6" ry="2" fill={C.ghee} opacity="0.8" />);
A['peanut-butter-toast'] = toast('peanut-butter-toast', '#C9863E', <Dots pts={scatter('pbt', 4, 48, 44, 8, 6)} r={1} fill="#9E6224" />);
A['avocado-toast'] = toast('avocado-toast', '#9CC65A', <><Dots pts={scatter('avt', 5, 48, 44, 8, 6)} r={1.4} fill="#6E9A3A" /><Dots pts={scatter('avtc', 5, 48, 44, 8, 6)} r={0.7} fill={C.chilli} /></>);
A['cereal-with-milk'] = () => (
  <Bowl fill="#FBFBF7">
    {scatter('cereal', 14, 48, 45, 22, 5).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="2.3" fill="none" stroke={['#E9A83A', '#D9822B', '#F2C14E'][i % 3]} strokeWidth="1.7" />)}
  </Bowl>
);
A['yogurt-with-granola'] = () => (
  <Glass liquid="#FBFBF7" level={0.85} top="#FFFFFF">
    <path d="M33 52h30" stroke="#C99A5B" strokeWidth="5" />
    <Dots pts={scatter('granola', 8, 48, 52, 12, 2)} r={1.2} fill="#9E6A2E" />
    <Dots pts={[[43, 32], [49, 31], [54, 33]]} r={2.2} fill="#3B5BA9" />
    <Dots pts={[[46, 30]]} r={2.2} fill="#C0392B" />
  </Glass>
);
A['protein-pancakes'] = () => (
  <Plate>
    {[56, 50, 44].map((y, i) => <g key={y}><ellipse cx="48" cy={y + 2} rx="20" ry="6" fill="#C98F45" /><ellipse cx="48" cy={y} rx="20" ry="6" fill={i === 2 ? '#E9B866' : '#DDA552'} /></g>)}
    <path d="M40 42c4 2 10 2 14 0" stroke="#B5651D" strokeWidth="2.4" fill="none" strokeLinecap="round" opacity="0.8" />
    <Dots pts={[[44, 42], [52, 43]]} r={2} fill="#3B5BA9" />
  </Plate>
);
A['idli'] = () => (
  <Plate>
    {[[36, 51], [58, 51], [47, 44]].map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y! + 2} rx="11" ry="5.5" fill="#E9E6DC" /><ellipse cx={x} cy={y} rx="11" ry="5.5" fill="#FBFAF4" /></g>)}
    <ellipse cx="66" cy="60" rx="7" ry="3" fill="#7CB55A" />
  </Plate>
);
A['dosa'] = () => (
  <Plate>
    <path d="M18 56L72 34c6-2 10 4 6 8L30 64c-6 2-14-2-12-8Z" fill="#E7A84A" stroke="#C0802A" strokeWidth="1.3" />
    <path d="M24 56l46-18" stroke="#F3C77A" strokeWidth="2" opacity="0.8" />
    <ellipse cx="64" cy="58" rx="6" ry="2.6" fill="#F7F3E8" />
    <ellipse cx="74" cy="56" rx="5" ry="2.2" fill="#7CB55A" />
  </Plate>
);

// ---------------------------------------------------------------------------------------------
// Snacks and chaat
// ---------------------------------------------------------------------------------------------
A['punjabi-samosa'] = () => (
  <Plate>
    {[[36, 54], [58, 52]].map(([x, y], i) => (
      <g key={i}>
        <path d={`M${x! - 12} ${y! + 4}L${x} ${y! - 14}L${x! + 12} ${y! + 4}Z`} fill="#E5A84A" stroke="#B9782A" strokeWidth="1.4" strokeLinejoin="round" />
        <path d={`M${x} ${y! - 14}L${x! + 2} ${y! + 4}`} stroke="#C98F45" strokeWidth="1.2" />
        <Dots pts={scatter(`sam${i}`, 4, x!, y! - 2, 6, 5)} r={0.8} fill="#B9782A" />
      </g>
    ))}
    <ellipse cx="70" cy="62" rx="6" ry="2.6" fill="#7CB55A" />
  </Plate>
);
function fritters(id: string, fill: string, edge: string, bits: [string, number][], n = 6, size = 6): Draw {
  return () => (
    <Plate>
      {scatter(id, n, 48, 50, 16, 6).map(([x, y], i) => (
        <path key={i} d={`M${x - size} ${y}c-1-${size * 0.6} ${size * 0.6}-${size} ${size}-${size * 0.8}s${size * 1.1} ${size * 0.4} ${size * 0.9} ${size * 0.9}-${size * 0.8} ${size * 0.8}-${size * 1.1} ${size * 0.6}-${size * 0.9}-${size * 0.2}-${size * 0.8}-${size * 0.7}Z`} fill={fill} stroke={edge} strokeWidth="1" />
      ))}
      {bits.map(([c, k], i) => <Dots key={i} pts={scatter(`${id}b${i}`, k, 48, 50, 16, 6)} r={1.1} fill={c} />)}
    </Plate>
  );
}
A['vegetable-pakora'] = fritters('vegetable-pakora', '#D9902E', '#A8661A', [['#4E8F2E', 6], ['#F0A33A', 3]]);
A['onion-pakora'] = fritters('onion-pakora', '#D49332', '#A0661C', [['#E9D3E8', 6], ['#4E8F2E', 3]], 6, 6.4);
A['paneer-pakora'] = () => (
  <Plate>
    {([[36, 52], [52, 50], [44, 43], [60, 44]] as [number, number][]).map(([x, y], i) => (
      <g key={i}><rect x={x - 7} y={y - 5} width="14" height="10" rx="4" fill="#E0A040" stroke="#AE701E" strokeWidth="1" /><rect x={x - 3} y={y - 1} width="6" height="4" rx="1" fill="#FFF3D6" /></g>
    ))}
    <ellipse cx="68" cy="60" rx="6" ry="2.6" fill="#7CB55A" />
  </Plate>
);
A['bread-pakora'] = () => (
  <Plate>
    {[[38, 50], [58, 50]].map(([x, y], i) => (
      <g key={i}><path d={`M${x! - 12} ${y! + 5}L${x! - 2} ${y! - 10}L${x! + 12} ${y! + 5}Z`} fill="#DE9A36" stroke="#A8661A" strokeWidth="1.3" strokeLinejoin="round" /><path d={`M${x! - 6} ${y! + 2}h12`} stroke="#F2D27A" strokeWidth="2.4" /></g>
    ))}
    <Dots pts={scatter('brp', 6, 48, 48, 16, 6)} r={0.8} fill="#8E5A14" />
  </Plate>
);
A['aloo-tikki'] = () => (
  <Plate>
    {[[37, 51], [59, 51]].map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y! + 2} rx="11" ry="6" fill="#B9782A" /><ellipse cx={x} cy={y} rx="11" ry="6" fill="#D9A04A" /><Dots pts={scatter(`tik${i}`, 4, x!, y!, 7, 3)} r={0.9} fill="#8E5A14" /></g>)}
    <path d="M34 46c4 2 8 2 12 0M56 46c4 2 8 2 12 0" stroke="#FFFFFF" strokeWidth="2.4" strokeLinecap="round" />
    <path d="M38 48c3 1 6 1 9 0" stroke="#7CB55A" strokeWidth="2" strokeLinecap="round" />
  </Plate>
);
function chaat(id: string, base: { fill: string; n: number; r: number; shape?: 'disc' | 'ball' }, o: { curd?: boolean; sev?: boolean; extra?: [string, number, number][] }): Draw {
  return () => (
    <Plate>
      {scatter(`${id}base`, base.n, 48, 50, 18, 7).map(([x, y], i) => base.shape === 'disc'
        ? <ellipse key={i} cx={x} cy={y} rx={base.r * 1.6} ry={base.r} fill={base.fill} stroke="#B9782A" strokeWidth="0.8" />
        : <circle key={i} cx={x} cy={y} r={base.r} fill={base.fill} />)}
      {o.curd ? <path d="M30 48c6-3 10 3 16 0s10-3 16 1" stroke="#FFFFFF" strokeWidth="3.2" fill="none" strokeLinecap="round" /> : null}
      <path d="M34 52c6 2 12 2 18 0" stroke="#6E3A1A" strokeWidth="1.8" fill="none" strokeLinecap="round" opacity="0.8" />
      <path d="M44 55c6 1 10 0 14-2" stroke="#4E8F2E" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      {o.sev ? <Dots pts={scatter(`${id}sev`, 14, 48, 46, 15, 5)} r={0.9} fill="#F2B233" /> : null}
      {(o.extra ?? []).map(([c, n, r], i) => <Dots key={i} pts={scatter(`${id}e${i}`, n, 48, 48, 16, 6)} r={r} fill={c} />)}
      <Dots pts={scatter(`${id}pom`, 4, 48, 47, 15, 5)} r={1.3} fill="#C0392B" />
    </Plate>
  );
}
A['chana-chaat'] = chaat('chana-chaat', { fill: '#E5B56C', n: 14, r: 2.4 }, { extra: [['#E9D3E8', 4, 1.5], ['#E2553B', 3, 1.4]] });
A['aloo-chaat'] = chaat('aloo-chaat', { fill: '#E3A64A', n: 9, r: 3.4 }, { extra: [['#8E5A14', 6, 0.8]] });
A['papdi-chaat'] = chaat('papdi-chaat', { fill: '#EAC07A', n: 8, r: 4, shape: 'disc' }, { curd: true, sev: true });
A['dahi-bhalla'] = () => (
  <Bowl fill="#FBFBF7">
    {[[38, 45], [56, 46], [47, 42]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="7" ry="3.6" fill="#E3C27A" />)}
    <path d="M30 46c6-3 12 3 18 0s12-3 18 1" stroke="#FFFFFF" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    <path d="M38 44c5 2 10 1 14-1" stroke="#6E3A1A" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    <Dots pts={scatter('dbh', 6, 48, 44, 18, 4)} r={0.8} fill="#B4441B" />
    <Dots pts={scatter('dbhp', 3, 48, 44, 18, 4)} r={1.2} fill="#C0392B" />
  </Bowl>
);
A['golgappe'] = () => (
  <Plate>
    {([[34, 52], [48, 54], [62, 52], [41, 44], [55, 44]] as [number, number][]).map(([x, y], i) => (
      <g key={i}><circle cx={x} cy={y} r="7" fill="#E9B460" stroke="#B9782A" strokeWidth="1" /><ellipse cx={x} cy={y - 3} rx="3" ry="1.6" fill="#7A4A1E" /></g>
    ))}
    <rect x="66" y="34" width="10" height="16" rx="3" fill="#9CC65A" opacity="0.85" />
  </Plate>
);
A['bhel-puri'] = chaat('bhel-puri', { fill: '#F3E3B0', n: 22, r: 1.8 }, { sev: true, extra: [['#E9D3E8', 4, 1.4], ['#E2553B', 3, 1.3], ['#F0A33A', 4, 1.6]] });
A['sev-puri'] = chaat('sev-puri', { fill: '#E8BD72', n: 6, r: 4.6, shape: 'disc' }, { sev: true, extra: [['#F3CF6E', 5, 1.6]] });
A['roasted-chana'] = nutPile('roasted-chana', { fill: '#C9853E', edge: '#8E5A1E', shape: 'peanut', n: 18, size: 1.1 });
A['roasted-makhana'] = () => (
  <Bowl fill="#EADFCB" color="#E7D8BF" shade="#CDBBA0">
    {scatter('makhana', 11, 48, 44, 20, 5).map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="3.6" fill="#FBF8EE" stroke="#D9CCB0" strokeWidth="0.8" /><circle cx={x + 1} cy={y + 1} r="1" fill="#C9A88A" /></g>)}
  </Bowl>
);
A['popcorn'] = () => (
  <>
    <Shadow cy={80} rx={22} />
    <path d="M28 40h40l-6 38H34Z" fill="#FFFFFF" />
    {[32, 42, 52, 62].map((x) => <path key={x} d={`M${x} 40l${x < 48 ? 2 : -2} 38`} stroke="#E2553B" strokeWidth="3.4" />)}
    {scatter('popcorn', 12, 48, 36, 18, 6).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill={i % 3 ? '#FFF6D8' : '#F7E3A0'} stroke="#E9D08A" strokeWidth="0.6" />)}
  </>
);
A['mathri'] = () => (
  <Plate>
    {[[37, 52], [59, 52], [48, 44]].map(([x, y], i) => (
      <g key={i}>
        <ellipse cx={x} cy={y! + 2} rx="11" ry="5.4" fill="#C9A262" />
        <ellipse cx={x} cy={y} rx="11" ry="5.4" fill="#F1DCAA" />
        <ellipse cx={x} cy={y} rx="7.5" ry="3.4" fill="none" stroke="#DCBF84" strokeWidth="0.9" />
        <Dots pts={[[x! - 4, y! - 1.4], [x! - 1.4, y! - 1.4], [x! + 1.4, y! - 1.4], [x! + 4, y! - 1.4], [x! - 2.8, y! + 1.4], [x!, y! + 1.4], [x! + 2.8, y! + 1.4]]} r={0.45} fill="#B9925A" />
      </g>
    ))}
  </Plate>
);
A['namkeen-mixture'] = () => (
  <Bowl fill="#EAC57A">
    <Dots pts={scatter('namk', 18, 48, 45, 22, 5)} r={1} fill="#F2B233" />
    <Dots pts={scatter('namk2', 6, 48, 45, 22, 5)} r={1.8} fill="#B9782A" />
    <Dots pts={scatter('namk3', 4, 48, 45, 22, 5)} r={1.3} fill="#4E8F2E" />
    <Dots pts={scatter('namk4', 5, 48, 45, 22, 5)} r={1.4} fill="#C0392B" />
  </Bowl>
);
A['rusk'] = () => (
  <Plate>
    {[[36, 50], [50, 48], [62, 52]].map(([x, y], i) => <g key={i} transform={`rotate(${-12 + i * 10} ${x} ${y})`}><rect x={x! - 10} y={y! - 4} width="20" height="9" rx="2.5" fill="#C98F45" /><rect x={x! - 8.6} y={y! - 2.8} width="17.2" height="6.4" rx="2" fill="#E9BE78" /></g>)}
    <Dots pts={scatter('rusk', 8, 48, 50, 16, 4)} r={0.6} fill="#9C6326" />
  </Plate>
);
A['biscuits'] = () => (
  <Plate>
    {[[36, 52], [50, 48], [62, 53]].map(([x, y], i) => (
      <g key={i} transform={`rotate(${-10 + i * 12} ${x} ${y})`}>
        <rect x={x! - 9} y={y! - 6} width="18" height="12" rx="2.4" fill="#C98F45" />
        <rect x={x! - 8} y={y! - 7} width="16" height="11" rx="2" fill="#E9B866" />
        <Dots pts={[[x! - 4, y! - 3.5], [x!, y! - 3.5], [x! + 4, y! - 3.5], [x! - 2, y!], [x! + 2, y!]]} r={0.7} fill="#B07533" />
      </g>
    ))}
  </Plate>
);
A['dhokla'] = sweetPieces('dhokla', { shape: 'square', fill: '#F6D85A', edge: '#E2BC2C', n: 3, topping: ['#1F1F1F', 8] });
A['hara-bhara-kebab'] = () => (
  <Plate>
    {[[36, 52], [56, 52], [46, 44]].map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y! + 2} rx="10" ry="5.4" fill="#3E7A2A" /><ellipse cx={x} cy={y} rx="10" ry="5.4" fill="#6EA845" /><Dots pts={scatter(`hbk${i}`, 3, x!, y!, 6, 3)} r={0.9} fill="#F0A33A" /></g>)}
    <circle cx="36" cy="51" r="1.5" fill="#A06A2A" />
  </Plate>
);

// ---------------------------------------------------------------------------------------------
// Mithai and desserts
// ---------------------------------------------------------------------------------------------
A['kheer'] = curry('kheer', { surface: '#F8F0DC', rim: '#F1E5C8', bits: [['#C8915A', 4, 1.4], ['#9DB35A', 3, 1.2], ['#E9DFC5', 10, 1]], leaves: 0 });
A['seviyan'] = () => (
  <Bowl fill="#F6ECD3">
    {scatter('sev', 9, 48, 45, 20, 4.5).map(([x, y], i) => <path key={i} d={`M${x - 5} ${y}c2-2 4 2 6 0s3-2 4 0`} stroke="#D9B06A" strokeWidth="1.2" fill="none" />)}
    <Dots pts={scatter('sevn', 4, 48, 44, 18, 4)} r={1.3} fill="#9DB35A" />
  </Bowl>
);
A['suji-halwa'] = () => <Plate><Mound fill="#F0C66A" rx={20} h={15} cy={55} edge="#D9A440" /><Dots pts={scatter('suji', 14, 48, 48, 15, 5)} r={0.8} fill="#D9A440" /><Dots pts={scatter('sujin', 4, 48, 46, 12, 4)} r={1.4} fill="#C8915A" /></Plate>;
A['atta-halwa'] = () => <Plate><Mound fill="#B9732E" rx={20} h={15} cy={55} edge="#8E5420" /><ellipse cx="44" cy="44" rx="7" ry="2.4" fill={C.ghee} opacity="0.85" /><Dots pts={scatter('atta', 10, 48, 48, 15, 5)} r={0.8} fill="#8E5420" /></Plate>;
A['gajar-halwa'] = () => <Plate><Mound fill="#E8732A" rx={20} h={15} cy={55} edge="#C45A1E" /><Dots pts={scatter('gajar', 16, 48, 48, 15, 5)} r={0.9} fill="#C45A1E" /><Dots pts={scatter('gajarn', 4, 48, 45, 12, 4)} r={1.4} fill="#9DB35A" /></Plate>;
A['moong-dal-halwa'] = () => <Plate><Mound fill="#D9A048" rx={20} h={15} cy={55} edge="#B47A2A" /><Dots pts={scatter('mdh', 14, 48, 48, 15, 5)} r={1} fill="#B47A2A" /><Dots pts={scatter('mdhn', 3, 48, 45, 12, 4)} r={1.4} fill="#E9DFC5" /></Plate>;
A['panjiri'] = () => <Bowl fill="#D9B276"><Dots pts={scatter('panj', 20, 48, 45, 22, 5)} r={1} fill="#B98A4A" /><Dots pts={scatter('panjn', 6, 48, 45, 22, 5)} r={1.6} fill="#F3E3C0" /><Dots pts={scatter('panjm', 4, 48, 45, 22, 5)} r={1.4} fill="#9DB35A" /></Bowl>;
A['pinni'] = sweetPieces('pinni', { shape: 'ball', fill: '#9C6332', edge: '#7A4A22', tex: '#C08A54' });
A['besan-ladoo'] = sweetPieces('besan-ladoo', { shape: 'ball', fill: '#E9AE4A', edge: '#C98C2A', topping: ['#9DB35A', 3] });
A['motichoor-ladoo'] = sweetPieces('motichoor-ladoo', { shape: 'ball', fill: '#F59B23', edge: '#D97F10', tex: '#FFC15A' });
A['milk-burfi'] = sweetPieces('milk-burfi', { shape: 'square', fill: '#FAF3E0', edge: '#E3D6B4', silver: true, topping: ['#9DB35A', 4] });
A['besan-burfi'] = sweetPieces('besan-burfi', { shape: 'square', fill: '#E7B65A', edge: '#C9923A', topping: ['#9DB35A', 4] });
A['kaju-katli'] = sweetPieces('kaju-katli', { shape: 'diamond', fill: '#F3E6CC', edge: '#D9C69E', silver: true, n: 3 });
A['gulab-jamun'] = sweetPieces('gulab-jamun', { shape: 'ball', fill: '#7A3416', edge: '#5A2410', syrup: '#E9B86A', bowl: true });
A['rasmalai'] = sweetPieces('rasmalai', { shape: 'disc', fill: '#FAF3DE', edge: '#E6D8B4', syrup: '#F6E3A6', bowl: true, topping: ['#9DB35A', 4] });
A['rasgulla'] = sweetPieces('rasgulla', { shape: 'ball', fill: '#FBFAF4', edge: '#E6E2D2', syrup: '#F3EED8', bowl: true });
A['jalebi'] = () => (
  <Plate>
    {[[38, 50], [58, 50], [48, 42]].map(([x, y], i) => (
      <path key={i} d={`M${x} ${y}m-2 0a2 2 0 1 1 4 0a4 4 0 1 1-8 0a6 6 0 1 1 12 0a8 4.6 0 1 1-16 0`} fill="none" stroke="#F28C1E" strokeWidth="2.8" strokeLinecap="round" />
    ))}
  </Plate>
);
A['kulfi'] = () => (
  <>
    <Shadow cy={80} rx={20} />
    <path d="M47 66v18" stroke="#C9A06A" strokeWidth="3.2" strokeLinecap="round" />
    <path d="M36 30c0-6 5-10 12-10s12 4 12 10l-3 34c0 3-4 5-9 5s-9-2-9-5Z" fill="#F4E2B4" />
    <path d="M36 30c0-6 5-10 12-10s12 4 12 10" fill="#F8ECCC" />
    <Dots pts={scatter('kulfi', 6, 48, 42, 8, 14)} r={1.3} fill="#9DB35A" />
  </>
);
A['ice-cream'] = () => (
  <Bowl fill="#E9DCC6" color="#F4D5E4" shade="#E3B6CB">
    <circle cx="40" cy="38" r="9" fill="#FBF3DF" />
    <circle cx="56" cy="38" r="9" fill="#F5B7C8" />
    <circle cx="48" cy="30" r="8.4" fill="#8A5A3A" />
  </Bowl>
);
A['milk-cake'] = sweetPieces('milk-cake', { shape: 'block', fill: '#E8C27A', edge: '#B98A3A', n: 2, tex: '#C9963F' });
A['kalakand'] = sweetPieces('kalakand', { shape: 'square', fill: '#F7EED6', edge: '#E2D3AA', topping: ['#9DB35A', 5], tex: '#E8D8B0' });
A['peda'] = () => (
  <Plate>
    {[[37, 52], [59, 52], [48, 44]].map(([x, y], i) => (
      <g key={i}>
        <ellipse cx={x} cy={y! + 2.4} rx="9" ry="5" fill="#B98A4A" />
        <ellipse cx={x} cy={y} rx="9" ry="5" fill="#D9A866" />
        <ellipse cx={x} cy={y! - 0.4} rx="3.6" ry="1.8" fill="#B98A4A" />
        <circle cx={x} cy={y! - 0.6} r="1" fill="#9DB35A" />
      </g>
    ))}
  </Plate>
);
A['gur'] = () => (
  <Plate>
    <path d="M30 52c-2-8 6-14 18-14s20 4 18 12c-1 6-10 8-18 8s-16-2-18-6Z" fill="#A8641E" />
    <path d="M34 46c6-4 16-5 26-1" stroke="#C9822E" strokeWidth="3" fill="none" strokeLinecap="round" />
    <Dots pts={scatter('gur', 6, 48, 50, 12, 4)} r={0.9} fill="#7A4410" />
  </Plate>
);

// ---------------------------------------------------------------------------------------------
// Fruit
// ---------------------------------------------------------------------------------------------
A['banana'] = fruitOne(() => <><path d="M20 52c10 16 36 18 54 2-14 4-38 4-54-2Z" fill="#F4D03F" /><path d="M20 52c10 12 34 14 54 2" fill="none" stroke="#D4AC0D" strokeWidth="2" /><path d="M72 54l4-4" stroke="#6D4C2F" strokeWidth="2.6" strokeLinecap="round" /></>);
A['apple'] = fruitOne(() => <><circle cx="48" cy="52" r="20" fill="#E74C3C" /><path d="M48 32c0-5 2-8 5-9" stroke="#6D4C2F" strokeWidth="2.4" strokeLinecap="round" /><path d="M51 28c5-4 10-3 11 0-5 1-8 1-11 0Z" fill="#2F9E44" /><ellipse cx="41" cy="44" rx="4" ry="2.6" fill="#F5B7B1" /></>);
A['orange'] = fruitOne(() => <><circle cx="48" cy="52" r="20" fill="#F39C12" /><Dots pts={scatter('orange', 14, 48, 52, 15, 15)} r={0.7} fill="#D9820A" /><circle cx="48" cy="33" r="2" fill="#6D8C2F" /><ellipse cx="41" cy="44" rx="4" ry="2.4" fill="#F8C471" /></>);
A['mandarin'] = fruitOne(() => <><ellipse cx="40" cy="56" rx="14" ry="12" fill="#F5A623" /><ellipse cx="60" cy="56" rx="12" ry="10" fill="#F7B54A" /><path d="M60 46v20M50 56h20M53 49l14 14M67 49L53 63" stroke="#FCE6B8" strokeWidth="1.2" /><path d="M40 44c2-4 6-5 9-4-3 2-6 3-9 4Z" fill="#2F9E44" /></>);
A['mango'] = fruitOne(() => <><path d="M30 60c-6-16 6-32 24-32 12 0 18 10 14 22-4 14-18 22-28 20-6-1-9-5-10-10Z" fill="#F6B533" /><path d="M54 30c6 2 10 6 12 12" stroke="#E2553B" strokeWidth="5" strokeLinecap="round" opacity="0.6" /><path d="M54 28c2-4 6-6 10-5" stroke="#4E8F2E" strokeWidth="2.6" strokeLinecap="round" /></>);
A['grapes'] = fruitOne(() => <>{([[40, 40], [50, 40], [60, 40], [45, 49], [55, 49], [50, 58], [40, 50], [60, 50]] as [number, number][]).map(([x, y], i) => <circle key={i} cx={x} cy={y} r="6" fill={i % 2 ? '#8E44AD' : '#9B59B6'} />)}<path d="M50 34v-8" stroke="#6D4C2F" strokeWidth="2.4" strokeLinecap="round" /><path d="M52 28c6-4 10-2 10 0-4 1-7 1-10 0Z" fill="#2F9E44" /></>);
A['guava'] = fruitOne(() => <><circle cx="40" cy="54" r="16" fill="#9CCB5A" /><circle cx="60" cy="56" r="13" fill="#F6C3B4" stroke="#9CCB5A" strokeWidth="3" /><Dots pts={scatter('guava', 9, 60, 56, 7, 7)} r={0.9} fill="#F3EAD0" /><path d="M40 38c2-3 5-4 7-3" stroke="#6D4C2F" strokeWidth="2" strokeLinecap="round" /></>);
A['papaya'] = fruitOne(() => <><path d="M18 52c0-14 14-22 30-22s30 8 30 22-14 18-30 18-30-4-30-18Z" fill="#7CAF3A" /><path d="M22 52c0-11 12-18 26-18s26 7 26 18-12 14-26 14-26-3-26-14Z" fill="#F7863A" /><ellipse cx="48" cy="52" rx="14" ry="6" fill="#E46A23" /><Dots pts={scatter('papaya', 14, 48, 52, 11, 4)} r={1.3} fill="#2A1A16" /></>);
A['pomegranate'] = fruitOne(() => <><circle cx="40" cy="54" r="16" fill="#C0392B" /><path d="M36 38l4-6 4 6" fill="#A93226" /><path d="M54 66c-6 0-10-6-8-12s10-10 16-8 10 8 6 14-8 6-14 6Z" fill="#F5E0D0" /><Dots pts={scatter('pom', 12, 60, 57, 7, 6)} r={1.7} fill="#D62C4A" /></>);
A['watermelon'] = fruitOne(() => <><path d="M14 46c4 22 64 22 68 0Z" fill="#2E8B57" /><path d="M18 46c4 18 56 18 60 0Z" fill="#F4F7E8" /><path d="M21 46c4 15 50 15 54 0Z" fill="#EF4F5E" /><Dots pts={[[34, 52], [44, 56], [54, 56], [62, 51], [48, 50]]} r={1.2} fill="#2A1A16" /></>);
A['cantaloupe'] = fruitOne(() => <><path d="M14 46c4 22 64 22 68 0Z" fill="#C9C08A" /><path d="M18 46c4 18 56 18 60 0Z" fill="#E9EFC4" /><path d="M21 46c4 15 50 15 54 0Z" fill="#F6A24A" /><path d="M40 47c4 3 12 3 16 0" stroke="#D9822B" strokeWidth="2" fill="none" /></>);
A['pear'] = fruitOne(() => <><path d="M48 30c-6 0-8 8-8 14-8 4-12 10-12 16 0 10 9 16 20 16s20-6 20-16c0-6-4-12-12-16 0-6-2-14-8-14Z" fill="#C5D85A" /><path d="M48 30v-6" stroke="#6D4C2F" strokeWidth="2.4" strokeLinecap="round" /><path d="M50 26c4-3 8-2 9 0-4 1-6 1-9 0Z" fill="#2F9E44" /><ellipse cx="40" cy="56" rx="3.4" ry="5" fill="#E2EBA0" /></>);
A['peach'] = fruitOne(() => <><circle cx="48" cy="52" r="19" fill="#F7A072" /><path d="M48 33c-6 6-6 30 0 38" stroke="#E8845A" strokeWidth="2" fill="none" /><path d="M50 32c5-4 10-3 11 0-5 1-8 1-11 0Z" fill="#2F9E44" /><ellipse cx="40" cy="45" rx="5" ry="3" fill="#FBC9A8" /></>);
A['kiwi'] = fruitOne(() => <><ellipse cx="36" cy="54" rx="14" ry="12" fill="#8D6E43" /><circle cx="60" cy="54" r="14" fill="#8D6E43" /><circle cx="60" cy="54" r="12.4" fill="#8BC34A" /><circle cx="60" cy="54" r="4" fill="#F1F8E0" /><Dots pts={Array.from({ length: 12 }, (_, i) => [60 + Math.cos(i / 1.91) * 7, 54 + Math.sin(i / 1.91) * 7] as [number, number])} r={0.8} fill="#2A1A16" /></>);
A['strawberries'] = () => (
  <Bowl fill="#F4F1EC">
    {([[38, 42], [50, 40], [60, 43], [44, 47], [56, 48]] as [number, number][]).map(([x, y], i) => <g key={i}><path d={`M${x - 5} ${y - 2}c0 6 3 9 5 10 2-1 5-4 5-10Z`} fill="#E53935" /><path d={`M${x - 4} ${y - 3}h8l-4-2Z`} fill="#2F9E44" /></g>)}
  </Bowl>
);
A['blueberries'] = () => <Bowl fill="#E9EEF6"><Dots pts={scatter('blue', 18, 48, 44, 22, 5)} r={2.6} fill="#3B5BA9" /><Dots pts={scatter('blue', 18, 48, 44, 22, 5).map(([x, y]) => [x - 0.8, y - 0.8] as [number, number])} r={0.7} fill="#7E98D8" /></Bowl>;
A['dates'] = () => (
  <Plate>
    {[[36, 50], [48, 46], [60, 50], [44, 54], [56, 56]].map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y} rx="7.4" ry="3.6" fill="#6E2E14" transform={`rotate(${i * 30} ${x} ${y})`} /><path d={`M${x! - 4} ${y}c2-1 6-1 8 0`} stroke="#9C4A24" strokeWidth="1" fill="none" transform={`rotate(${i * 30} ${x} ${y})`} /></g>)}
  </Plate>
);
A['raisins'] = nutPile('raisins', { fill: '#8E4A1E', edge: '#5A2A10', shape: 'peanut', n: 18, size: 0.9, mixed: ['#8E4A1E', '#B5651D', '#7A3A16'] });
A['mixed-fruit-bowl'] = () => (
  <Bowl fill="#F4F1EC">
    <Cubes pts={[[38, 43], [56, 44]]} fill="#F6B533" size={6} />
    <circle cx="46" cy="40" r="4" fill="#E74C3C" />
    <Dots pts={[[52, 47], [60, 41], [34, 46]]} r={2.4} fill="#3B5BA9" />
    <circle cx="44" cy="47" r="3.6" fill="#8BC34A" />
    <path d="M60 38c4 0 6 3 6 6" stroke="#F4D03F" strokeWidth="4" strokeLinecap="round" />
  </Bowl>
);

// ---------------------------------------------------------------------------------------------
// Nuts, seeds and spreads
// ---------------------------------------------------------------------------------------------
A['almonds'] = nutPile('almonds', { fill: '#B5733E', edge: '#8A4F24', shape: 'almond' });
A['walnuts'] = nutPile('walnuts', { fill: '#C8995E', edge: '#8A6232', shape: 'walnut', n: 8 });
A['cashews'] = nutPile('cashews', { fill: '#E3BE7E', edge: '#B98A45', shape: 'cashew', n: 9, size: 1.1 });
A['pistachios'] = nutPile('pistachios', { fill: '#9CBF5A', edge: '#B89F72', shape: 'pistachio', n: 9 });
A['peanuts'] = nutPile('peanuts', { fill: '#D9A066', edge: '#A8723A', shape: 'peanut', n: 18 });
A['mixed-nuts'] = nutPile('mixed-nuts', { fill: '#B5733E', edge: '#8A4F24', shape: 'almond', n: 12, mixed: ['#B5733E', '#F0D9A8', '#C8995E', '#9CBF5A'] });
A['chia-seeds'] = nutPile('chia-seeds', { fill: '#3A3A3A', edge: '#3A3A3A', shape: 'tiny', n: 60, mixed: ['#3A3A3A', '#8A8A8A', '#5A5148'] });
A['flax-seeds'] = nutPile('flax-seeds', { fill: '#8A5A2E', edge: '#5A3A1E', shape: 'seed', n: 28, size: 0.8 });
A['pumpkin-seeds'] = nutPile('pumpkin-seeds', { fill: '#5E8A3A', edge: '#3E6A2A', shape: 'seed', n: 16, size: 1.3 });
A['peanut-butter'] = () => <Jar fill="#C9863E" lid="#C0392B"><path d="M30 42c6-3 12 3 18 0s12-3 16 0" stroke="#A86A2A" strokeWidth="1.6" fill="none" /></Jar>;
A['almond-butter'] = () => <Jar fill="#B07A4A" lid="#6E8A3A"><ellipse cx="46" cy="36" rx="4" ry="2" fill="#8A4F24" /><path d="M30 46c6-3 12 3 18 0s12-3 16 0" stroke="#8E5E34" strokeWidth="1.6" fill="none" /></Jar>;

// ---------------------------------------------------------------------------------------------
// Salads, sides and added ingredients
// ---------------------------------------------------------------------------------------------
A['kachumber-salad'] = () => <Bowl fill="#E9F0D8"><Cubes pts={scatter('kach1', 6, 48, 45, 20, 4.5)} fill="#E2553B" size={4} /><Cubes pts={scatter('kach2', 6, 48, 45, 20, 4.5)} fill="#9CCB6A" size={4} /><Cubes pts={scatter('kach3', 5, 48, 45, 20, 4.5)} fill="#E9D3E8" size={3.6} /><Leaves pts={scatter('kachg', 4, 48, 43, 16, 3)} /></Bowl>;
A['cucumber-slices'] = () => <Plate>{([[34, 52], [46, 48], [58, 52], [40, 44], [54, 43]] as [number, number][]).map(([x, y], i) => <g key={i}><ellipse cx={x} cy={y} rx="7" ry="4" fill="#4E8F2E" /><ellipse cx={x} cy={y} rx="6" ry="3.3" fill="#DDEFC0" /><Dots pts={[[x - 1.6, y], [x + 1.6, y]]} r={0.6} fill="#A8C98A" /></g>)}</Plate>;
A['carrot-sticks'] = () => <Plate>{[0, 1, 2, 3, 4].map((i) => <rect key={i} x={26 + i * 2} y={46 + (i % 2) * 4} width="40" height="5" rx="2.5" fill={i % 2 ? '#F08A24' : '#F39C3A'} transform={`rotate(${-14 + i * 6} 48 50)`} />)}</Plate>;
A['mixed-green-salad'] = curry('mixed-green-salad', { surface: '#86C152', rim: '#6FAF3E', leafy: '#4E9A34', bits: [['#E74C3C', 3, 2.6], ['#F5F5DC', 3, 1.8], ['#6C3483', 3, 1.6]], leaves: 2 });
A['ghee-added-to-food'] = () => <Spoon fill="#F2C94C"><ellipse cx="36" cy="51" rx="5" ry="1.6" fill="#F9E4A0" /></Spoon>;
A['butter-added-to-food'] = () => <Plate><path d="M34 52l6-12h18l-4 12Z" fill="#F7E39A" /><path d="M34 52h20v4H34Z" fill="#EDD078" /><path d="M54 52l4-12v4l-4 12Z" fill="#E3C46A" /><path d="M60 40l14 6" stroke={C.steelDark} strokeWidth="3" strokeLinecap="round" /></Plate>;
A['cooking-oil-added'] = () => <Spoon fill="#F2D36B"><ellipse cx="36" cy="51" rx="6" ry="1.8" fill="#FBEFB8" /><path d="M40 34c-2 4-2 8 0 10 2-2 2-6 0-10Z" fill="#F2D36B" /></Spoon>;
A['sugar-added'] = () => <Spoon fill="#FFFFFF"><Dots pts={scatter('sugar', 14, 40, 52, 12, 5)} r={0.8} fill="#DADDE2" /></Spoon>;
A['honey'] = () => <Jar fill="#F2A81E" lid="#8A5A2E"><path d="M62 20c0 6 0 10 2 14" stroke="#F2A81E" strokeWidth="3" strokeLinecap="round" /></Jar>;
A['achar'] = () => <Jar fill="#C9682A" lid="#C0392B"><Chunks pts={scatter('achar', 6, 46, 58, 12, 10)} fill="#E9A23A" shade="#A8561E" size={3.4} /><Dots pts={scatter('acharm', 8, 46, 58, 12, 10)} r={0.8} fill="#3F2A1A" /></Jar>;
A['green-chutney'] = () => <Katori fill="#4E9A34"><Dots pts={scatter('grch', 10, 48, 45, 20, 4)} r={0.9} fill="#2F7A2B" /><Leaves pts={[[56, 43], [60, 44]]} fill="#7CC15A" /></Katori>;
A['tamarind-chutney'] = () => <Katori fill="#6E2E14"><path d="M36 45c4-2 8 2 12 0s8-2 10 0" stroke="#9C4A24" strokeWidth="1.8" fill="none" /><Dots pts={scatter('tamc', 6, 48, 45, 18, 4)} r={0.8} fill="#C9822E" /></Katori>;
A['ketchup'] = () => <Katori fill="#C62828"><ellipse cx="42" cy="44" rx="5" ry="1.4" fill="#E57373" /></Katori>;
A['mayonnaise'] = () => <Katori fill="#FAF3D8"><path d="M38 45c3-3 6 2 9-1s6-2 8 1" stroke="#EDE3B8" strokeWidth="2" fill="none" /></Katori>;
A['hummus'] = () => <Bowl fill="#E9CF9A"><path d="M34 45c6-6 22-6 28 0-6 4-22 4-28 0Z" fill="none" stroke="#D2B57A" strokeWidth="2" /><ellipse cx="48" cy="45" rx="6" ry="2" fill="#E9B43A" opacity="0.9" /><Dots pts={scatter('humm', 6, 48, 45, 16, 3)} r={0.9} fill="#C0392B" /><Dots pts={[[52, 44], [44, 46]]} r={1.8} fill="#E5B56C" /></Bowl>;
A['papad'] = () => <Plate><ellipse cx="48" cy="50" rx="26" ry="13" fill="#F3DFA6" stroke="#D9B86A" strokeWidth="1.3" /><Dots pts={scatter('papad', 26, 48, 50, 22, 10)} r={0.9} fill="#B98A3A" /><Dots pts={scatter('papad2', 6, 48, 50, 20, 9)} r={1.8} fill="#E9C97A" /></Plate>;
A['jam'] = () => <Jar fill="#B0213A" lid="#F2F2F2"><Dots pts={scatter('jam', 5, 46, 58, 12, 10)} r={1.6} fill="#D63A55" /></Jar>;
A['cream-added'] = () => <Spoon fill="#FFFDF4"><path d="M32 52c3-3 6 2 9-1s6-2 8 1" stroke="#F1E8CF" strokeWidth="1.8" fill="none" /></Spoon>;
A['salad-dressing'] = () => (
  <>
    <Shadow cx={48} cy={84} rx={16} ry={3.4} />
    <path d="M44 14h8v10l8 10v42a6 6 0 0 1-6 6H42a6 6 0 0 1-6-6V34l8-10Z" fill={C.glass} />
    <path d="M37 46h22v30a5 5 0 0 1-5 5H42a5 5 0 0 1-5-5Z" fill="#E9B43A" opacity="0.9" />
    <Dots pts={scatter('dress', 10, 48, 62, 8, 12)} r={0.9} fill="#2F7A2B" />
    <rect x="43" y="10" width="10" height="6" rx="2" fill="#6E8A3A" />
  </>
);

// ---------------------------------------------------------------------------------------------
// Canadian meals, takeout and gym staples
// ---------------------------------------------------------------------------------------------
function shaker(fill: string, top: string, cap = '#3B4A63'): Draw {
  return () => (
    <>
      <ellipse cx="48" cy="82" rx="18" ry="3.5" fill="#000" opacity="0.08" />
      <rect x="34" y="16" width="28" height="9" rx="3" fill={cap} />
      <rect x="44" y="11" width="8" height="6" rx="2" fill={cap} />
      <path d="M32 26h32l-3 50a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4Z" fill="#DCE7F5" />
      <path d="M33.5 42h29l-2 34a4 4 0 0 1-4 4H39.5a4 4 0 0 1-4-4Z" fill={fill} />
      <path d="M34 42h28" stroke={top} strokeWidth="2" />
      <path d="M38 30v8" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </>
  );
}
A['whey-shake-with-water'] = shaker('#D9C2A0', '#EADBC4');
A['whey-shake-with-milk'] = shaker('#EBDCC4', '#F8F0E2', '#2E6FD8');
A['plant-protein-shake'] = shaker('#B9B27A', '#D2CD98', '#4E8F2E');
A['protein-bar'] = () => (
  <Plate>
    <rect x="22" y="44" width="52" height="14" rx="4" fill="#7A4A2A" transform="rotate(-10 48 51)" />
    <rect x="24" y="44" width="48" height="5" rx="2.5" fill="#9C6A44" transform="rotate(-10 48 51)" />
    <Dots pts={scatter('bar', 8, 48, 50, 20, 4)} r={1} fill="#E9C99A" />
  </Plate>
);
A['whole-wheat-bread-sandwich'] = () => (
  <Plate>
    <path d="M24 56 48 30l24 26Z" fill="#B9813D" />
    <path d="M27 54 48 32l21 22Z" fill="#E6C98E" />
    <path d="M29 50h38" stroke="#6FAF3E" strokeWidth="3" />
    <path d="M32 46h32" stroke="#E74C3C" strokeWidth="2.6" />
    <path d="M35 42h26" stroke="#F4D35E" strokeWidth="2.2" />
    <Dots pts={scatter('wwb', 6, 48, 46, 10, 6)} r={0.6} fill="#9C6326" />
  </Plate>
);
A['grilled-chicken-sandwich'] = () => <Stack bun="#D9A05A" top="#C98A45" layers={[{ color: '#E9B27A', h: 6 }, { color: '#E74C3C', h: 3 }, { color: '#7CC15A', h: 4, wavy: true }]} />;
A['egg-breakfast-sandwich'] = () => <Stack bun="#E3B068" top="#D49C52" layers={[{ color: '#FFFFFF', h: 5 }, { color: '#F6C93A', h: 3 }, { color: '#F4B63A', h: 3 }]} />;
A['breakfast-wrap'] = () => <Wrap shell="#F1DDB0" filling="#F6D15C" seed="bwrap" accents={['#E2553B', '#4E8F2E']} />;
A['bagel-with-cream-cheese'] = () => (
  <Plate>
    <ellipse cx="48" cy="50" rx="22" ry="11" fill="#C9822E" />
    <ellipse cx="48" cy="48" rx="20" ry="9.6" fill="#FBF8EE" />
    <ellipse cx="48" cy="48" rx="6" ry="2.8" fill="#C9822E" />
    <Dots pts={scatter('bagel', 7, 48, 44, 18, 5)} r={0.8} fill="#2A1A16" />
  </Plate>
);
A['muffin'] = () => (
  <>
    <Shadow cy={80} rx={20} />
    <path d="M32 50h32l-4 26H36Z" fill="#E9D3E8" />
    {[36, 42, 48, 54, 60].map((x) => <path key={x} d={`M${x} 52v22`} stroke="#D1B3D0" strokeWidth="1.4" />)}
    <path d="M28 52c-2-14 8-24 20-24s22 10 20 24Z" fill="#C9863E" />
    <Dots pts={scatter('muffin', 7, 48, 42, 14, 7)} r={1.6} fill="#3B5BA9" />
  </>
);
A['donut'] = () => (
  <Plate>
    <ellipse cx="48" cy="50" rx="22" ry="12" fill="#D9A05A" />
    <path d="M28 48c2-8 12-11 20-11s18 3 20 11c-4 4-8 2-12 4-4-2-12-2-16 0-4-2-8 0-12-4Z" fill="#F5B7C8" />
    <ellipse cx="48" cy="48" rx="6.4" ry="3" fill="#E9E2DA" />
    {scatter('donut', 10, 48, 45, 16, 5).map(([x, y], i) => <rect key={i} x={x} y={y} width="3" height="1" rx="0.5" fill={['#3B5BA9', '#F4D03F', '#2F9E44', '#FFFFFF'][i % 4]} transform={`rotate(${i * 40} ${x} ${y})`} />)}
  </Plate>
);
A['pizza-slice'] = () => (
  <Plate>
    <path d="M22 40l50 4-26 22Z" fill="#F4C25A" />
    <path d="M22 40l50 4" stroke="#C9822E" strokeWidth="4.4" strokeLinecap="round" />
    <Dots pts={[[38, 46], [54, 47], [46, 54]]} r={3} fill="#C0392B" />
    <Dots pts={[[44, 46], [50, 52]]} r={1.4} fill="#2F7A2B" />
  </Plate>
);
A['pasta-with-tomato-sauce'] = () => (
  <Plate>
    <Mound fill="#F2D27A" rx={22} h={14} cy={56} />
    {scatter('pastat', 8, 48, 49, 16, 5).map(([x, y], i) => <path key={i} d={`M${x - 6} ${y}c3-3 6 3 9 0`} stroke="#E9C25A" strokeWidth="1.8" fill="none" />)}
    <ellipse cx="48" cy="46" rx="12" ry="4.6" fill="#D9452A" />
    <Leaves pts={[[46, 43], [51, 44]]} size={2.6} />
  </Plate>
);
A['creamy-pasta'] = () => (
  <Plate>
    <Mound fill="#F6E7BE" rx={22} h={14} cy={56} />
    {scatter('pastac', 9, 48, 49, 16, 5).map(([x, y], i) => <path key={i} d={`M${x - 6} ${y}c3-3 6 3 9 0`} stroke="#EED8A0" strokeWidth="1.8" fill="none" />)}
    <Dots pts={scatter('pastacp', 6, 48, 47, 14, 4)} r={0.8} fill="#2A1A16" />
    <Leaves pts={[[44, 44], [52, 45]]} size={2.2} />
  </Plate>
);
A['vegetable-burger'] = () => <Stack bun="#DCA35A" layers={[{ color: '#6E9A3A', h: 6 }, { color: '#E74C3C', h: 3 }, { color: '#9CCB5A', h: 4, wavy: true }]} sesame />;
A['chicken-burger'] = () => <Stack bun="#DCA35A" layers={[{ color: '#D9944A', h: 7 }, { color: '#FAF3D8', h: 2 }, { color: '#9CCB5A', h: 4, wavy: true }]} sesame />;
A['beef-burger'] = () => <Stack bun="#DCA35A" layers={[{ color: '#6E3A22', h: 7 }, { color: '#F4B63A', h: 3 }, { color: '#E74C3C', h: 3 }, { color: '#9CCB5A', h: 4, wavy: true }]} sesame />;
A['french-fries'] = () => (
  <>
    <Shadow cy={80} rx={20} />
    {[34, 39, 44, 49, 54, 59].map((x, i) => <rect key={x} x={x} y={22 + (i % 3) * 4} width="5" height="30" rx="1.6" fill={i % 2 ? '#F4C542' : '#F7D35E'} transform={`rotate(${-8 + i * 3} ${x} 50)`} />)}
    <path d="M30 44h36l-5 34H35Z" fill="#E2553B" />
    <path d="M34 50h28" stroke="#F08A70" strokeWidth="2" />
  </>
);
A['poutine'] = () => (
  <Bowl fill="#8E5A2E">
    {scatter('pout', 9, 48, 44, 20, 4).map(([x, y], i) => <rect key={i} x={x - 6} y={y - 1.4} width="12" height="3" rx="1.4" fill="#F4C542" transform={`rotate(${i * 40} ${x} ${y})`} />)}
    <Dots pts={scatter('poutc', 7, 48, 44, 18, 4)} r={2.4} fill="#FBF6E6" />
    <path d="M34 46c6-2 12 2 18 0s8-2 10 0" stroke="#6E3A1A" strokeWidth="2.6" fill="none" strokeLinecap="round" />
  </Bowl>
);
A['chicken-shawarma-wrap'] = () => <Wrap shell="#F3E0B8" filling="#D9944A" seed="shaw" accents={['#7CC15A', '#FFFFFF', '#E2553B']} />;
A['falafel-wrap'] = () => <Wrap shell="#F3E0B8" filling="#7A5A2E" seed="falafel" accents={['#7CC15A', '#E2553B', '#FFFFFF']} />;
A['burrito-bowl'] = () => (
  <Bowl fill="#F4F1EC">
    <path d="M24 46c4-4 10-5 14-4l-2 6Z" fill="#FAF6EA" />
    <Grains pts={scatter('burr', 10, 34, 44, 8, 3)} fill="#E8E2D2" len={2} />
    <Dots pts={scatter('burrb', 8, 50, 42, 6, 3)} r={1.8} fill="#3A2418" />
    <Dots pts={scatter('burrc', 7, 60, 45, 6, 3)} r={1.6} fill="#F4D03F" />
    <Cubes pts={scatter('burrt', 4, 46, 48, 10, 2)} fill="#E2553B" size={3} />
    <ellipse cx="62" cy="40" rx="5" ry="2.4" fill="#9CC65A" />
    <Leaves pts={[[42, 40], [56, 48]]} />
  </Bowl>
);
A['instant-noodles'] = () => (
  <Bowl fill="#F2C14E">
    {scatter('noodle', 10, 48, 44, 20, 4).map(([x, y], i) => <path key={i} d={`M${x - 7} ${y}c2-2 4 2 6 0s4-2 6 0`} stroke="#F7E08A" strokeWidth="1.6" fill="none" />)}
    <Dots pts={scatter('noodlev', 6, 48, 44, 18, 4)} r={1.4} fill="#5FAE3E" />
    <path d="M60 30l-16 16M66 32l-16 16" stroke="#B88A55" strokeWidth="2" strokeLinecap="round" />
  </Bowl>
);
A['vegetable-hakka-noodles'] = () => (
  <Plate>
    <Mound fill="#E9C27A" rx={22} h={14} cy={56} />
    {scatter('hakka', 10, 48, 49, 17, 5).map(([x, y], i) => <path key={i} d={`M${x - 7} ${y}c3-3 5 3 8 0s4-2 6 0`} stroke="#C9963F" strokeWidth="1.6" fill="none" />)}
    <Dots pts={scatter('hakkav', 5, 48, 47, 15, 5)} r={1.4} fill="#5FAE3E" />
    <Dots pts={scatter('hakkac', 4, 48, 47, 15, 5)} r={1.3} fill="#F08A24" />
    <Dots pts={scatter('hakkar', 3, 48, 47, 15, 5)} r={1.3} fill="#9B4F86" />
  </Plate>
);
A['chilli-chicken'] = () => (
  <Plate>
    <Chunks pts={scatter('chch', 8, 48, 49, 17, 7)} fill="#B8451E" shade="#6E2A12" size={5} />
    <Chunks pts={scatter('chchg', 4, 48, 49, 17, 7)} fill="#4E9A34" shade="#2F7A2B" size={3.2} />
    <Chunks pts={scatter('chcho', 3, 48, 49, 17, 7)} fill="#E9D3E8" size={3} />
    <Leaves pts={[[44, 42], [52, 43]]} size={2.2} />
  </Plate>
);
A['soup'] = () => <Bowl fill="#E9873A"><path d="M36 44c4-3 8 2 12 0s8-3 11 0" fill="none" stroke="#FBEAD0" strokeWidth="2" strokeLinecap="round" /><Leaves pts={[[46, 42], [52, 43]]} /><Steam xs={[40, 50, 60]} y={22} /></Bowl>;
A['frozen-prepared-paratha'] = () => (
  <>
    <Shadow cy={80} rx={30} />
    <rect x="16" y="34" width="64" height="40" rx="6" fill="#DCEAF6" />
    {[60, 54, 48].map((y) => <ellipse key={y} cx="48" cy={y} rx="24" ry="9" fill="#EFD6A0" stroke="#C9A262" strokeWidth="1.2" />)}
    <Dots pts={scatter('frz', 6, 48, 48, 18, 6)} r={1.3} fill="#C9963F" />
    <Dots pts={[[22, 38], [74, 40], [24, 70], [72, 70]]} r={1.4} fill="#FFFFFF" />
  </>
);
A['ready-to-eat-dal'] = () => (
  <>
    <Shadow cy={82} rx={24} />
    <path d="M28 20h40l-2 58H30Z" fill="#E7A83A" />
    <path d="M28 20h40v6H28Z" fill="#C98A24" />
    <ellipse cx="48" cy="56" rx="14" ry="10" fill="#F6E7C0" />
    <ellipse cx="48" cy="56" rx="11" ry="7" fill="#F2B233" />
    <Leaves pts={[[46, 55], [50, 56]]} size={2} />
  </>
);
A['frozen-mixed-vegetables'] = () => (
  <Bowl fill="#E7F0F8" color="#DCEAF6" shade="#B9CFE2">
    <Dots pts={scatter('fmv1', 9, 48, 44, 22, 5)} r={2.1} fill="#5FAE3E" />
    <Cubes pts={scatter('fmv2', 7, 48, 44, 22, 5)} fill="#F08A24" size={3.6} />
    <Cubes pts={scatter('fmv3', 6, 48, 44, 22, 5)} fill="#F4D03F" size={2.8} />
    <Dots pts={scatter('fmv4', 6, 48, 42, 22, 5)} r={0.9} fill="#FFFFFF" />
  </Bowl>
);

/** Registry of catalogue artwork, keyed by catalogue id. */
export const CATALOGUE_ART: Readonly<Record<string, Draw>> = A;

export function hasCatalogueArt(id: string | null | undefined): boolean {
  return !!id && Object.prototype.hasOwnProperty.call(A, id);
}

export function CatalogueArt({ id, size = 96 }: { id: string; size?: number }) {
  const draw = A[id];
  if (!draw) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" aria-hidden="true" focusable="false" data-art={id}>
      {draw()}
    </svg>
  );
}
