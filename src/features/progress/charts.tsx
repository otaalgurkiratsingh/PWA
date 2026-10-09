import { useId } from 'react';

export interface Point {
  /** Label shown in the readout and table, e.g. "8 Oct". */
  label: string;
  value: number | null;
}

const W = 360;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const compact = (v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v));

interface ChartProps {
  points: Point[];
  unit: string;
  kind: 'line' | 'bar';
  tone?: 'weight' | 'train';
  height?: number;
  active: number | null;
  onActive: (i: number | null) => void;
  title: string;
  /** Show only these x labels (indices); defaults to ~4 evenly spaced. */
  labelEvery?: number;
}

/**
 * One series, one axis. Missing values are gaps (line) or absent bars — never zero.
 * Tapping or hovering selects a point; the parent shows the readout.
 */
export function Chart({ points, unit, kind, tone = 'weight', height = 200, active, onActive, title, labelEvery }: ChartProps) {
  const titleId = useId();
  const H = height;
  const pad = { l: 36, r: 8, t: 10, b: 24 };
  const known = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (!known.length) return null;
  let lo = kind === 'bar' ? 0 : Math.min(...known);
  let hi = Math.max(...known);
  if (kind === 'line') {
    const span = Math.max(hi - lo, 1);
    lo -= span * 0.15;
    hi += span * 0.15;
  }
  if (hi === lo) hi = lo + 1;
  // Snap the range outward to clean ticks so every point sits inside the labelled grid.
  const rough = niceTicks(lo, hi);
  const step = rough.length > 1 ? rough[1]! - rough[0]! : 1;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const ticks = niceTicks(lo, hi);
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const band = iw / points.length;
  const x = (i: number) => pad.l + band * i + band / 2;
  const y = (v: number) => pad.t + ih - ((v - lo) / (hi - lo)) * ih;
  const every = labelEvery ?? Math.max(1, Math.ceil(points.length / 4));
  const barW = Math.max(3, Math.min(24, band - 2));

  // The line joins recorded observations; only recorded days get a dot. Nothing is filled in.
  let path = '';
  points.forEach((p, i) => {
    if (p.value !== null) path += `${path ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  const segments = path ? [path] : [];
  const last = [...points].reverse().find((p) => p.value !== null)!;

  return (
    <svg className={`chart ${tone === 'train' ? 'train' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={titleId} onMouseLeave={() => onActive(null)}>
      <title id={titleId}>{`${title}: ${known.length} recorded of ${points.length}; latest ${last.value} ${unit} (${last.label}).`}</title>
      <g className="grid">{ticks.map((t) => <line key={t} x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} />)}</g>
      <g className="axis">
        {ticks.map((t) => <text key={t} x={pad.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text>)}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (i === points.length - 1 || points.length - 1 - i >= every / 2)
          ? <text key={i} x={x(i)} y={H - 6} textAnchor="middle">{p.label}</text> : null)}
      </g>
      {active !== null ? <line className="cursor" x1={x(active)} x2={x(active)} y1={pad.t} y2={pad.t + ih} /> : null}
      {kind === 'line' ? segments.map((d, i) => <path key={i} className="line" d={d} />) : points.map((p, i) => {
        if (p.value === null) return null;
        const top = y(p.value);
        const bottom = pad.t + ih;
        const h = Math.max(1, bottom - top);
        const r = Math.min(4, h, barW / 2);
        const left = x(i) - barW / 2;
        return <path key={i} className="bar" opacity={active === null || active === i ? 1 : 0.5}
          d={`M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + barW - r}Q${left + barW},${top} ${left + barW},${top + r}V${bottom}Z`} />;
      })}
      {kind === 'line' ? points.map((p, i) => (p.value === null ? null : <circle key={i} className="dot" cx={x(i)} cy={y(p.value)} r={active === i ? 6 : 4} />)) : null}
      {points.map((_, i) => (
        <rect key={i} className="hit" x={x(i) - band / 2} y={0} width={band} height={H} onMouseEnter={() => onActive(i)} onClick={() => onActive(i)} />
      ))}
    </svg>
  );
}

export function DataTable({ points, unit, title }: { points: Point[]; unit: string; title: string }) {
  return (
    <div className="table-scroll">
      <table className="data">
        <thead><tr><th scope="col">Date</th><th scope="col">{title} ({unit})</th></tr></thead>
        <tbody>
          {points.map((p, i) => <tr key={i}><td>{p.label}</td><td>{p.value === null ? 'Not logged' : p.value.toLocaleString('en-US')}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
