import { state, countryName, nameOf } from "./state.js";
import { CONTINENTS } from "./geo.js";
import { esc, readSeen } from "./util.js";

export const hooks = { renderCard: null, onNavigate: null, onOpenIdea: null, onAction: null };

const ideasIn = (v) =>
  v.level === "world" ? state.ideas
  : v.level === "continent" ? state.ideas.filter((i) => state.countries.get(i.country_iso)?.cont === v.cont)
  : state.ideas.filter((i) => i.country_iso === v.iso);

function tally(list) {
  const a = list.filter((i) => i.added_by === state.me.id).length;
  return `<div class="tally"><span>${list.length} idea${list.length === 1 ? "" : "s"}</span>
    <span class="who"><i class="dot ${state.me.id}"></i>${esc(state.me.name)} ${a}</span>
    <span class="who"><i class="dot ${state.other.id}"></i>${esc(state.other.name)} ${list.length - a}</span></div>`;
}

function ideaRow(i) {
  const seen = readSeen()[`idea:${i.id}`] ?? 0;
  const unread = i.note_count > seen ? `<i class="unread" title="New notes"></i>` : "";
  const sub = [i.region ?? countryName(i.country_iso), i.kind === "activity" ? "Activity" : "Place"].filter(Boolean).join(" · ");
  return `<button class="row" data-idea="${i.id}"><i class="dot ${esc(i.added_by)}"></i>
    <span class="t">${i.must_do ? '<span class="must">★</span> ' : ""}${esc(i.title)}${unread}<span class="s">${esc(sub)}</span></span>
    <span class="n">${i.cost_pp_day != null ? `€${i.cost_pp_day}/d` : ""}</span></button>`;
}

export function renderCrumbs() {
  const v = state.view;
  const crumbs = [["World", { level: "world", cont: null, iso: null, ideaId: null }]];
  if (v.cont) crumbs.push([v.cont, { level: "continent", cont: v.cont, iso: null, ideaId: null }]);
  if (v.iso) crumbs.push([countryName(v.iso), { level: "country", cont: v.cont, iso: v.iso, ideaId: null }]);
  const nav = document.getElementById("crumbs");
  nav.innerHTML = "";
  crumbs.forEach(([label, target], idx) => {
    if (idx) nav.insertAdjacentHTML("beforeend", '<span class="sep">›</span>');
    const b = document.createElement("button");
    b.textContent = label;
    const last = idx === crumbs.length - 1 && v.ideaId == null;
    b.setAttribute("aria-current", String(last));
    if (!last) b.addEventListener("click", () => hooks.onNavigate(target));
    nav.append(b);
  });
}

export function renderPanel() {
  renderCrumbs();
  const head = document.getElementById("head");
  const body = document.getElementById("body");
  const v = state.view;

  if (v.ideaId != null) {
    const idea = state.ideas.find((i) => i.id === v.ideaId);
    if (idea && hooks.renderCard) {
      head.innerHTML = `<div class="eyebrow"><span>${esc(countryName(idea.country_iso))}</span></div>`;
      hooks.renderCard(body, idea);
      return;
    }
  }

  const list = ideasIn(v);
  const title = v.level === "world" ? "Your bucket list" : v.level === "continent" ? v.cont : countryName(v.iso);
  head.innerHTML = `<div class="eyebrow"><span>${v.level === "world" ? "World" : v.level}</span></div><h2>${esc(title)}</h2>${tally(list)}`;

  let html = `<div class="actions">
    <button class="btn primary" data-action="add">+ Add idea</button>
    ${v.level === "world" ? `<button class="btn" data-action="budget">Budget check</button><button class="btn" data-action="settings">Settings</button>${state.me.telegram_linked ? "" : '<button class="btn" data-action="link">Link Telegram</button>'}` : ""}
    ${v.level === "country" ? `<button class="btn" data-action="country-notes">Notes${state.countryNotes[v.iso] ? ` (${state.countryNotes[v.iso]})` : ""}</button>` : ""}
  </div>`;

  const todo = list.filter((i) => i.status === "needs_details");
  if (todo.length) html += `<div class="group">Needs details</div>` + todo.map(ideaRow).join("");

  if (v.level === "world") {
    html += `<div class="group">Continents</div>`;
    for (const c of Object.keys(CONTINENTS)) {
      const n = list.filter((i) => state.countries.get(i.country_iso)?.cont === c).length;
      html += `<button class="row" data-cont="${esc(c)}"><span class="dot" style="background:var(--land)"></span><span class="t">${esc(c)}<span class="s">${n ? "" : "No ideas yet"}</span></span><span class="n">${n || ""} ›</span></button>`;
    }
    const lost = list.filter((i) => i.status === "ready" && !state.countries.get(i.country_iso)?.cont);
    if (lost.length) html += `<div class="group">Elsewhere</div>` + lost.map(ideaRow).join("");
  } else if (v.level === "continent") {
    const isos = [...new Set(list.map((i) => i.country_iso))];
    if (!isos.length) html += `<div class="empty">No ideas in ${esc(v.cont)} yet. Send one to the Telegram bot, or tap “Add idea”.</div>`;
    else {
      html += `<div class="group">Countries</div>` + isos.map((iso) =>
        `<button class="row" data-iso="${esc(iso)}"><span class="dot" style="background:var(--land)"></span><span class="t">${esc(countryName(iso))}</span><span class="n">${list.filter((i) => i.country_iso === iso).length} ›</span></button>`).join("");
      html += `<div class="group">Ideas</div>` + list.filter((i) => i.status === "ready").map(ideaRow).join("");
    }
  } else {
    const ready = list.filter((i) => i.status === "ready");
    html += ready.length ? ready.map(ideaRow).join("") : `<div class="empty">No ideas in ${esc(title)} yet.</div>`;
  }

  body.innerHTML = html;
  body.querySelectorAll("[data-cont]").forEach((b) => b.addEventListener("click", () => hooks.onNavigate({ level: "continent", cont: b.dataset.cont, iso: null, ideaId: null })));
  body.querySelectorAll("[data-iso]").forEach((b) => b.addEventListener("click", () => {
    const iso = b.dataset.iso;
    hooks.onNavigate({ level: "country", cont: state.countries.get(iso)?.cont ?? state.view.cont, iso, ideaId: null });
  }));
  body.querySelectorAll("[data-idea]").forEach((b) => b.addEventListener("click", () => hooks.onOpenIdea(Number(b.dataset.idea))));
  body.querySelectorAll("[data-action]").forEach((b) => b.addEventListener("click", () => hooks.onAction?.(b.dataset.action)));
}

export { nameOf };
