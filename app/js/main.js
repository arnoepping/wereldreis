import { api } from "./api.js";
import { state, update, subscribe } from "./state.js";
import { loadCountries } from "./geo.js";
import { createGlobe } from "./globe.js";
import { hooks, renderPanel } from "./panel.js";
import { isPhone, toast } from "./util.js";
import { renderCard } from "./card.js";
import { openAdd, openBudget, openCountryNotes, openLink, openSettings, setOpenIdea } from "./forms.js";

let globe;

function navigate(view) {
  update({ view: { level: "world", cont: null, iso: null, ideaId: null, ...view } });
  globe.go(state.view);
  history.replaceState(null, "", view.ideaId != null ? `#idea-${view.ideaId}` : view.iso ? `#country-${view.iso}` : location.pathname);
}

export function openIdea(id) {
  const idea = state.ideas.find((i) => i.id === id);
  if (!idea) return toast("That idea no longer exists.");
  const p = state.countries.get(idea.country_iso);
  if (p) navigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: id });
  else { navigate({ level: "world", ideaId: id }); globe.flyToIdea(idea); }
  document.getElementById("panel").classList.remove("collapsed");
}

export async function refreshIdeas() {
  const { ideas, country_note_counts } = await api.ideas();
  update({ ideas, countryNotes: country_note_counts });
  globe.setIdeas(ideas);
}

function renderSub() {
  const dep = state.settings?.departure_date;
  const sub = document.getElementById("sub");
  if (!dep) { sub.textContent = ""; return; }
  const days = Math.ceil((new Date(`${dep}T00:00:00`) - new Date()) / 86_400_000);
  const date = new Date(`${dep}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  sub.innerHTML = days > 0 ? `${state.me.name} &amp; ${state.other.name} · departure ${date} · <b>${days.toLocaleString("en-GB")}</b> days to go` : `${state.me.name} &amp; ${state.other.name} · on the road`;
}

function routeFromHash() {
  const m = location.hash.match(/^#(idea|country)-(.+)$/);
  if (!m) return;
  if (m[1] === "idea") openIdea(Number(m[2]));
  else {
    const p = state.countries.get(m[2]);
    if (p) navigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: null });
  }
}

async function boot() {
  try {
    const [countries, me, settings, ideasRes] = await Promise.all([loadCountries(), api.me(), api.settings(), api.ideas()]);
    update({ me, other: me.other, settings, countries: countries.byIso, ideas: ideasRes.ideas, countryNotes: ideasRes.country_note_counts });
    globe = createGlobe(document.getElementById("map"), {
      countriesGeo: countries.geojson,
      byIso: countries.byIso,
      onNavigate: navigate,
      onOpenIdea: openIdea,
    });
    hooks.onNavigate = navigate;
    hooks.onOpenIdea = openIdea;
    hooks.renderCard = renderCard;
    setOpenIdea(openIdea);
    hooks.onAction = (action) => {
      if (action === "add") openAdd();
      else if (action === "budget") openBudget();
      else if (action === "settings") openSettings();
      else if (action === "link") openLink();
      else if (action === "country-notes") openCountryNotes(state.view.iso);
    };
    subscribe(() => globe.setIdeas(state.ideas));
    subscribe(() => { renderPanel(); renderSub(); });
    renderPanel();
    renderSub();
    await globe.ready;
    globe.setIdeas(state.ideas);
    routeFromHash();
    addEventListener("hashchange", routeFromHash);
  } catch (err) {
    document.getElementById("loading").textContent = err.message;
  }
}

document.getElementById("grab").addEventListener("click", () => document.getElementById("panel").classList.toggle("collapsed"));
if (isPhone()) document.getElementById("panel").classList.add("collapsed");
boot();
