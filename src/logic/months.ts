const NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function monthRanges(months: number[]): string {
  const set = new Set(months.filter((m) => m >= 1 && m <= 12));
  if (set.size === 0) return "";
  if (set.size === 12) return "all year";
  // Start at a month whose predecessor is not included, so ranges can wrap over December.
  let start = 1;
  while (!(set.has(start) && !set.has(start === 1 ? 12 : start - 1))) start = (start % 12) + 1;
  const runs: [number, number][] = [];
  let m = start;
  for (let step = 0; step < 12; step++, m = (m % 12) + 1) {
    if (!set.has(m)) continue;
    const prev = m === 1 ? 12 : m - 1;
    if (runs.length && runs[runs.length - 1][1] === prev && set.has(prev)) runs[runs.length - 1][1] = m;
    else runs.push([m, m]);
  }
  return runs.map(([a, b]) => (a === b ? NAMES[a - 1] : `${NAMES[a - 1]}–${NAMES[b - 1]}`)).join(", ");
}
