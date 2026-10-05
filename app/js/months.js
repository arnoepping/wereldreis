import { MONTHS, MONTH_NAMES, el } from "./util.js";

const WEATHER_SYMBOL = { good: "✓", borderline: "~", poor: "·", unknown: "?" };
const PRICE_SYMBOL = { low: "€", mid: "€€", high: "€€€" };

export function renderMonths(idea, departureDate) {
  const depMonth = departureDate ? Number(departureDate.slice(5, 7)) : null;
  const wrap = el(`<div><div class="months" role="table" aria-label="Best months"></div><div class="month-detail" aria-live="polite"></div></div>`);
  const grid = wrap.querySelector(".months");
  const detail = wrap.querySelector(".month-detail");
  grid.append(el(`<span></span>`));
  MONTHS.forEach((m, i) => grid.append(el(`<span class="m${i + 1 === depMonth ? " dep" : ""}" title="${i + 1 === depMonth ? "Departure month" : ""}">${m}</span>`)));

  const weatherLabel = idea.season_basis === "wildlife" ? "Wildlife" : "Weather";
  grid.append(el(`<span class="lbl">${weatherLabel}</span>`));
  idea.months.forEach((cell, i) => {
    const b = el(`<button class="cell ${cell.weather}" aria-label="${MONTH_NAMES[i]} ${weatherLabel.toLowerCase()}: ${cell.weather}">${WEATHER_SYMBOL[cell.weather]}</button>`);
    b.addEventListener("click", () => {
      if (idea.season_basis === "wildlife") detail.textContent = `${MONTH_NAMES[i]}: ${cell.weather === "good" ? "best sightings" : "fewer sightings"}`;
      else detail.textContent = cell.temp ? `${MONTH_NAMES[i]}: ${Math.round(cell.temp.min)}–${Math.round(cell.temp.max)} °C (${cell.weather})` : `${MONTH_NAMES[i]}: no climate data`;
    });
    grid.append(b);
  });

  grid.append(el(`<span class="lbl">Price</span>`));
  idea.months.forEach((cell, i) => {
    const p = cell.price;
    const b = el(`<button class="cell ${p ?? "unknown"}" aria-label="${MONTH_NAMES[i]} price: ${p ?? "unknown"}">${p ? PRICE_SYMBOL[p] : "?"}</button>`);
    b.addEventListener("click", () => (detail.textContent = `${MONTH_NAMES[i]}: ${p ? `${p} season (estimate)` : "no price estimate"}`));
    grid.append(b);
  });
  return wrap;
}
