// Statystyki polowania na Shiny per lokacja - czysta logika.
// Ksztalt: { [region]: { [nr]: { name, trips, goldenNests, caught, lastGoldenNest } } }

function recordTrip(stats, { region, location, name, goldenNest = false, caught = false, at = new Date().toISOString() }) {
  const next = { ...(stats || {}) };
  const reg = { ...(next[region] || {}) };
  const key = String(location);
  const cur = { name, trips: 0, goldenNests: 0, caught: 0, lastGoldenNest: null, ...(reg[key] || {}) };
  cur.name = name || cur.name;
  cur.trips += 1;
  if (goldenNest) {
    cur.goldenNests += 1;
    cur.lastGoldenNest = at;
    if (caught) cur.caught += 1;
  }
  reg[key] = cur;
  next[region] = reg;
  return next;
}

// Lista lokacji regionu z czestotliwoscia Golden Nest (na 1000 wypraw),
// posortowana od najlepszej.
function summarize(stats, region) {
  return Object.entries(stats?.[region] || {})
    .map(([nr, s]) => ({
      nr: Number(nr),
      ...s,
      perThousand: s.trips > 0 ? Math.round((s.goldenNests / s.trips) * 10000) / 10 : 0,
    }))
    .sort((a, b) => b.perThousand - a.perThousand || a.nr - b.nr);
}

module.exports = { recordTrip, summarize };
