import { monthlyAverages, type MonthTemp } from "./logic/weather";

export function climateClient(fetchFn: typeof fetch = fetch, now: () => Date = () => new Date()) {
  return async (lat: number, lng: number): Promise<(MonthTemp | null)[] | null> => {
    const endYear = now().getUTCFullYear() - 1;
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lng),
      start_date: `${endYear - 9}-01-01`,
      end_date: `${endYear}-12-31`,
      daily: "temperature_2m_max,temperature_2m_min",
      timezone: "UTC",
    });
    try {
      const res = await fetchFn(`https://archive-api.open-meteo.com/v1/archive?${params}`);
      if (!res.ok) return null;
      const data = (await res.json()) as {
        daily?: { time: string[]; temperature_2m_min: (number | null)[]; temperature_2m_max: (number | null)[] };
      };
      if (!data.daily) return null;
      return monthlyAverages(data.daily.time, data.daily.temperature_2m_min, data.daily.temperature_2m_max);
    } catch {
      return null;
    }
  };
}
