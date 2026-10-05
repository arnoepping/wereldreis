import { monthMarks, type MonthTemp } from "./logic/weather";
import { viewRatings } from "./logic/ratings";
import type { IdeaDto, IdeaRow, PriceSeason } from "./types";

const parse = <T>(s: string | null): T | null => (s ? (JSON.parse(s) as T) : null);

export function toDto(
  row: IdeaRow,
  stars: Record<string, number>,
  me: string,
  other: string,
  noteCount: number,
): IdeaDto {
  const climate = parse<(MonthTemp | null)[]>(row.climate);
  const price = parse<PriceSeason[]>(row.price_season);
  const wildlife = parse<number[]>(row.wildlife_months);
  const marks = monthMarks({ season_basis: row.season_basis, climate, wildlife_months: wildlife });
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    country_iso: row.country_iso,
    region: row.region,
    source_url: row.source_url,
    photo_url: row.photo_key ? `/api/photos/${encodeURIComponent(row.photo_key)}` : null,
    added_by: row.added_by,
    must_do: row.must_do === 1,
    cost_pp_day: row.cost_pp_day,
    season_basis: row.season_basis,
    wildlife_months: wildlife,
    price_season: price,
    months: marks.map((weather, m) => ({ weather, price: price?.[m] ?? null, temp: climate?.[m] ?? null })),
    status: row.status,
    ratings: viewRatings(stars, me, other),
    note_count: noteCount,
    created_at: row.created_at,
  };
}
