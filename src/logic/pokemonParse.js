// Parsery stron z pokemonami: Hodowla (gra/hodowla.php?wszystkie) i wyniki
// targu pokemonow (gra/targ_pok.php?oferty_strona&...). Czyste funkcje.
// Atrybuty w apostrofach i cudzyslowach (surowy HTML vs zapis przegladarki).

const { stripTags } = require('./marketParse');

// "235k ¥" -> 235000, "1.5kk" -> 1500000, "500.000 Yen" -> 500000,
// "2.200 PZ" -> 2200, "-----" -> null.
function parseAmount(text) {
  const t = stripTags(text).toLowerCase().replace(/\s+/g, '');
  const m = t.match(/(\d[\d.,]*)(kk|k|m)?/);
  if (!m) return null;
  const mult = m[2] === 'kk' || m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  // Kropka/przecinek z mnoznikiem = czesc dziesietna ("1.5kk"), bez
  // mnoznika = separator tysiecy ("500.000").
  const num = mult > 1 ? parseFloat(m[1].replace(',', '.')) : parseInt(m[1].replace(/[.,]/g, ''), 10);
  return Number.isFinite(num) ? Math.round(num * mult) : null;
}

// Hodowla: [{ id, name, level, value }], value = cena skupu w ¥.
//   <label class="... btn-hodowla">
//     <input type="checkbox" name="s_376021866" ...>
//     <b><i>Oricorio Sensu</i></b> 66poz<br/> 339282 &yen
function parseHodowla(html) {
  const out = [];
  const re = /<label class=["'][^"']*btn-hodowla[^"']*["']>([\s\S]*?)<\/label>/g;
  let m;
  while ((m = re.exec(html))) {
    const b = m[1];
    const id = (b.match(/name=["']s_(\d+)["']/) || [])[1];
    const name = (b.match(/<b><i>([^<]+)<\/i><\/b>/) || [])[1];
    if (!id || !name) continue;
    out.push({
      id: Number(id),
      name: stripTags(name),
      level: Number((b.match(/<\/b>\s*(\d+)\s*poz/) || [])[1]) || null,
      value: Number((b.match(/(\d+)\s*&yen/) || [])[1]) || null,
    });
  }
  return out;
}

// Pokemony Dnia (+140% skupu, gdy sprzedane w dniu zlapania).
function parsePokemonOfDay(html) {
  const day = (html.match(/Pokemonem Dnia jest <b><i>([^<]+)<\/i><\/b>/) || [])[1] || null;
  const guild = (html.match(/Pokemonem Dnia Stowarzyszenia jest <b><i>([^<]+)<\/i><\/b>/) || [])[1] || null;
  return { day, guild };
}

// Oferty z targu pokemonow. Kazda oferta to dwa wiersze tabeli: obrazek,
// poziom, trening, wartosc (skup), sprzedawca; potem przyciski kupna
// ("19 PZ" -> zaslugi, "500.000 Yen" -> yeny, "-----" -> brak).
// Zwraca [{ id, level, trainings, value, yenPrice, meritPrice, shiny, seller }].
// UWAGA: przyciski kupna to linki GET (targ_pok.php?yeny&kup=...) - nigdy ich
// nie pobieramy, czytamy tylko tekst.
function parsePokemonOffers(html) {
  const parts = String(html).split(/<img role=["']button["']/).slice(1);
  const offers = [];
  for (const part of parts) {
    const id = Number((part.match(/data-id-pokemona=["'](\d+)["']/) || [])[1]);
    if (!id) continue;
    const bold = [...part.matchAll(/<b>([\s\S]*?)<\/b>/g)].map((x) => x[1]);
    const img = (part.match(/src=["']pokemony\/([^"']+)["']/) || [])[1] || '';
    const yen = part.match(/kup=\d+[^"']*["'][^>]*>([^<]*Yen[^<]*)</i);
    const merit = part.match(/kup=\d+[^"']*["'][^>]*>([^<]*PZ[^<]*)</i);
    offers.push({
      id,
      level: parseAmount(bold[0] || ''),
      trainings: parseAmount(bold[1] || '') ?? 0,
      value: parseAmount(bold[2] || ''),
      yenPrice: yen ? parseAmount(yen[1]) : null,
      meritPrice: merit ? parseAmount(merit[1]) : null,
      // Shiny maja obrazek z prefiksem "s" (pokemony/s157.png).
      shiny: /^s\d/.test(img),
      seller: stripTags((part.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || '') || null,
    });
  }
  return offers;
}

module.exports = { parseAmount, parseHodowla, parsePokemonOfDay, parsePokemonOffers };
