export type MonthTemp = { min: number; max: number };
export type WeatherMark = "good" | "borderline" | "poor" | "unknown";

export function classifyMonth(t: MonthTemp | null | undefined): WeatherMark {
  if (!t || !Number.isFinite(t.min) || !Number.isFinite(t.max)) return "unknown";
  if (t.min >= 16 && t.max <= 30) return "good";
  if (t.min >= 14 && t.max <= 32) return "borderline";
  return "poor";
}

export function monthMarks(i: {
  season_basis: "weather" | "wildlife";
  climate: (MonthTemp | null)[] | null;
  wildlife_months: number[] | null;
}): WeatherMark[] {
  return Array.from({ length: 12 }, (_, m) => {
    if (i.season_basis === "wildlife") {
      if (!i.wildlife_months) return "unknown";
      return i.wildlife_months.includes(m + 1) ? "good" : "poor";
    }
    return classifyMonth(i.climate?.[m]);
  });
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export function monthlyAverages(
  times: string[],
  mins: (number | null)[],
  maxs: (number | null)[],
): (MonthTemp | null)[] {
  const acc = Array.from({ length: 12 }, () => ({ min: 0, max: 0, n: 0 }));
  times.forEach((t, i) => {
    const lo = mins[i];
    const hi = maxs[i];
    if (lo == null || hi == null) return;
    const m = Number(t.slice(5, 7)) - 1;
    acc[m].min += lo;
    acc[m].max += hi;
    acc[m].n += 1;
  });
  return acc.map((a) => (a.n ? { min: round1(a.min / a.n), max: round1(a.max / a.n) } : null));
}
