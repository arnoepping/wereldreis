import type { Env } from "./env";
import { createApi } from "./api";
import { productionDeps } from "./deps";
import { handleUpdate, type TgUpdate } from "./telegram/webhook";

const api = createApi(productionDeps);

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/telegram" && request.method === "POST") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return new Response("Forbidden", { status: 401 });
      }
      const update = (await request.json()) as TgUpdate;
      ctx.waitUntil(handleUpdate(update, env, productionDeps(env)).catch((err) => console.error("telegram update failed", err)));
      return new Response("ok");
    }
    if (pathname.startsWith("/api/")) return api.fetch(request, env, ctx);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
