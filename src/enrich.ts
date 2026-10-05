import type { PriceSeason, Kind, SeasonBasis } from "./types";

export type EnrichedIdea = {
  title: string;
  kind: Kind;
  description: string;
  place_name: string;
  country_iso: string;
  lat: number;
  lng: number;
  cost_pp_day: number;
  season_basis: SeasonBasis;
  wildlife_months: number[] | null;
  price_season: PriceSeason[];
};

export type EnrichResult = { kind: "ideas"; ideas: EnrichedIdea[] } | { kind: "question"; question: string };
