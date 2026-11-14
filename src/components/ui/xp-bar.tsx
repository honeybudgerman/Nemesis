export function XpBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div>
      <div className="xp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label ?? "Опыт"}>
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-xs text-muted font-display">
        <span>
          {value.toLocaleString("ru-RU")} / {max.toLocaleString("ru-RU")} XP
        </span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
