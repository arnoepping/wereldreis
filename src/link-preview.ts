const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

function meta(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, "i");
  return html.match(re)?.[1] ?? null;
}

export function linkPreviewClient(fetchFn: typeof fetch = fetch) {
  return async (url: string): Promise<string | null> => {
    try {
      const res = await fetchFn(url, {
        signal: AbortSignal.timeout(3000),
        headers: { "user-agent": "Mozilla/5.0 (compatible; WereldreisBot/1.0)" },
      });
      if (!res.ok) return null;
      const html = (await res.text()).slice(0, 200_000);
      const title = meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? null;
      const description = meta(html, "og:description") ?? meta(html, "description");
      const parts = [title, description].filter((p): p is string => !!p).map(decode);
      return parts.length ? parts.join(" — ") : null;
    } catch {
      return null;
    }
  };
}
