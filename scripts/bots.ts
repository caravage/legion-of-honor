/** Partie avec concurrents : vérifie que tout se déroule et affiche le classement. */
import { Game } from '../src/engine/game';
import { botChoice } from '../src/engine/policy';

const bots = Number(process.argv[2] ?? 3);
let seed = 777;
const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const g = new Game('Joueur', rng, 'quick', bots);
let guard = 0;
while (!g.over && guard++ < 200000) {
  if (g.pending) {
    if (g.pending.kind === 'money') g.applyMoney(0);
    else g.choose(botChoice(g.pending, g.ch));
  } else g.advance();
}
console.log(`terminé=${g.over} saison=${g.season} journal=${g.log.length} lignes`);
console.log(`Grognards : ${g.chars.length}\n`);
for (const r of g.victoryPoints()) {
  const c = r.ch;
  console.log(
    `${String(r.vp)} pt  ${c.name.padEnd(34)} ${(c.marechal ? 'Maréchal' : '').padEnd(9)}` +
    ` G${String(c.G).padStart(4)} LoH${c.loh} ${String(c.mParis + c.mPurse).padStart(5)}F` +
    `  ${r.wins.join(', ')}`,
  );
}
