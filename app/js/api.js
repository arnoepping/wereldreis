async function req(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("You're signed out. Reload the page to sign in again.");
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try { message = (await res.json()).error ?? message; } catch {}
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

export const api = {
  me: () => req("GET", "/api/me"),
  ideas: () => req("GET", "/api/ideas"),
  createIdea: (body) => req("POST", "/api/ideas", body),
  enrichIdea: (text) => req("POST", "/api/ideas?enrich=1", { text }),
  updateIdea: (id, body) => req("PATCH", `/api/ideas/${id}`, body),
  deleteIdea: (id) => req("DELETE", `/api/ideas/${id}`),
  rate: (id, stars) => req("PUT", `/api/ideas/${id}/rating`, { stars }),
  notes: (q) => req("GET", `/api/notes?${new URLSearchParams(q)}`),
  addNote: (body) => req("POST", "/api/notes", body),
  settings: () => req("GET", "/api/settings"),
  saveSettings: (body) => req("PATCH", "/api/settings", body),
  budget: () => req("GET", "/api/budget"),
  linkCode: () => req("POST", "/api/telegram-link-code"),
};
