/**
 * Cherche la meilleure carrière d'un lot et raconte son parcours.
 */
import { Game } from '../src/engine/game';

function play(seed0: number) {
  let seed = seed0;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const g = new Game('', rng, 'quick');
  let guard = 0;
  while (!g.over && guard++ < 40000) {
    if (!g.pending) { g.advance(); continue; }
    const opts = g.pending.options;
    const find = (re: RegExp) => opts.findIndex((o) => re.test(o.label));
    let i: number;
    const glory = find(/Acte de gloire/);
    const goFurlough = find(/Partir en permission|Poursuivre la permission/);
    const stay = find(/Rester au service|Reprendre le service/);
    const cure = find(/Prendre une cure/);
    const guard2 = find(/Garde Impériale|Demander la Garde/);
    const bona = find(/Bonapartiste|Marcher sur Paris|Oui \(N\+5/);
    if (glory >= 0) i = glory;
    else if (bona >= 0) i = bona;
    else if (guard2 >= 0) i = guard2;
    else if (goFurlough >= 0 || stay >= 0) i = g.ch.H < 50 ? Math.max(goFurlough, 0) : Math.max(stay, 0);
    else if (cure >= 0 && g.ch.H < 70) i = cure;
    else {
      const zeal = find(/zèle/i);
      const e = opts.findIndex((o) => /E\+\d/.test(o.label));
      i = zeal >= 0 ? zeal : e >= 0 ? e : 0;
    }
    g.choose(Math.max(0, Math.min(opts.length - 1, i)));
  }
  return g;
}

const N = Number(process.argv[2] ?? 300);
let best: Game | null = null;
let bestSeed = 0;
for (let i = 0; i < N; i++) {
  const seed = 20000 + i * 7919;
  const g = play(seed);
  if (!g.over) continue;
  if (!best || g.finalScore().total > best.finalScore().total) { best = g; bestSeed = seed; }
}

const g = best!;
const f = g.finalScore();
console.log(`===== meilleure carrière sur ${N} (graine ${bestSeed}) =====`);
console.log(`${g.ch.name} — ${g.rankName()}${g.ch.title ? ' · ' + g.ch.title : ''}`);
console.log(`score ${f.total} = grade ${f.rank} + gloire ${f.glory} + LoH ${f.loh} + fortune ${f.fortune} + titres ${f.titles} + victoire ${f.victory}`);
console.log(`N ${g.ch.N} · G ${g.ch.G} · E ${g.ch.E} · santé ${g.ch.H} · morts ${g.ch.deaths} · blessures ${g.ch.nonDuelWounds}`);
console.log(`Légion d'Honneur niveau ${g.ch.loh} · fortune ${g.ch.mParis + g.ch.mPurse} F\n`);
console.log('--- fil de la carrière ---');
for (const e of g.log) {
  if (e.cls === 'title' || e.cls === 'warn') console.log(`[${e.cls}] ${e.t}`);
}
