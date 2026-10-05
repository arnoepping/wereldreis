import { api } from "./api.js";
import { state, upsertIdea, removeIdea, countryName, nameOf } from "./state.js";
import { hooks } from "./panel.js";
import { renderMonths } from "./months.js";
import { esc, el, markSeen, toast } from "./util.js";
import { openEdit } from "./forms.js";

function starsRow(label, value, onPick) {
  const row = el(`<div class="stars"><span class="who-lbl">${esc(label)}</span></div>`);
  for (let n = 1; n <= 5; n++) {
    const b = el(`<button class="${value != null && n <= value ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}">★</button>`);
    b.addEventListener("click", () => onPick(n));
    row.append(b);
  }
  return row;
}

function otherStars(idea) {
  const name = esc(state.other.name);
  const r = idea.ratings;
  if (r.otherHidden) return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="hint">Rate it first to see ${name}'s rating</span></div>`);
  if (r.other == null) return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="hint">Not rated yet</span></div>`);
  return el(`<div class="stars"><span class="who-lbl">${name}</span><span class="static" aria-label="${r.other} stars">${"★".repeat(r.other)}</span></div>`);
}

async function renderNotes(box, query, label) {
  box.innerHTML = `<div class="kind">Notes</div><div class="notes"><div class="hint">Loading…</div></div>
    <form class="note-form"><textarea id="note-body" rows="2" placeholder="Leave a note or question for ${esc(state.other.name)}"></textarea><button class="btn primary" type="submit">Send</button></form>`;
  const list = box.querySelector(".notes");
  const draw = (notes) => {
    list.innerHTML = notes.length
      ? notes.map((n) => `<div class="note"><div class="meta">${esc(n.author_name)} · ${new Date(n.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</div>${esc(n.body)}</div>`).join("")
      : `<div class="hint">No notes yet.</div>`;
  };
  try {
    const notes = await api.notes(query);
    draw(notes);
    markSeen(query.idea ? `idea:${query.idea}` : `country:${query.country}`, notes.length);
  } catch (err) { list.textContent = err.message; }
  box.querySelector("form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const ta = box.querySelector("textarea");
    const body = ta.value.trim();
    if (!body) return;
    try {
      await api.addNote(query.idea ? { idea_id: Number(query.idea), body } : { country_iso: query.country, label, body });
      ta.value = "";
      const notes = await api.notes(query);
      draw(notes);
      markSeen(query.idea ? `idea:${query.idea}` : `country:${query.country}`, notes.length);
      toast(`Sent. ${state.other.name} gets a Telegram message.`);
    } catch (err) { toast(err.message); }
  });
}
export { renderNotes };

export function renderCard(container, idea) {
  const where = [idea.region, idea.region ? null : countryName(idea.country_iso)].filter(Boolean).join(", ");
  container.innerHTML = "";
  const card = el(`<div class="card">
    <button class="back">← All ideas in ${esc(countryName(idea.country_iso))}</button>
    <div>
      <div class="kind">${idea.kind === "activity" ? "Activity" : "Place"} ${idea.must_do ? '<span class="badge must">Must-do</span>' : ""} ${idea.status === "needs_details" ? '<span class="badge todo">Needs details</span>' : ""}</div>
      <h3>${esc(idea.title)}</h3>
      <div class="where">${esc(where)}</div>
    </div>
    ${idea.photo_url ? `<img class="photo" src="${esc(idea.photo_url)}" alt="">` : ""}
    ${idea.description ? `<p>${esc(idea.description)}</p>` : ""}
    ${idea.source_url ? `<a href="${esc(idea.source_url)}" target="_blank" rel="noopener">Original link ↗</a>` : ""}
    <dl class="facts">
      <div><dt>Added by</dt><dd class="who"><i class="dot ${esc(idea.added_by)}"></i>${esc(nameOf(idea.added_by))}</dd></div>
      <div><dt>Rough cost</dt><dd>${idea.cost_pp_day != null ? `€${idea.cost_pp_day} / day pp` : "Unknown"}</dd></div>
    </dl>
    <div class="months-slot"></div>
    <div class="ratings"><div class="kind">Ratings</div></div>
    <div class="notes-slot"></div>
    <div class="actions" style="padding:0">
      <button class="btn" data-a="must">${idea.must_do ? "Remove must-do" : "Mark as must-do"}</button>
      <button class="btn" data-a="edit">Edit</button>
      <button class="btn danger" data-a="delete">Delete</button>
    </div>
  </div>`);
  card.querySelector(".back").addEventListener("click", () => hooks.onNavigate({ ...state.view, ideaId: null }));
  card.querySelector(".months-slot").append(renderMonths(idea, state.settings?.departure_date));

  const ratings = card.querySelector(".ratings");
  ratings.append(starsRow("You", idea.ratings.mine, async (n) => {
    try { upsertIdea(await api.rate(idea.id, n)); } catch (err) { toast(err.message); }
  }));
  ratings.append(otherStars(idea));

  renderNotes(card.querySelector(".notes-slot"), { idea: idea.id }, idea.title);

  card.querySelector('[data-a="must"]').addEventListener("click", async () => {
    try { upsertIdea(await api.updateIdea(idea.id, { must_do: !idea.must_do })); } catch (err) { toast(err.message); }
  });
  card.querySelector('[data-a="edit"]').addEventListener("click", () => openEdit(idea));
  const del = card.querySelector('[data-a="delete"]');
  del.addEventListener("click", async () => {
    if (del.dataset.confirm !== "1") { del.dataset.confirm = "1"; del.textContent = "Tap again to delete"; return; }
    try {
      await api.deleteIdea(idea.id);
      removeIdea(idea.id);
      hooks.onNavigate({ ...state.view, ideaId: null });
      toast("Idea deleted.");
    } catch (err) { toast(err.message); }
  });
  container.append(card);
}
