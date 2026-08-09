/** Vérifie les ratios de substitution sur des cas construits. */
import { Game } from '../src/engine/game';

const g = new Game('Test', Math.random, 'quick');
g.season = 10; // notice exigée

function t(label: string, N: number, G: number, E: number, rankIdx: number) {
  g.ch.N = N; g.ch.G = G; g.ch.E = E;
  const gap = g.rankGap(rankIdx)!;
  console.log(
    `${label.padEnd(46)} N${String(N).padStart(4)} G${String(G).padStart(4)} E${String(E).padStart(4)}` +
    ` → ${gap.ok ? 'PROMU  ' : 'refusé '} (G→E ${gap.gToE}, N→G ${gap.nToG})`,
  );
}
// colonel : N40 G155 E130
console.log('--- vers colonel : il faut N 40, G 155, E 130 ---');
t('pile les trois seuils', 40, 155, 130, 6);
t('20 d’expérience manquants, 40 de gloire en trop', 40, 195, 110, 6);
t('idem mais 39 de gloire en trop seulement', 40, 194, 110, 6);
t('30 de gloire manquants, 30 de notice en trop', 70, 125, 130, 6);
t('idem mais 29 de notice en trop seulement', 69, 125, 130, 6);
t('notice massive : couvre le seuil de gloire (max 155)', 400, 100, 100, 6);
t('gloire trop faible pour payer l’expérience : refusé', 400, 40, 100, 6);
t('gloire tout juste suffisante pour l’expérience', 400, 60, 100, 6);
t('cumul : notice paie la gloire, gloire paie l’expérience', 90, 195, 110, 6);
