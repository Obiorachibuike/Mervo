import { cn } from "@/lib/utils";

/** Pure-SVG charts: zero client JS, crisp at any size, accessible. */

export function LineChart({ data, height = 120, className, showArea = true }: { data: { label: string; value: number }[]; height?: number; className?: string; showArea?: boolean }) {
  if (!data.length) return <div className={cn("flex h-24 items-center justify-center text-xs muted", className)}>No data yet</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  const min = Math.min(...data.map((d) => d.value), 0);
  const range = max - min || 1;
  const w = 100;
  const points = data.map((d, i) => {
    const x = (i / Math.max(1, data.length - 1)) * w;
    const y = height - ((d.value - min) / range) * (height - 8) - 4;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }} role="img" aria-label="Trend chart">
      {showArea ? (
        <polygon points={`0,${height} ${points.join(" ")} ${w},${height}`} fill="url(#mervo-area)" opacity="0.5" />
      ) : null}
      <defs>
        <linearGradient id="mervo-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#20B26B" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#20B26B" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={points.join(" ")} fill="none" stroke="#20B26B" strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={points[points.length - 1]!.split(",")[0]} cy={points[points.length - 1]!.split(",")[1]} r="1.8" fill="#20B26B" />
    </svg>
  );
}

export function BarChart({ data, height = 140, currency = "" }: { data: { label: string; value: number }[]; height?: number; currency?: string }) {
  if (!data.length) return <div className="flex h-32 items-center justify-center text-xs muted">No data yet</div>;
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height }} role="img" aria-label="Bar chart">
      {data.map((d, i) => (
        <div key={`${d.label}-${i}`} className="group flex h-full flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[9px] font-medium opacity-0 transition-opacity group-hover:opacity-100">
            {currency}
            {Math.round(d.value).toLocaleString()}
          </span>
          <div className="w-full rounded-t bg-brand/80 transition-colors group-hover:bg-brand" style={{ height: `${Math.max(2, (d.value / max) * 100)}%` }} />
          <span className="max-w-full truncate text-[9px] muted">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Donut({ segments, size = 120, centerLabel, centerValue }: { segments: { label: string; value: number; color: string }[]; size?: number; centerLabel?: string; centerValue?: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Distribution chart">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-black/5 dark:text-white/10" />
        {segments.map((s) => {
          const length = (s.value / total) * circumference;
          const el = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={s.color}
              strokeWidth="10"
              strokeDasharray={`${length} ${circumference - length}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              strokeLinecap="butt"
            />
          );
          offset += length;
          return el;
        })}
        {centerValue ? (
          <>
            <text x="50" y="48" textAnchor="middle" className="fill-current text-[11px] font-semibold" style={{ fontSize: 11 }}>
              {centerValue}
            </text>
            <text x="50" y="60" textAnchor="middle" className="fill-current opacity-50" style={{ fontSize: 7 }}>
              {centerLabel}
            </text>
          </>
        ) : null}
      </svg>
      <ul className="space-y-1.5 text-xs">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
            <span className="muted">{s.label}</span>
            <span className="font-medium">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sparkline({ data, tone = "#20B26B" }: { data: number[]; tone?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * 60},${20 - ((v - min) / range) * 16 - 2}`).join(" ");
  return (
    <svg viewBox="0 0 60 20" className="h-5 w-16" aria-hidden>
      <polyline points={points} fill="none" stroke={tone} strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
