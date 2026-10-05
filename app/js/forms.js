import { api } from "./api.js";
import { state, update, upsertIdea, countryName } from "./state.js";
import { esc, el, toast } from "./util.js";
import { renderNotes } from "./card.js";

const dialog = () => document.getElementById("dialog");

function show(html, onReady) {
  const d = dialog();
  d.innerHTML = "";
  const body = el(`<div class="dlg">${html}</div>`);
  d.append(body);
  body.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => d.close()));
  onReady(body);
  if (!d.open) d.showModal();
}

let openIdeaFn = () => {};
export const setOpenIdea = (fn) => (openIdeaFn = fn);

export function openAdd() {
  show(`<h2>Add an idea</h2>
    <label>Describe a place or activity. The details get filled in for you.
      <textarea id="add-text" rows="3" placeholder="e.g. Diving with mantas in Komodo"></textarea></label>
    <div class="error" id="add-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="add-go">Add</button></div>`, (body) => {
    const ta = body.querySelector("#add-text");
    const go = body.querySelector("#add-go");
    const error = body.querySelector("#add-error");
    let original = "";
    go.addEventListener("click", async () => {
      const text = ta.value.trim();
      if (!text) return;
      go.disabled = true; go.textContent = "Looking it up…"; error.hidden = true;
      try {
        const input = original ? `${original}\n\nAnswer: ${text}` : text;
        const res = await api.enrichIdea(input);
        if (res.kind === "question") {
          original = input;
          ta.value = "";
          ta.placeholder = "Your answer";
          error.textContent = res.question; error.hidden = false;
        } else if (res.kind === "none") {
          error.textContent = "No place or activity found in that. Try something like “Diving in Komodo”."; error.hidden = false;
        } else {
          const ideas = res.kind === "ideas" ? res.ideas : [res.idea];
          ideas.forEach(upsertIdea);
          dialog().close();
          toast(res.kind === "failed" ? "Saved, but it couldn't be looked up. Fill in the details." : `Added ${ideas.length} idea${ideas.length > 1 ? "s" : ""}.`);
          openIdeaFn(ideas[0].id);
        }
      } catch (err) {
        error.textContent = err.message; error.hidden = false;
      } finally {
        go.disabled = false; go.textContent = "Add";
      }
    });
  });
}

export function openEdit(idea) {
  const opt = (v, cur, label) => `<option value="${v}"${v === cur ? " selected" : ""}>${label}</option>`;
  show(`<h2>Edit idea</h2>
    <label>Title<input id="e-title" value="${esc(idea.title)}" maxlength="120"></label>
    <div class="grid2">
      <label>Type<select id="e-kind">${opt("place", idea.kind, "Place")}${opt("activity", idea.kind, "Activity")}</select></label>
      <label>Best months based on<select id="e-basis">${opt("weather", idea.season_basis, "Weather")}${opt("wildlife", idea.season_basis, "Wildlife sightings")}</select></label>
    </div>
    <label>Description<textarea id="e-desc" rows="3">${esc(idea.description ?? "")}</textarea></label>
    <div class="grid2">
      <label>Place<input id="e-region" value="${esc(idea.region ?? "")}"></label>
      <label>Country code (3 letters)<input id="e-iso" value="${esc(idea.country_iso ?? "")}" maxlength="3"></label>
      <label>Latitude<input id="e-lat" inputmode="decimal" value="${idea.lat ?? ""}"></label>
      <label>Longitude<input id="e-lng" inputmode="decimal" value="${idea.lng ?? ""}"></label>
      <label>Cost per person per day (€)<input id="e-cost" inputmode="numeric" value="${idea.cost_pp_day ?? ""}"></label>
      <label>Wildlife months (e.g. 7,8,9)<input id="e-wild" value="${(idea.wildlife_months ?? []).join(",")}"></label>
    </div>
    <div class="error" id="e-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="e-save">Save</button></div>`, (body) => {
    const v = (id) => body.querySelector(id).value.trim();
    const num = (s) => (s === "" ? null : Number(s));
    const fail = (text) => { const e = body.querySelector("#e-error"); e.textContent = text; e.hidden = false; };
    body.querySelector("#e-save").addEventListener("click", async () => {
      const lat = num(v("#e-lat")), lng = num(v("#e-lng")), cost = num(v("#e-cost"));
      if ((lat === null) !== (lng === null)) return fail("Fill in both latitude and longitude, or leave both empty.");
      if (lat !== null && !(Number.isFinite(lat) && lat >= -90 && lat <= 90)) return fail("Latitude must be a number between -90 and 90.");
      if (lng !== null && !(Number.isFinite(lng) && lng >= -180 && lng <= 180)) return fail("Longitude must be a number between -180 and 180.");
      if (cost !== null && !(Number.isInteger(cost) && cost >= 0)) return fail("Cost must be a whole number of euros.");
      const wild = v("#e-wild") ? v("#e-wild").split(",").map((s) => Number(s.trim())).filter((n) => n >= 1 && n <= 12) : null;
      const patch = {
        title: v("#e-title"), kind: v("#e-kind"), season_basis: v("#e-basis"), description: v("#e-desc") || null,
        region: v("#e-region") || null, country_iso: v("#e-iso").toUpperCase() || null,
        lat, lng, cost_pp_day: cost, wildlife_months: wild,
      };
      try {
        upsertIdea(await api.updateIdea(idea.id, patch));
        dialog().close();
        toast("Saved.");
      } catch (err) {
        const e = body.querySelector("#e-error"); e.textContent = err.message; e.hidden = false;
      }
    });
  });
}

