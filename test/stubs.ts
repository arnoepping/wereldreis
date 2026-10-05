import type { Deps } from "../src/deps";
import type { EnrichedIdea } from "../src/enrich";
import type { InlineButton } from "../src/telegram/api";

export type SentMessage = { chatId: number; html: string; buttons?: InlineButton[][] };

export const KOMODO: EnrichedIdea = {
  title: "Diving with mantas",
  kind: "activity",
  description: "Liveaboard trip.",
  place_name: "Komodo, Indonesia",
  country_iso: "IDN",
  lat: -8.55,
  lng: 119.48,
  cost_pp_day: 45,
  season_basis: "weather",
  wildlife_months: null,
  price_season: ["high", "high", "mid", "mid", "low", "low", "high", "high", "mid", "mid", "mid", "high"],
};

export function stubDeps(overrides: Partial<Deps> = {}) {
  const sent: SentMessage[] = [];
  const edited: SentMessage[] = [];
  const answers: string[] = [];
  let nextId = 1;
  const deps: Deps = {
    telegram: {
      sendMessage: async (chatId, html, opts) => {
        sent.push({ chatId, html, buttons: opts?.buttons });
        return { message_id: nextId++ };
      },
      editMessageText: async (chatId, _messageId, html, opts) => {
        edited.push({ chatId, html, buttons: opts?.buttons });
      },
      deleteMessage: async () => {},
      answerCallbackQuery: async (_id, text) => {
        answers.push(text);
      },
      getFileBytes: async () => new TextEncoder().encode("jpeg").buffer as ArrayBuffer,
    },
    enrich: async () => ({ kind: "ideas", ideas: [KOMODO] }),
    climate: async () => Array.from({ length: 12 }, () => ({ min: 24, max: 31 })),
    linkPreview: async () => null,
    now: () => new Date("2030-01-01T00:00:00.000Z"),
    ...overrides,
  };
  return Object.assign(deps, { sent, edited, answers });
}
