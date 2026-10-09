import { useId, useState } from 'react';
import type { DayPoint } from '@/domain/metrics/metrics';
import { formatShortDate } from '@/core/time/localDate';

const W = 340;
const H = 160;
const PAD = { l: 40, r: 10, t: 12, b: 24 };

function niceTicks(min: number, max: number, count = 4): number[] {
  if (min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function compact(v: number): string {
  return Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v);
}

interface ChartProps {
  title: string;
  points: DayPoint<number>[];
  unit: string;
  kind: 'line' | 'bar';
  /** Bars start at zero; lines zoom to the data range. */
  emptyText: string;
}

/**
 * Single-series SVG chart. Missing days are drawn as small hollow markers on the baseline
 * (never as zero values). Tap/hover reveals the value; a table alternative is always available.
 */
export function DayChart({ title, points, unit, kind, emptyText }: ChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();
  const known = points.filter((p) => p.value !== null) as { date: string; value: number }[];
  const missing = points.length - known.length;
  if (known.length === 0) return <p className="empty">{emptyText}</p>;

  const vals = known.map((p) => p.value);
  let lo = kind === 'bar' ? 0 : Math.min(...vals);
  let hi = Math.max(...vals);
  if (kind === 'line') {
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    lo -= pad;
    hi += pad;
  }
  if (hi === lo) hi = lo + 1;
  const ticks = niceTicks(lo, hi);
  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const band = iw / points.length;
  const x = (i: number) => PAD.l + band * i + band / 2;
  const y = (v: number) => PAD.t + ih - ((v - lo) / (hi - lo)) * ih;
  const barW = Math.max(2, Math.min(24, band - 2));

  // Line segments break across missing days so gaps are visible.
  const segments: string[] = [];
  let cur = '';
  points.forEach((p, i) => {
    if (p.value === null) {
      if (cur) segments.push(cur);
      cur = '';
    } else {
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
    }
  });
  if (cur) segments.push(cur);

  const a = active !== null ? points[active] : null;
  const last = known[known.length - 1]!;
  const labelEvery = Math.ceil(points.length / 4);

  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={descId}
        onMouseLeave={() => setActive(null)}
      >
        <title id={descId}>
          {`${title}: ${known.length} recorded days of ${points.length}, latest ${last.value} ${unit} on ${formatShortDate(last.date)}. ${missing} days missing.`}
        </title>
        <g className="grid">
          {ticks.map((t) => <line key={t} x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} />)}
        </g>
        <g className="axis">
          {ticks.map((t) => <text key={t} x={PAD.l - 6} y={y(t) + 4} textAnchor="end">{compact(t)}</text>)}
          {points.map((p, i) => (i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.date} x={x(i)} y={H - 6} textAnchor="middle">{formatShortDate(p.date)}</text>
          ) : null))}
        </g>
        {active !== null ? <line className="cursor" x1={x(active)} x2={x(active)} y1={PAD.t} y2={PAD.t + ih} /> : null}
        {kind === 'line'
          ? segments.map((d, i) => <path key={i} className="series-line" d={d} />)
          : points.map((p, i) => {
            if (p.value === null) return null;
            const top = y(p.value);
            const h = Math.max(1, PAD.t + ih - top);
            const r = Math.min(4, h, barW / 2);
            const left = x(i) - barW / 2;
            const bottom = PAD.t + ih;
            // 4px rounded data-end, square at the baseline.
            const d = `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + barW - r}Q${left + barW},${top} ${left + barW},${top + r}V${bottom}Z`;
            return <path key={p.date} className="bar" d={d} opacity={active === null || active === i ? 1 : 0.55} />;
          })}
        {kind === 'line'
          ? points.map((p, i) => (p.value === null ? null : <circle key={p.date} className="series-dot" cx={x(i)} cy={y(p.value)} r={active === i ? 5 : 3.5} />))
          : null}
        {points.map((p, i) => (p.value === null ? <circle key={`m${p.date}`} className="missing" cx={x(i)} cy={PAD.t + ih - 3} r={2.5} /> : null))}
        {points.map((p, i) => (
          <rect key={`h${p.date}`} className="hit" x={x(i) - band / 2} y={PAD.t} width={band} height={ih + PAD.b}
            onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
        ))}
      </svg>
      <figcaption className="chart-readout" aria-live="polite">
        {a ? `${formatShortDate(a.date)}: ${a.value === null ? 'missing (not recorded)' : `${a.value.toLocaleString('en-US')} ${unit}`}` : 'Tap the chart to read a day.'}
      </figcaption>
      <div className="legend-note">
        <span><svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg> missing day — not zero</span>
      </div>
      <details className="numbers">
        <summary>Show numbers</summary>
        <div className="table-scroll">
          <table className="data">
            <thead><tr><th scope="col">Date</th><th scope="col">{title} ({unit})</th></tr></thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.date}><td>{formatShortDate(p.date)}</td><td>{p.value === null ? '— missing' : p.value.toLocaleString('en-US')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