export function openSettings() {
  const s = state.settings;
  show(`<h2>Settings</h2>
    <div class="grid2">
      <label>Your name<input id="s-me" value="${esc(state.me.name)}" maxlength="40"></label>
      <label>${esc(state.other.name)}'s name<input id="s-other" value="${esc(state.other.name)}" maxlength="40"></label>
      <label>Departure date<input id="s-date" type="date" value="${esc(s.departure_date ?? "")}"></label>
      <label>Budget (€)<input id="s-budget" inputmode="numeric" value="${s.budget_eur}"></label>
      <label>Reserved for flights (€)<input id="s-flights" inputmode="numeric" value="${s.flight_reserve_eur}"></label>
    </div>
    <div class="error" id="s-error" hidden></div>
    <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="s-save">Save</button></div>`, (body) => {
    body.querySelector("#s-save").addEventListener("click", async () => {
      const v = (id) => body.querySelector(id).value.trim();
      const whole = (s) => s !== "" && Number.isInteger(Number(s)) && Number(s) >= 0;
      if (!whole(v("#s-budget")) || !whole(v("#s-flights"))) {
        const e = body.querySelector("#s-error"); e.textContent = "Budget and flights must be whole numbers of euros."; e.hidden = false;
        return;
      }
      try {
        const saved = await api.saveSettings({
          departure_date: v("#s-date") || undefined,
          budget_eur: Number(v("#s-budget")),
          flight_reserve_eur: Number(v("#s-flights")),
          names: { [state.me.id]: v("#s-me"), [state.other.id]: v("#s-other") },
        });
        update({
          settings: saved,
          me: { ...state.me, name: saved.names[state.me.id] },
          other: { ...state.other, name: saved.names[state.other.id] },
        });
        dialog().close();
        toast("Settings saved.");
      } catch (err) {
        const e = body.querySelector("#s-error"); e.textContent = err.message; e.hidden = false;
      }
    });
  });
}

export async function openBudget() {
  let b;
  try { b = await api.budget(); } catch (err) { return toast(err.message); }
  const fmt = (n) => `€${Math.round(n).toLocaleString("en-GB")}`;
  const text = b.dailyForTwo == null
    ? `<p>This fills in once you've both rated ideas 4★ or higher. It then averages their daily costs per country to estimate how long your budget lasts.</p>`
    : `<p>Ideas you both love (${b.qualifying}) average about <b>${fmt(b.dailyForTwo)}/day for two</b>.</p>
       <p>${fmt(b.budget)} minus ${fmt(b.flightReserve)} for flights covers about <b>${b.months ?? "?"} months</b>.</p>`;
  show(`<h2>Budget check</h2>${text}<p class="hint" style="color:var(--ink-faint);font-size:13px">A rough estimate: it uses per-country median costs and ignores route and timing. Change the budget in Settings.</p>
    <div class="foot"><button class="btn primary" data-close>Close</button></div>`, () => {});
}

export async function openLink() {
  let code;
  try { code = await api.linkCode(); } catch (err) { return toast(err.message); }
  show(`<h2>Link Telegram</h2>
    <p>Open your trip bot in Telegram and send:</p>
    <div class="code">/start ${esc(code.code)}</div>
    <p style="color:var(--ink-faint);font-size:13px">The code works once and expires in 15 minutes.</p>
    <div class="foot"><button class="btn" id="l-copy">Copy</button><button class="btn primary" data-close>Done</button></div>`, (body) => {
    body.querySelector("#l-copy").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(`/start ${code.code}`); toast("Copied."); } catch { toast("Select the code and copy it."); }
    });
  });
}

export function openCountryNotes(iso) {
  show(`<h2>Notes on ${esc(countryName(iso))}</h2><div id="cn"></div><div class="foot"><button class="btn" data-close>Close</button></div>`, (body) => {
    renderNotes(body.querySelector("#cn"), { country: iso }, countryName(iso));
  });
}
