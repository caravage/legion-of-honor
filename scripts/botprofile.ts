/** Les concurrents se distinguent-ils les uns des autres ? */
import { Game } from '../src/engine/game';
import { botChoice } from '../src/engine/policy';

const GAMES = Number(process.argv[2] ?? 40);
const BOTS = 3;
const ranks: Record<string, number> = {};
let deaths = 0, wounds = 0, furloughs = 0, offices = 0, transfers = 0, moneyMoves = 0;
const G: number[] = [], M: number[] = [], H: number[] = [];
let n = 0;

for (let k = 0; k < GAMES; k++) {
  let seed = 31 + k * 7919;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const g = new Game('Joueur', rng, 'quick', BOTS);
  let guard = 0;
  while (!g.over && guard++ < 200000) {
    if (g.pending) {
      if (g.pending.kind === 'money') g.applyMoney(0);
      else g.choose(botChoice(g.pending, g.ch));
    } else g.advance();
  }
  const txt = g.log.map((e) => e.t).join('\n');
  furloughs += (txt.match(/Partir en permission/g) ?? []).length;
  transfers += (txt.match(/Transfert accordé/g) ?? []).length;
  moneyMoves += (txt.match(/Déposer \d+ F|Retirer \d+ F/g) ?? []).length;
  for (const c of g.chars.slice(1)) {
    n++;
    ranks[c.marechal ? 'Maréchal' : ['Sergent','Sous-Lieutenant','Lieutenant','Capitaine','Chef de Bataillon','Major','Colonel','Général de Brigade','Général de Division','Général'][c.rankIdx]] =
      (ranks[c.marechal ? 'Maréchal' : ['Sergent','Sous-Lieutenant','Lieutenant','Capitaine','Chef de Bataillon','Major','Colonel','Général de Brigade','Général de Division','Général'][c.rankIdx]] ?? 0) + 1;
    G.push(c.G); M.push(c.mParis + c.mPurse); H.push(c.H);
    deaths += c.deaths; wounds += c.nonDuelWounds;
    if (c.office) offices++;
  }
}

const stat = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const avg = a.reduce((p, c) => p + c, 0) / a.length;
  const sd = Math.sqrt(a.reduce((p, c) => p + (c - avg) ** 2, 0) / a.length);
  return `moy ${avg.toFixed(0)} · écart-type ${sd.toFixed(0)} · de ${s[0]} à ${s[s.length - 1]}`;
};

console.log(`${GAMES} parties · ${n} concurrents\n`);
console.log('Grades atteints :');
for (const [r, c] of Object.entries(ranks).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${r.padEnd(20)} ${String(c).padStart(4)}  ${(c / n * 100).toFixed(0)}%`);
}
console.log(`\nGloire   : ${stat(G)}`);
console.log(`Fortune  : ${stat(M)} F`);
console.log(`Santé    : ${stat(H)}`);
console.log(`\nMorts : ${deaths} · blessures : ${wounds} (${(wounds / n).toFixed(1)} par concurrent)`);
console.log(`Offices obtenus : ${offices}/${n}`);
console.log(`Permissions prises : ${furloughs} · transferts accordés : ${transfers}`);
console.log(`Transferts d'argent effectués : ${moneyMoves}`);
