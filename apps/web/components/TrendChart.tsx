/**
 * Single-series trend line with the SDC band drawn on every chart (§9: no
 * value shown without the measurement error that bounds its meaning).
 * Single series → the title names it, no legend; thin 2px line; recessive
 * grid; text in ink tokens, never the series color; native per-point
 * tooltips.
 */
import { sdc } from '@peakspan/engine';

export interface TrendPoint {
  date: string;
  value: number;
}

const SERIES = '#2563eb'; // validated against the light surface (dataviz six checks)
const BAND = 'rgba(100, 116, 139, 0.14)';
const GRID = '#e5e7eb';
const INK_MUTED = '#6b7280';
const INK = '#374151';
const REF = '#b45309';

export function TrendChart({
  title,
  unit,
  points,
  typicalError,
  refLine,
  caption,
}: {
  title: string;
  unit: string;
  points: TrendPoint[];
  typicalError: number;
  /** Horizontal threshold line (e.g. an engine flag boundary) drawn in the warn tone. */
  refLine?: { value: number; label: string };
  /** Overrides the default SDC caption — for series whose meaning is a flag line, not a noise band. */
  caption?: string;
}) {
  const W = 640;
  const H = 220;
  const M = { top: 24, right: 96, bottom: 28, left: 48 };
  const iw = W - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const band = sdc(typicalError);
  const values = points.map((p) => p.value);
  const latest = points[points.length - 1];
  const lo = Math.min(...values, (latest?.value ?? 0) - band, refLine?.value ?? Infinity);
  const hi = Math.max(...values, (latest?.value ?? 0) + band, refLine?.value ?? -Infinity);
  const pad = (hi - lo) * 0.15 || 1;
  const yMin = lo - pad;
  const yMax = hi + pad;

  const x = (i: number) => M.left + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => M.top + ih - ((v - yMin) / (yMax - yMin)) * ih;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const ticks = [yMin + pad, (yMin + yMax) / 2, yMax - pad].map((v) => Math.round(v * 10) / 10);

  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} trend with SDC band`} style={{ width: '100%', height: 'auto' }}>
        {/* recessive grid */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={M.left - 6} y={y(t) + 4} textAnchor="end" fontSize={11} fill={INK_MUTED}>
              {t}
            </text>
          </g>
        ))}
        {/* SDC band around the latest estimate: deltas inside it are "no change detected" (I3) */}
        {latest && band > 0 && (
          <rect
            x={M.left}
            width={iw}
            y={y(latest.value + band)}
            height={Math.max(2, y(latest.value - band) - y(latest.value + band))}
            fill={BAND}
          />
        )}
        {/* threshold reference line, e.g. the engine's flag boundary */}
        {refLine && (
          <g>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(refLine.value)}
              y2={y(refLine.value)}
              stroke={REF}
              strokeWidth={1.5}
              strokeDasharray="5 4"
            />
            <text x={W - M.right - 4} y={y(refLine.value) - 5} textAnchor="end" fontSize={11} fill={REF}>
              {refLine.label}
            </text>
          </g>
        )}
        <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={x(i)} cy={y(p.value)} r={i === points.length - 1 ? 4 : 3} fill={SERIES}>
            <title>{`${p.date}: ${p.value} ${unit}`}</title>
          </circle>
        ))}
        {/* direct label on the latest point only — selective, in ink */}
        {latest && (
          <text x={x(points.length - 1) + 8} y={y(latest.value) + 4} fontSize={12} fontWeight={600} fill={INK}>
            {latest.value} {unit}
          </text>
        )}
        {/* x extent labels */}
        {points.length > 1 && (
          <>
            <text x={M.left} y={H - 8} fontSize={11} fill={INK_MUTED}>
              {points[0]!.date}
            </text>
            <text x={W - M.right} y={H - 8} textAnchor="end" fontSize={11} fill={INK_MUTED}>
              {latest!.date}
            </text>
          </>
        )}
      </svg>
      <figcaption className="figure-caption">
        {caption ??
          `Shaded band = ± SDC (${band.toFixed(1)} ${unit}): deltas inside it are “no change detected” and never trigger a plan change.`}
      </figcaption>
    </figure>
  );
}
