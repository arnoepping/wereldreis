export type InlineButton = { text: string; callback_data?: string; url?: string };

export interface TelegramApi {
  sendMessage(chatId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<{ message_id: number }>;
  editMessageText(chatId: number, messageId: number, html: string, opts?: { buttons?: InlineButton[][] }): Promise<void>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
  answerCallbackQuery(callbackQueryId: string, text: string): Promise<void>;
  getFileBytes(fileId: string): Promise<ArrayBuffer>;
}

export function telegramApi(token: string, fetchFn: typeof fetch = fetch): TelegramApi {
  const base = `https://api.telegram.org/bot${token}`;
  async function call<T>(method: string, body: unknown): Promise<T> {
    const res = await fetchFn(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; result: T; description?: string };
    if (!data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? res.status}`);
    return data.result;
  }
  const markup = (buttons?: InlineButton[][]) => (buttons ? { reply_markup: { inline_keyboard: buttons } } : {});
  return {
    sendMessage: (chat_id, text, opts) =>
      call("sendMessage", { chat_id, text, parse_mode: "HTML", disable_web_page_preview: true, ...markup(opts?.buttons) }),
    editMessageText: async (chat_id, message_id, text, opts) => {
      await call("editMessageText", { chat_id, message_id, text, parse_mode: "HTML", ...markup(opts?.buttons) });
    },
    deleteMessage: async (chat_id, message_id) => {
      await call("deleteMessage", { chat_id, message_id });
    },
    answerCallbackQuery: async (callback_query_id, text) => {
      await call("answerCallbackQuery", { callback_query_id, text, show_alert: false });
    },
    getFileBytes: async (file_id) => {
      const file = await call<{ file_path: string }>("getFile", { file_id });
      const res = await fetchFn(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
      return res.arrayBuffer();
    },
  };
}
