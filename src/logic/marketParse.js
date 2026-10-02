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

// "30.000&nbsp;¥" -> 30000; "-----" (brak ceny w tej walucie) -> null.
function parsePrice(text) {
  const digits = stripTags(text).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// Lista ofert jednego przedmiotu (strona po kliknieciu w katalogu).
// Kazda oferta to:
//   <form class="tr" action="targ_prz.php?szukaj&przedmiot=rawst_berry">
//     <span class="td"><img ...></span>
//     <span class="td">3569</span>                 ilosc
//     <span class="td">30.000&nbsp;¥</span>         cena za sztuke w Yenach
//     <span class="td">-----</span>                 cena w zaslugach (§)
//     ... <strong>Sprzedawca</strong> ...
//     <input type="hidden" name="id_oferty" value="3961166">
// Zwraca [{ id, item, quantity, unitPrice, meritPrice, seller }] albo null,
// gdy to nie jest strona ofert (np. zmienil sie wyglad gry).
// unitPrice = cena w ¥ (null, gdy oferta tylko za zaslugi).
function parseItemOffers(html) {
  if (!/<h2>\s*Oferty\s*<\/h2>/i.test(html) && !/name="id_oferty"/.test(html)) return null;

  const offers = [];
  const formRe = /<form class="tr"[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/g;
  let m;
  while ((m = formRe.exec(html))) {
    const action = decode(m[1]);
    const body = m[2];
    const cells = [...body.matchAll(/<span class="td[^"]*">([\s\S]*?)<\/span>/g)].map((c) => c[1]);
    const id = (body.match(/name="id_oferty" value="(\d+)"/) || [])[1];
    if (!id || cells.length < 4) continue;
    offers.push({
      id: Number(id),
      item: (action.match(/przedmiot=([\w-]+)/) || [])[1] || null,
      quantity: parsePrice(cells[1]),
      unitPrice: parsePrice(cells[2]),
      meritPrice: parsePrice(cells[3]),
      seller: stripTags((body.match(/<strong>([\s\S]*?)<\/strong>/) || [])[1] || '') || null,
    });
  }
  return offers;
}

module.exports = { parseCatalog, parseItemOffers, stripTags };
