import type { Env } from "./env";
import type { EnrichResult } from "./enrich";
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
  const notYet = () => Promise.reject(new Error("not implemented yet"));
  return {
    telegram: telegramApi(env.TELEGRAM_BOT_TOKEN),
    enrich: notYet,
    climate: notYet,
    linkPreview: () => Promise.resolve(null),
    now: () => new Date(),
  };
}
