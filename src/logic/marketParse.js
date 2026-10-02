// Parsery stron targu (gra/targ_prz.php) - czyste funkcje na HTML.
//
// "Kup - Przedmioty" to katalog: zakladki (Jagody, Pokeballe, Okruchy,
// Inne, Ewolucyjne, Trzymane) z przyciskami
//   <button class="... btn-akcja ..." href="targ_prz.php?szukaj&przedmiot=ultraballe&zakladka=1&...">
//     <small>Ultraballe</small>
// Klikniecie przycisku laduje liste ofert danego przedmiotu.

const decode = (s) => String(s)
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const stripTags = (s) => decode(String(s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ''))
  .replace(/\s+/g, ' ').trim();

// Katalog przedmiotow: [{ code, name, tab, tabIndex, href }].
// tab - nazwa zakladki (np. "Pokeballe"), code - wartosc parametru
// przedmiot (np. "ultraballe"), uzywana w configu marketWatchItems.
function parseCatalog(html) {
  const tabNames = {};
  const tabRe = /<a href="#(targ_kupprz-[\w-]+)"[^>]*>([^<]+)<\/a>/g;
  let m;
  while ((m = tabRe.exec(html))) tabNames[m[1]] = m[2].trim();

  // Dzielimy po panelach zakladek, zeby przypisac przedmiot do zakladki.
  const items = [];
  const paneRe = /<div role="tabpanel"[^>]*id="(targ_kupprz-[\w-]+)"[^>]*>([\s\S]*?)(?=<div role="tabpanel"|$)/g;
  while ((m = paneRe.exec(html))) {
    const [, paneId, body] = m;
    const btnRe = /<button[^>]*href="([^"]*przedmiot=([\w-]+)[^"]*)"[^>]*>([\s\S]*?)<\/button>/g;
    let b;
    while ((b = btnRe.exec(body))) {
      const href = decode(b[1]);
      const tabIndex = Number((href.match(/zakladka=(\d+)/) || [])[1]);
      const small = (b[3].match(/<small>([\s\S]*?)<\/small>/) || [])[1];
      items.push({
        code: b[2],
        name: small ? stripTags(small) : b[2],
        tab: tabNames[paneId] || paneId,
        tabIndex: Number.isFinite(tabIndex) ? tabIndex : null,
        href,
      });
    }
  }
  return items;
}

// Lista ofert jednego przedmiotu. Do czasu poznania struktury tej strony
// zwraca null - skaner zapisuje wtedy strone do logs/market/.
function parseItemOffers(_html) {
  return null;
}

module.exports = { parseCatalog, parseItemOffers, stripTags };
