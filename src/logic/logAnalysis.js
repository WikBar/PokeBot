// Analiza logow bota (logs/app-*.log) - czysta logika dla verify-logs.js.
// Format linii: [D.MM.YYYYTHH:MM:SS] [LEVEL] wiadomosc {json}

const LINE_RE = /^\[(\d{1,2})\.(\d{1,2})\.(\d{4})T(\d{1,2}):(\d{2}):(\d{2})\] \[(\w+)\] (.*)$/;

// Progi regul.
const GAP_MINUTES = 20;               // cisza w logu = zawieszenie/wylaczenie
const FATAL_RESTART_MINUTES = 5;      // tyle czekamy na restart po Fatal error
const ERRORS_PER_HOUR = 6;            // "Error in main loop" w ciagu godziny
const MEDKIT_PER_HOUR = 5;            // "Tracisz punkty Apteczki" w ciagu godziny
const STORAGE_FULL_RATIO = 0.95;

function parseLine(raw) {
  const m = LINE_RE.exec(raw);
  if (!m) return null;
  const [, d, mo, y, h, mi, s, level, rest] = m;
  const ts = new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
  return { ts, level: level.toUpperCase(), msg: rest, raw };
}

const fmtTime = (ts) => new Date(ts).toLocaleString('pl-PL', { hour12: false });

