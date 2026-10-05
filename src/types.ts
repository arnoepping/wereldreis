import type { MonthTemp, WeatherMark } from "./logic/weather";
import type { RatingView } from "./logic/ratings";

export type User = { id: string; name: string; email: string; telegram_id: number | null };
export type PriceSeason = "low" | "mid" | "high";
export type Kind = "place" | "activity";
export type SeasonBasis = "weather" | "wildlife";
export type Status = "ready" | "needs_details";

export type IdeaRow = {
  id: number;
  title: string;
  kind: Kind;
  description: string | null;
  lat: number | null;
  lng: number | null;
  country_iso: string | null;
  region: string | null;
  source_url: string | null;
  photo_key: string | null;
  added_by: string;
  must_do: number;
  cost_pp_day: number | null;
  season_basis: SeasonBasis;
  wildlife_months: string | null;
  price_season: string | null;
  climate: string | null;
  status: Status;
  created_at: string;
  updated_at: string;
};

export type NewIdea = {
  title: string;
  kind: Kind;
  added_by: string;
  description?: string | null;
  lat?: number | null;
  lng?: number | null;
  country_iso?: string | null;
  region?: string | null;
  source_url?: string | null;
  photo_key?: string | null;
  must_do?: boolean;
  cost_pp_day?: number | null;
  season_basis?: SeasonBasis;
  wildlife_months?: number[] | null;
  price_season?: PriceSeason[] | null;
  climate?: (MonthTemp | null)[] | null;
  status?: Status;
};

export type MonthCell = { weather: WeatherMark; price: PriceSeason | null; temp: MonthTemp | null };

export type IdeaDto = {
  id: number;
  title: string;
  kind: Kind;
  description: string | null;
  lat: number | null;
  lng: number | null;
  country_iso: string | null;
  region: string | null;
  source_url: string | null;
  photo_url: string | null;
  added_by: string;
  must_do: boolean;
  cost_pp_day: number | null;
  season_basis: SeasonBasis;
  wildlife_months: number[] | null;
  price_season: PriceSeason[] | null;
  months: MonthCell[];
  status: Status;
  ratings: RatingView;
  note_count: number;
  created_at: string;
};

export type Note = {
  id: number;
  idea_id: number | null;
  country_iso: string | null;
  author: string;
  body: string;
  created_at: string;
};
export type Settings = { departure_date: string | null; budget_eur: number; flight_reserve_eur: number };
