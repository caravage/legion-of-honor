/**
 * Statistiques de fin de partie sur un lot de carrières simulées.
 * Deux politiques de jeu pour mesurer l'écart : choix au hasard, et un joueur
 * sobre qui refuse les permissions inutiles et privilégie l'expérience.
 */
import { Game } from '../src/engine/game';

type Policy = 'hasard' | 'sobre';

function play(seed0: number, policy: Policy) {
  let seed = seed0;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const g = new Game('Sim', rng, 'quick');
  let guard = 0;
  while (!g.over && guard++ < 40000) {
    if (!g.pending) { g.advance(); continue; }
    const opts = g.pending.options;
    let i: number;
    if (policy === 'hasard') {
      i = Math.floor(rng() * opts.length);
    } else {
      const find = (re: RegExp) => opts.findIndex((o) => re.test(o.label));
      // en permission seulement si la santé le réclame
      const cure = find(/Prendre une cure/);
      const goFurlough = find(/Partir en permission|Poursuivre la permission/);
      const stay = find(/Rester au service|Reprendre le service/);
      if (goFurlough >= 0 || stay >= 0) {
        i = g.ch.H < 55 ? Math.max(goFurlough, 0) : Math.max(stay, 0);
      } else if (cure >= 0 && g.ch.H < 70) {
        i = cure;
      } else {
        // sinon : le zèle, puis le gain d'expérience le plus élevé
        const zeal = find(/zèle/i);
        const e = opts.findIndex((o) => /E\+\d/.test(o.label));
        i = zeal >= 0 ? zeal : e >= 0 ? e : 0;
      }
    }
    g.choose(Math.max(0, Math.min(opts.length - 1, i)));
  }
  return { g, finished: g.over };
}

const N = Number(process.argv[2] ?? 200);

for (const policy of ['hasard', 'sobre'] as Policy[]) {
  const ranks: Record<string, number> = {};
  const G: number[] = [], E: number[] = [], Nn: number[] = [], M: number[] = [], H: number[] = [];
  let deaths = 0, offices = 0, loh = 0, titles = 0, unfinished = 0;

  for (let i = 0; i < N; i++) {
    const { g, finished } = play(1000 + i * 7919, policy);
    if (!finished) { unfinished++; continue; }
    const s = g.score();
    ranks[s.rank] = (ranks[s.rank] ?? 0) + 1;
    G.push(s.G); E.push(g.ch.E); Nn.push(g.ch.N); M.push(s.money); H.push(g.ch.H);
    deaths += g.ch.deaths;
    if (g.ch.office) offices++;
    if (s.loh > 0) loh++;
    if (s.title) titles++;
  }

  const stat = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    const avg = a.reduce((p, c) => p + c, 0) / a.length;
    return `moy ${avg.toFixed(0)} · méd ${s[Math.floor(s.length / 2)]} · max ${s[s.length - 1]}`;
  };

  console.log(`\n===== politique « ${policy} » — ${N} carrières =====`);
  if (unfinished) console.log(`  ${unfinished} parties non terminées !`);
  console.log('  Grade final :');
  const order = ['Sergent', 'Sous-Lieutenant', 'Lieutenant', 'Capitaine', 'Chef de Bataillon',
    'Major', 'Colonel', 'Général de Brigade', 'Général de Division', 'Général', 'Maréchal'];
  for (const r of order) {
    if (!ranks[r]) continue;
    const n = ranks[r];
    console.log(`    ${r.padEnd(20)} ${String(n).padStart(3)}  ${'█'.repeat(Math.round((n / N) * 40))}`);
  }
  console.log(`  Gloire      : ${stat(G)}`);
  console.log(`  Expérience  : ${stat(E)}`);
  console.log(`  Notice      : ${stat(Nn)}`);
  console.log(`  Fortune     : ${stat(M)} F`);
  console.log(`  Santé       : ${stat(H)}`);
  console.log(`  Morts (total sur le lot) : ${deaths}`);
  console.log(`  Légion d'Honneur : ${loh}/${N} · Titre : ${titles}/${N} · Office : ${offices}/${N}`);
}
