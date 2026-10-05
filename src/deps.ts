import type { Env } from "./env";
import { enrichClient, type EnrichResult } from "./enrich";
import { climateClient } from "./climate";
import { linkPreviewClient } from "./link-preview";
import type { MonthTemp } from "./logic/weather";
import { telegramApi, type TelegramApi } from "./telegram/api";

export interface Deps {
  telegram: TelegramApi;
  enrich(input: string): Promise<EnrichResult>;
  climate(lat: number, lng: number): Promise<(MonthTemp | null)[] | null>;
  linkPreview(url: string): Promise<string | null>;
  now(): Date;
}

export function productionDeps(env: Env): Deps {
  return {
    telegram: telegramApi(env.TELEGRAM_BOT_TOKEN),
    enrich: enrichClient(env.ANTHROPIC_API_KEY),
    climate: climateClient(),
    linkPreview: linkPreviewClient(),
    now: () => new Date(),
  };
}
