import type { Env } from "../env";
import type { Deps } from "../deps";
import type { IdeaRow, PriceSeason } from "../types";
import type { InlineButton } from "./api";
import * as db from "../db";
import { addIdeasFromText, firstUrl } from "../ideas-service";
import { monthMarks, type MonthTemp } from "../logic/weather";
import { monthRanges } from "../logic/months";
import { viewRatings } from "../logic/ratings";
import { escapeHtml } from "../html";

export type TgUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number };
    chat: { id: number };
    text?: string;
    caption?: string;
    photo?: { file_id: string; width: number; height: number }[];
    location?: { latitude: number; longitude: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const UNDO_MS = 10 * 60_000;
const HELP =
  "Send me a place or activity (text, a link, a photo with a caption, or a location pin) and I'll add it to your globe.";

export function ideaSummary(row: IdeaRow): string {
  const climate = row.climate ? (JSON.parse(row.climate) as (MonthTemp | null)[]) : null;
  const wildlife = row.wildlife_months ? (JSON.parse(row.wildlife_months) as number[]) : null;
  const price = row.price_season ? (JSON.parse(row.price_season) as PriceSeason[]) : null;
  const marks = monthMarks({ season_basis: row.season_basis, climate, wildlife_months: wildlife });
  const good = monthRanges(marks.flatMap((m, i) => (m === "good" ? [i + 1] : [])));
  const cheap = monthRanges(price?.flatMap((p, i) => (p === "low" ? [i + 1] : [])) ?? []);
  const parts = [`Added: <b>${escapeHtml(row.title)}</b>${row.region ? ` — ${escapeHtml(row.region)}` : ""}`];
  if (good) parts.push(`${row.season_basis === "wildlife" ? "best sightings" : "good"} ${good}`);
  if (cheap) parts.push(`cheapest ${cheap}`);
  if (row.cost_pp_day != null) parts.push(`~€${row.cost_pp_day}/day`);
  return parts.join(" · ");
}

export function ideaButtons(id: number, appUrl: string): InlineButton[][] {
  return [
    [1, 2, 3, 4, 5].map((n) => ({ text: `⭐${n}`, callback_data: `r:${id}:${n}` })),
    [
      { text: "Open on globe", url: `${appUrl}/#idea-${id}` },
      { text: "Undo", callback_data: `u:${id}` },
    ],
  ];
}

export async function handleUpdate(update: TgUpdate, env: Env, deps: Deps): Promise<void> {
  if (update.callback_query) return handleCallback(update.callback_query, env, deps);
  const msg = update.message;
  if (!msg?.from) return;
  const chat = msg.chat.id;
  const nowIso = deps.now().toISOString();
  const text = (msg.text ?? msg.caption ?? "").trim();

  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1];
    if (!code) {
      if (await db.userByTelegram(env.DB, msg.from.id)) await deps.telegram.sendMessage(chat, HELP);
      return;
    }
    const user = await db.consumeLinkCode(env.DB, code, msg.from.id, nowIso);
    await deps.telegram.sendMessage(
      chat,
      user
        ? `Linked! Hi ${escapeHtml(user.name)}. ${HELP}`
        : "That code is invalid or expired. Get a new one in the app under “Link Telegram”.",
    );
    return;
  }

  const user = await db.userByTelegram(env.DB, msg.from.id);
  if (!user) return;
  if (text === "/help") {
    await deps.telegram.sendMessage(chat, HELP);
    return;
  }

  let input = text;
  if (msg.location) input = `${input}\nLocation pin: ${msg.location.latitude}, ${msg.location.longitude}`.trim();

  let photoKey: string | null = null;
  if (msg.photo?.length) {
    const largest = msg.photo[msg.photo.length - 1];
    const bytes = await deps.telegram.getFileBytes(largest.file_id);
    photoKey = `photos/${crypto.randomUUID()}.jpg`;
    await env.PHOTOS.put(photoKey, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  }
  if (!input) {
    await deps.telegram.sendMessage(chat, "Add a caption or some text that says which place or activity this is.");
    return;
  }

  const pending = await db.getPending(env.DB, msg.from.id);
  if (pending) {
    input = `${pending.original}\n\nYou asked: ${pending.question}\nAnswer: ${input}`;
    await db.clearPending(env.DB, msg.from.id);
  }

  const status = await deps.telegram.sendMessage(chat, "Looking it up…");
  const result = await addIdeasFromText(env.DB, deps, user.id, input, { photo_key: photoKey, source_url: firstUrl(text) });
  await deps.telegram.deleteMessage(chat, status.message_id).catch(() => {});

  if (result.kind === "question") {
    await db.setPending(env.DB, msg.from.id, input, result.question, nowIso);
    await deps.telegram.sendMessage(chat, escapeHtml(result.question));
  } else if (result.kind === "none") {
    await deps.telegram.sendMessage(chat, "I couldn't find a place or activity in that. Try something like “Diving in Komodo”.");
  } else if (result.kind === "failed") {
    await deps.telegram.sendMessage(chat, "Saved, but I couldn't look it up. Fill in the details in the app.", {
      buttons: [[{ text: "Open in app", url: `${env.APP_URL}/#idea-${result.id}` }]],
    });
  } else {
    for (const id of result.ids) {
      const row = await db.getIdeaRow(env.DB, id);
      if (row) await deps.telegram.sendMessage(chat, ideaSummary(row), { buttons: ideaButtons(id, env.APP_URL) });
    }
  }
}

async function handleCallback(cq: NonNullable<TgUpdate["callback_query"]>, env: Env, deps: Deps): Promise<void> {
  const user = await db.userByTelegram(env.DB, cq.from.id);
  if (!user || !cq.data) return;
  const [kind, idText, starsText] = cq.data.split(":");
  const id = Number(idText);
  const row = await db.getIdeaRow(env.DB, id);
  if (!row) {
    await deps.telegram.answerCallbackQuery(cq.id, "That idea no longer exists.");
    return;
  }
  const other = db.otherOf(await db.getUsers(env.DB), user.id);

  if (kind === "r") {
    const stars = Number(starsText);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return;
    await db.setRating(env.DB, id, user.id, stars);
    const view = viewRatings(await db.starsFor(env.DB, id), user.id, other.id);
    const theirs = view.other != null ? `${other.name}: ${view.other}★.` : `${other.name} hasn't rated it yet.`;
    await deps.telegram.answerCallbackQuery(cq.id, `You gave ${stars}★. ${theirs}`);
    return;
  }

  if (kind === "u") {
    if (row.added_by !== user.id) {
      await deps.telegram.answerCallbackQuery(cq.id, "Only the person who added it can undo.");
      return;
    }
    if (deps.now().getTime() - Date.parse(row.created_at) > UNDO_MS) {
      await deps.telegram.answerCallbackQuery(cq.id, "Too late to undo here. You can delete it in the app.");
      return;
    }
    await db.deleteIdea(env.DB, id);
    if (cq.message) {
      await deps.telegram.editMessageText(cq.message.chat.id, cq.message.message_id, `Removed: ${escapeHtml(row.title)}`);
    }
    await deps.telegram.answerCallbackQuery(cq.id, "Removed.");
  }
}
