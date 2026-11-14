/**
 * Time-zone helpers. All timestamps are stored in UTC; daily/weekly/monthly
 * quest boundaries use the user's chosen IANA time zone (ТЗ §5).
 */

export interface LocalDate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function partsInZone(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Offset (ms) of `tz` relative to UTC at a given instant. */
function zoneOffsetMs(instant: Date, tz: string): number {
  const p = partsInZone(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

export function localDateOf(instant: Date, tz: string): LocalDate {
  const p = partsInZone(instant, tz);
  return { year: p.year, month: p.month, day: p.day };
}

/** UTC instant of local midnight at the start of `date` in `tz`. */
export function startOfLocalDay(date: LocalDate, tz: string): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day);
  // Two passes handle DST transitions around midnight.
  let ts = guess - zoneOffsetMs(new Date(guess), tz);
  ts = guess - zoneOffsetMs(new Date(ts), tz);
  return new Date(ts);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function formatLocalDate(date: LocalDate): string {
  const mm = String(date.month).padStart(2, "0");
  const dd = String(date.day).padStart(2, "0");
  return `${date.year}-${mm}-${dd}`;
}

export function parseLocalDate(value: string): LocalDate {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) throw new RangeError(`invalid date: ${value}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const wd = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export function startOfWeek(date: LocalDate): LocalDate {
  return addDays(date, 1 - isoWeekday(date));
}

export function startOfMonth(date: LocalDate): LocalDate {
  return { year: date.year, month: date.month, day: 1 };
}

export function startOfNextMonth(date: LocalDate): LocalDate {
  return date.month === 12
    ? { year: date.year + 1, month: 1, day: 1 }
    : { year: date.year, month: date.month + 1, day: 1 };
}

export interface QuestPeriods {
  today: string;
  dayStart: Date;
  dayEnd: Date;
  weekStart: string;
  weekStartAt: Date;
  weekEnd: Date;
  monthStart: string;
  monthEnd: Date;
}

/** Boundaries of the current day / ISO week / month in `tz`, as UTC instants. */
export function questPeriods(now: Date, tz: string): QuestPeriods {
  const today = localDateOf(now, tz);
  const week = startOfWeek(today);
  const month = startOfMonth(today);
  return {
    today: formatLocalDate(today),
    dayStart: startOfLocalDay(today, tz),
    dayEnd: startOfLocalDay(addDays(today, 1), tz),
    weekStart: formatLocalDate(week),
    weekStartAt: startOfLocalDay(week, tz),
    weekEnd: startOfLocalDay(addDays(week, 7), tz),
    monthStart: formatLocalDate(month),
    monthEnd: startOfLocalDay(startOfNextMonth(today), tz),
  };
}
