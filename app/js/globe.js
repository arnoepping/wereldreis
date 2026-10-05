import { CONTINENTS } from "./geo.js";
import { esc, isPhone, reducedMotion } from "./util.js";

const SAT = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg";
const CLEAR = "rgba(0,0,0,0)", LIFT = "rgba(255,255,255,0.22)", SHADE = "rgba(6,10,19,0.55)";
const COLORS = { a: "#f4a63a", b: "#ff7fa3" };

function starImage(color) {
  const s = 48, c = document.createElement("canvas");
  c.width = c.height = s;
  const g = c.getContext("2d");
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 9 : 21, a = (Math.PI / 5) * i - Math.PI / 2;
    g.lineTo(s / 2 + r * Math.cos(a), s / 2 + r * Math.sin(a));
  }
  g.closePath();
  g.fillStyle = color; g.fill();
  g.lineWidth = 3; g.strokeStyle = "#ffffff"; g.stroke();
  return g.getImageData(0, 0, s, s);
}

function starsBackdrop(container) {
  const c = document.createElement("canvas"); c.width = c.height = 800;
  const g = c.getContext("2d");
  for (let i = 0; i < 420; i++) {
    const r = Math.random();
    g.fillStyle = `rgba(255,255,255,${0.15 + r * 0.6})`;
    g.beginPath(); g.arc(Math.random() * 800, Math.random() * 800, r < 0.93 ? 0.6 : 1.3, 0, Math.PI * 2); g.fill();
  }
  container.style.setProperty("--stars", `url(${c.toDataURL()})`);
}

