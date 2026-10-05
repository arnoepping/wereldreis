export const CONTINENTS = {
  "Europe": [[-25, 34], [42, 71]],
  "Asia": [[60, -11], [150, 55]],
  "Africa": [[-19, -36], [52, 37]],
  "North America": [[-168, 8], [-52, 70]],
  "South America": [[-82, -56], [-34, 13]],
  "Oceania": [[112, -48], [179, -9]],
};

export async function loadCountries() {
  const geojson = await (await fetch("data/countries.json")).json();
  const byIso = new Map(geojson.features.map((f) => [f.properties.iso, f.properties]));
  return { geojson, byIso };
}