// Zwraca { findings: [{ severity: 'error'|'warn', rule, message, at }], stats }.
// entries - wynik parseLine (posortowane po czasie), opts.since - ts od kiedy.
function analyzeLogs(entries, { since = 0, nullBytes = 0 } = {}) {
  const findings = [];
  const add = (severity, rule, message, at = null) => findings.push({ severity, rule, message, at });
  const list = entries.filter((e) => e && e.ts >= since);

  const stats = {
    lines: list.length, starts: 0, errors: 0, fatal: 0, caught: 0, goldenNests: 0,
    goldenNestsCaught: 0, sales: 0, noUltraball: 0, noBalls: 0, medkit: 0,
    from: list[0]?.ts ?? null, to: list[list.length - 1]?.ts ?? null,
  };

  if (nullBytes > 0) {
    add('error', 'null-bytes', `plik logu zawiera ${nullBytes} bajtów zerowych - zapis przerwany (zanik prądu / twardy reset)`);
  }

  let prev = null;
  let pendingFatal = null;
  let gnHold = null;                    // { location, at } po nieudanym Golden Nest
  const errorTimes = [];
  const medkitTimes = [];
  const errorKinds = new Map();
  let lastShiny = null;                 // { location, n, max } z "Shiny: próba"
  const duplicateHits = [];
  let storageMax = null;

  for (const e of list) {
    const { msg } = e;

    // Przerwa w logu. Nocna przerwa serwera gry (00:00-00:30) jest oczekiwana.
    if (prev && e.ts - prev.ts > GAP_MINUTES * 60000 && !prev.msg.includes('Trwa przerwa na serwerze')) {
      const minutes = Math.round((e.ts - prev.ts) / 60000);
      add('warn', 'gap', `brak wpisów przez ${minutes} min (${fmtTime(prev.ts)} → ${fmtTime(e.ts)})`, prev.ts);
    }

    if (msg.startsWith('Uruchamiam skrypt')) {
      stats.starts++;
      if (pendingFatal) {
        const minutes = Math.round((e.ts - pendingFatal) / 60000);
        if (minutes > FATAL_RESTART_MINUTES) {
          add('error', 'fatal-no-restart', `po błędzie krytycznym bot stał ${minutes} min (${fmtTime(pendingFatal)} → ${fmtTime(e.ts)})`, pendingFatal);
        }
        pendingFatal = null;
      }
      lastShiny = null;
      gnHold = null;
    }

    if (msg.startsWith('Fatal error')) {
      stats.fatal++;
      pendingFatal = e.ts;
    }

    if (msg.startsWith('Error in main loop')) {
      stats.errors++;
      errorTimes.push(e.ts);
      const kind = (msg.match(/"error":"([^"\\]{0,60})/) || [])[1] || 'nieznany';
      errorKinds.set(kind, (errorKinds.get(kind) || 0) + 1);
    }

    if (msg.startsWith('Łapię:')) stats.caught++;
    if (msg.startsWith('Golden Nest potwierdzony')) stats.goldenNests++;
    if (/^Shiny: Golden Nest .* złapany na lokacji/.test(msg)) stats.goldenNestsCaught++;
    if (msg.includes("Kliknięto 'Sprzedaj Zaznaczone'")) stats.sales++;
    if (msg.startsWith('Brak ultraballi na ekranie')) stats.noUltraball++;
    if (msg.startsWith('Brak ultraballi i premierballi')) stats.noBalls++;
    if (msg.includes('Tracisz punkty Apteczki')) { stats.medkit++; medkitTimes.push(e.ts); }

    // Przeplatajace sie liczniki prob = dwie instancje bota naraz: licznik
    // skacze na tej samej lokacji albo proby przeskakuja miedzy lokacjami
    // bez wpisu o zmianie lokacji.
    const shiny = msg.match(/^Shiny: próba (\d+)\/(\d+) na lokacji (\d+)/);
    if (shiny) {
      const cur = { n: +shiny[1], max: +shiny[2], location: +shiny[3] };
      if (lastShiny && cur.n !== 1) {
        if (lastShiny.location !== cur.location) {
          duplicateHits.push({ at: e.ts, why: `próby na lokacjach ${lastShiny.location} i ${cur.location} na przemian` });
        } else if (cur.n !== lastShiny.n + 1) {
          duplicateHits.push({ at: e.ts, why: `licznik prób skacze ${lastShiny.n} → ${cur.n} na lokacji ${cur.location}` });
        }
      }
      lastShiny = cur;
    }
    if (/^Shiny: .*→ lokacja/.test(msg) || msg.startsWith('Zmiana wyprawy')) lastShiny = null;

    // Zmiana lokacji w trakcie blokady po Golden Nest.
    const holdStart = msg.match(/NIE złapany - zostaję na lokacji (\d+)/);
    if (holdStart) gnHold = { location: +holdStart[1], at: e.ts };
    if (gnHold && /jeszcze 0 wypraw/.test(msg)) gnHold = null;
    const change = msg.match(/^Zmiana wyprawy: (\d+) → (\d+)/);
    if (change && gnHold && +change[1] === gnHold.location) {
      add('error', 'hold-broken', `blokada Golden Nest na lokacji ${gnHold.location} przerwana zmianą na ${change[2]} (zmiana configu z zewnątrz lub druga instancja)`, e.ts);
      gnHold = null;
    }

    const storage = msg.match(/^Przechowalnia: (\d+)\/(\d+)/);
    if (storage) storageMax = { current: +storage[1], max: +storage[2], at: e.ts };

    prev = e;
  }

  if (pendingFatal && list.length && list[list.length - 1].ts === pendingFatal) {
    add('error', 'fatal-last', `ostatni wpis to błąd krytyczny (${fmtTime(pendingFatal)}) - bot nie działa`, pendingFatal);
  }

  // Jedno znalezisko zamiast setek - pierwsze i ostatnie wystapienie.
  if (duplicateHits.length > 0) {
    const first = duplicateHits[0];
    const last = duplicateHits[duplicateHits.length - 1];
    add('error', 'duplicate-instance',
      `prawdopodobnie działały dwie instancje bota (${duplicateHits.length} sygnałów, ${fmtTime(first.at)} → ${fmtTime(last.at)}; np. ${first.why})`,
      first.at);
  }

  const burst = (times, limit) => {
    for (let i = 0, j = 0; j < times.length; j++) {
      while (times[j] - times[i] > 3600000) i++;
      if (j - i + 1 >= limit) return times[i];
    }
    return null;
  };
  const errBurst = burst(errorTimes, ERRORS_PER_HOUR);
  if (errBurst) {
    const top = [...errorKinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, n]) => `${k} (${n}x)`).join('; ');
    add('warn', 'error-burst', `≥${ERRORS_PER_HOUR} błędów pętli w ciągu godziny od ${fmtTime(errBurst)}. Najczęstsze: ${top}`, errBurst);
  }
  const medBurst = burst(medkitTimes, MEDKIT_PER_HOUR);
  if (medBurst) add('warn', 'medkit', `≥${MEDKIT_PER_HOUR}x "Tracisz punkty Apteczki" w ciągu godziny od ${fmtTime(medBurst)}`, medBurst);

  if (stats.noBalls > 0) add('error', 'no-balls', `${stats.noBalls}x brak ultraballi i premierballi - pokemony diff 5 łapane bez kuli`);
  else if (stats.noUltraball > 0) add('warn', 'no-ultraball', `${stats.noUltraball}x brak ultraballi (rzucany premierball) - dokup ultraballe`);

  if (storageMax && storageMax.max > 0 && storageMax.current / storageMax.max >= STORAGE_FULL_RATIO) {
    add('warn', 'storage', `przechowalnia prawie pełna: ${storageMax.current}/${storageMax.max}`, storageMax.at);
  }

  return { findings, stats };
}

module.exports = { parseLine, analyzeLogs, GAP_MINUTES };
