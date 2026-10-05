export type BudgetInput = { country_iso: string | null; cost_pp_day: number | null; stars: Record<string, number> };
export type BudgetResult = {
  qualifying: number;
  dailyForTwo: number | null;
  months: number | null;
  budget: number;
  flightReserve: number;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function budgetCheck(
  ideas: BudgetInput[],
  userIds: [string, string],
  budget: number,
  flightReserve: number,
): BudgetResult {
  const loved = ideas.filter((i) => userIds.every((u) => (i.stars[u] ?? 0) >= 4));
  const byCountry = new Map<string, number[]>();
  for (const i of loved) {
    if (i.cost_pp_day == null || !i.country_iso) continue;
    const list = byCountry.get(i.country_iso) ?? [];
    list.push(i.cost_pp_day);
    byCountry.set(i.country_iso, list);
  }
  const base = { qualifying: loved.length, budget, flightReserve };
  if (byCountry.size === 0) return { ...base, dailyForTwo: null, months: null };
  const perCountry = [...byCountry.values()].map(median);
  const daily = (perCountry.reduce((a, b) => a + b, 0) / perCountry.length) * 2;
  if (daily <= 0) return { ...base, dailyForTwo: Math.round(daily), months: null };
  const months = Math.round((Math.max(0, budget - flightReserve) / (daily * 30.4)) * 10) / 10;
  return { ...base, dailyForTwo: Math.round(daily), months };
}
