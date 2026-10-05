const listeners = new Set();

export const state = {
  me: null,
  other: null,
  ideas: [],
  countryNotes: {},
  settings: null,
  countries: new Map(),
  view: { level: "world", cont: null, iso: null, ideaId: null },
};

export function update(patch) {
  Object.assign(state, patch);
  listeners.forEach((fn) => fn(state));
}
export const subscribe = (fn) => listeners.add(fn);

export function upsertIdea(dto) {
  const ideas = state.ideas.filter((i) => i.id !== dto.id);
  ideas.unshift(dto);
  update({ ideas });
}
export const removeIdea = (id) => update({ ideas: state.ideas.filter((i) => i.id !== id) });
export const nameOf = (userId) => (userId === state.me?.id ? state.me.name : state.other?.name) ?? userId;
export const countryName = (iso) => state.countries.get(iso)?.name ?? iso ?? "Unknown country";
