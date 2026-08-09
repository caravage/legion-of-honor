/** Le We Were There se déclenche-t-il, et les concurrents en profitent-ils ? */
import { Game } from '../src/engine/game';
import { botChoice, botMoneyTransfer } from '../src/engine/policy';
let calls = 0, hits = 0;
for (let k = 0; k < 10; k++) {
  let seed = 900 + k * 7919;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const g = new Game('Joueur', rng, 'quick', 3);
  let guard = 0;
  while (!g.over && guard++ < 200000) {
    if (g.pending) { if (g.pending.kind === 'money') g.applyMoney(botMoneyTransfer(g.ch)); else g.choose(botChoice(g.pending, g.ch)); }
    else g.advance();
  }
  const txt = g.log.map(e => e.t).join('\n');
  calls += (txt.match(/We Were There ! — qui d’autre/g) ?? []).length;
  hits += (txt.match(/il y était aussi|vous y étiez/g) ?? []).length;
  if (k === 0) {
    const L = g.log.map(e => `[${e.cls}] ${e.t}`);
    const i = L.findIndex(l => /We Were There/.test(l));
    if (i >= 0) console.log('--- exemple ---\n' + L.slice(i - 3, i + 9).join('\n') + '\n');
  }
}
console.log(`déclenchements : ${calls} · participations : ${hits}`);
