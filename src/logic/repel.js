// Auto-Tepel/Repel - czysta decyzja, czy i ktory przedmiot uzyc.

const AUTO_REPEL_DEFAULT_MIN = 2;

// Zwraca jedno z:
// - { use: { kind, tier }, source: 'panel' | 'auto', fallbackFrom? }
// - { skip: 'disabled' | 'enough' | 'noStock', kind? }
// repel: { value } z ekranu (brak licznika = nic nie dziala, wiec odnawiamy),
// useRepelRequest: zlecenie z panelu (ma pierwszenstwo),
// stock: { 'repel-1': n, ... } z plecaka albo null (nieznany stan).
function decideRepelUse({ repel, useRepelRequest, stock }, cfg = {}) {
  if (useRepelRequest) {
    return { use: { kind: useRepelRequest.kind, tier: useRepelRequest.tier }, source: 'panel' };
  }
  if (cfg.autoRepelEnabled === false) return { skip: 'disabled' };

  const min = Number.isFinite(Number(cfg.autoRepelMin))
    ? Number(cfg.autoRepelMin)
    : AUTO_REPEL_DEFAULT_MIN;
  const value = repel?.value;
  if (value !== undefined && value !== null && value >= min) return { skip: 'enough' };

  const kind = cfg.autoRepelKind === 'tepel' ? 'tepel' : 'repel';
  const tier = Number(cfg.autoRepelTier) || 1;

  // Wybrany poziom moze sie skonczyc - wtedy bierzemy inny, jaki mamy.
  if (stock && !(stock[`${kind}-${tier}`] > 0)) {
    const fallback = [1, 2, 3].find((t) => stock[`${kind}-${t}`] > 0);
    if (!fallback) return { skip: 'noStock', kind };
    return { use: { kind, tier: fallback }, source: 'auto', fallbackFrom: tier, min, value };
  }
  return { use: { kind, tier }, source: 'auto', min, value };
}

module.exports = { AUTO_REPEL_DEFAULT_MIN, decideRepelUse };