export function createGlobe(container, { countriesGeo, byIso, onNavigate, onOpenIdea }) {
  starsBackdrop(container);
  const map = new maplibregl.Map({
    container,
    center: [8, 30],
    zoom: isPhone() ? 0.9 : 1.6,
    minZoom: 0.6,
    maxZoom: 15,
    attributionControl: false,
    style: {
      version: 8,
      projection: { type: "globe" },
      sky: { "sky-color": "#1d5a85", "horizon-color": "#9fd0f2", "fog-color": "#4f8fc0", "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] },
      sources: {
        relief: { type: "raster", tiles: [new URL("tiles/", location.href).href + "{z}/{x}/{y}.jpg"], tileSize: 512, maxzoom: 4 },
        sat: { type: "raster", tiles: [SAT], tileSize: 256, maxzoom: 15 },
      },
      layers: [
        { id: "ocean", type: "background", paint: { "background-color": "#4f8fc0" } },
        { id: "relief", type: "raster", source: "relief" },
        { id: "sat", type: "raster", source: "sat", minzoom: 4.5, paint: { "raster-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0, 6, 1] } },
      ],
    },
  });

  const view = { level: "world", cont: null, iso: null };
  let ideas = [];
  let labels = [];
  let selected = null;
  let spinning = !reducedMotion();

  const ready = new Promise((resolve) => map.on("load", async () => {
    const [borders, lakes] = await Promise.all(["data/borders.json", "data/lakes.json"].map((f) => fetch(f).then((r) => r.json())));
    map.addImage("star-a", starImage(COLORS.a));
    map.addImage("star-b", starImage(COLORS.b));
    map.addSource("countries", { type: "geojson", data: countriesGeo, promoteId: "iso" });
    map.addSource("borders", { type: "geojson", data: borders });
    map.addSource("lakes", { type: "geojson", data: lakes });
    map.addSource("regions", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    map.addSource("pins", { type: "geojson", data: { type: "FeatureCollection", features: [] }, promoteId: "id" });
    map.addLayer({ id: "land", type: "fill", source: "countries", paint: { "fill-color": landColor() } });
    map.addLayer({ id: "lakes", type: "fill", source: "lakes", minzoom: 3, maxzoom: 5, paint: { "fill-color": "#4d93cf" } });
    map.addLayer({ id: "regions", type: "line", source: "regions", paint: { "line-color": "rgba(255,255,255,0.6)", "line-width": 1, "line-dasharray": [2, 2] } });
    map.addLayer({ id: "borders", type: "line", source: "borders", paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": ["interpolate", ["linear"], ["zoom"], 1, 0.4, 8, 1.6] } });
    map.addLayer({ id: "sel-border", type: "line", source: "countries", filter: ["==", ["get", "iso"], ""], paint: { "line-color": "#eef1f5", "line-width": 2 } });
    map.addLayer({ id: "pins", type: "circle", source: "pins", filter: ["==", ["get", "must"], 0], paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 1, ["case", ["boolean", ["feature-state", "sel"], false], 5, 3.5], 8, ["case", ["boolean", ["feature-state", "sel"], false], 10, 7]],
      "circle-color": ["match", ["get", "by"], "a", COLORS.a, COLORS.b],
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 8, 2],
      "circle-pitch-alignment": "map",
    } });
    map.addLayer({ id: "pins-must", type: "symbol", source: "pins", filter: ["==", ["get", "must"], 1], layout: {
      "icon-image": ["match", ["get", "by"], "a", "star-a", "star-b"],
      "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.35, 8, 0.7],
      "icon-allow-overlap": true,
    } });
    document.getElementById("loading").hidden = true;
    wire();
    applyView();
    spin();
    resolve();
  }));

  function landColor() {
    const hover = ["boolean", ["feature-state", "hover"], false];
    if (view.level === "world") return ["case", hover, LIFT, CLEAR];
    if (view.level === "continent") return ["case", ["!=", ["get", "cont"], view.cont], SHADE, hover, LIFT, CLEAR];
    return ["case", ["==", ["get", "iso"], view.iso], CLEAR, hover, "rgba(6,10,19,0.32)", SHADE];
  }

  function pinAt(pt) {
    const r = 10;
    return map.queryRenderedFeatures([[pt.x - r, pt.y - r], [pt.x + r, pt.y + r]], { layers: ["pins", "pins-must"] })[0];
  }

  let hovered = null;
  function wire() {
    ["mousedown", "touchstart", "wheel", "dragstart"].forEach((ev) => map.on(ev, () => (spinning = false)));
    map.on("moveend", spin);
    map.on("mousemove", (e) => {
      const pin = pinAt(e.point);
      const f = pin ? null : map.queryRenderedFeatures(e.point, { layers: ["land"] })[0];
      const id = f ? f.properties.iso : null;
      if (hovered !== id) {
        if (hovered) map.setFeatureState({ source: "countries", id: hovered }, { hover: false });
        if (id) map.setFeatureState({ source: "countries", id }, { hover: true });
        hovered = id;
      }
      map.getCanvas().style.cursor = pin || f ? "pointer" : "";
    });
    map.on("click", (e) => {
      const pin = pinAt(e.point);
      if (pin) return onOpenIdea(Number(pin.properties.id));
      const f = map.queryRenderedFeatures(e.point, { layers: ["land"] })[0];
      if (!f) return;
      const p = byIso.get(f.properties.iso);
      if (!p || !CONTINENTS[p.cont]) return;
      if (view.level === "world") onNavigate({ level: "continent", cont: p.cont, iso: null, ideaId: null });
      else if (view.level === "continent") onNavigate(p.cont === view.cont ? { level: "country", cont: p.cont, iso: p.iso, ideaId: null } : { level: "continent", cont: p.cont, iso: null, ideaId: null });
      else if (p.iso !== view.iso) onNavigate({ level: "country", cont: p.cont, iso: p.iso, ideaId: null });
    });
  }

  function spin() {
    if (!spinning || view.level !== "world" || map.isMoving()) return;
    const c = map.getCenter(); c.lng -= 8;
    map.easeTo({ center: c, duration: 1000, easing: (n) => n });
  }

  // On phones the bottom sheet's current height decides how much map is visible.
  const padding = () => (isPhone()
    ? { top: 130, bottom: document.getElementById("panel").offsetHeight + 20, left: 24, right: 24 }
    : { top: 110, bottom: 40, left: 40, right: 380 + 56 });
  const fly = (b) => map.fitBounds(b, { padding: padding(), duration: reducedMotion() ? 0 : 2200, essential: true, maxZoom: 9 });

  async function loadRegions(iso) {
    let data = { type: "FeatureCollection", features: [] };
    if (iso) {
      try { const res = await fetch(`data/regions/${iso}.json`); if (res.ok) data = await res.json(); } catch {}
    }
    if (view.iso === iso) map.getSource("regions").setData(data);
  }

  function applyView() {
    if (!map.getLayer("land")) return;
    map.setPaintProperty("land", "fill-color", landColor());
    map.setFilter("sel-border", ["==", ["get", "iso"], view.iso ?? ""]);
    loadRegions(view.iso);
    renderLabels();
  }

  function renderLabels() {
    labels.forEach((l) => l.marker.remove());
    labels = [];
    if (view.level !== "country") return;
    ideas.filter((i) => i.country_iso === view.iso && i.lat != null).forEach((i) => {
      const b = document.createElement("button");
      b.className = "pin-label" + (selected === i.id ? " sel" : "");
      b.innerHTML = `${i.must_do ? "★ " : ""}${esc(i.title)}`;
      b.addEventListener("click", (ev) => { ev.stopPropagation(); onOpenIdea(i.id); });
      labels.push({ id: i.id, el: b, marker: new maplibregl.Marker({ element: b, anchor: "bottom" }).setLngLat([i.lng, i.lat]).addTo(map) });
    });
  }

  function setSelected(id) {
    if (selected != null) map.setFeatureState({ source: "pins", id: selected }, { sel: false });
    selected = id;
    if (id != null && map.getSource("pins")) map.setFeatureState({ source: "pins", id }, { sel: true });
    labels.forEach((l) => l.el.classList.toggle("sel", l.id === id));
  }

  return {
    ready,
    setIdeas(next) {
      ideas = next;
      if (!map.getSource("pins")) return;
      map.getSource("pins").setData({
        type: "FeatureCollection",
        features: ideas.filter((i) => i.lat != null && i.lng != null).map((i) => ({
          type: "Feature", id: i.id,
          properties: { id: i.id, by: i.added_by, must: i.must_do ? 1 : 0 },
          geometry: { type: "Point", coordinates: [i.lng, i.lat] },
        })),
      });
      renderLabels();
      if (selected != null) setSelected(selected);
    },
    go(next) {
      const changed = next.level !== view.level || next.cont !== view.cont || next.iso !== view.iso;
      Object.assign(view, { level: next.level, cont: next.cont, iso: next.iso });
      setSelected(next.ideaId ?? null);
      if (!changed) return;
      if (next.level === "world") {
        spinning = !reducedMotion();
        map.flyTo({ center: [map.getCenter().lng, 25], zoom: isPhone() ? 0.9 : 1.6, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: reducedMotion() ? 0 : 2000, essential: true });
      } else if (next.level === "continent") {
        fly(CONTINENTS[next.cont]);
      } else {
        const p = byIso.get(next.iso);
        if (p) fly([[p.bbox[0], p.bbox[1]], [p.bbox[2], p.bbox[3]]]);
      }
      applyView();
    },
    flyToIdea(idea) {
      if (idea.lat == null) return;
      spinning = false;
      map.flyTo({ center: [idea.lng, idea.lat], zoom: Math.max(map.getZoom(), 8), padding: padding(), duration: reducedMotion() ? 0 : 1800, essential: true });
    },
  };
}
