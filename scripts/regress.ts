/**
 * Filet de non-régression.
 *
 * Il compare la **mécanique** d'une partie, pas sa prose : le flux de dés
 * (nombre de tirages et empreinte), chaque variation de caractéristique, et
 * l'état final de tous les Grognards. Reformuler un message ne le fait pas
 * broncher ; changer une règle, si.
 *
 *   npm run regress              vérifie
 *   npm run regress -- --update  regénère la référence après un changement voulu
 */
import fs from 'fs';
import path from 'path';
import { Game } from '../src/engine/game';
import { botChoice, botMoneyTransfer } from '../src/engine/policy';

const BASELINE = path.join('tests', 'baseline.json');

interface Case { name: string; seed: number; bots: number; mode: 'quick' | 'guided' }

const CASES: Case[] = [
  { name: 'solo-A', seed: 1234, bots: 0, mode: 'quick' },
  { name: 'solo-B', seed: 98765, bots: 0, mode: 'quick' },
  { name: 'solo-guidé', seed: 4242, bots: 0, mode: 'guided' },
  { name: 'duo', seed: 555, bots: 1, mode: 'quick' },
  { name: 'quatuor', seed: 777, bots: 3, mode: 'quick' },
  { name: 'sextuor', seed: 31337, bots: 5, mode: 'quick' },
  // Parties choisies pour exercer ce que les précédentes n'atteignent jamais :
  // le généralat, les titres de noblesse et la victoire à Mont Saint-Jean.
  { name: 'généralat', seed: 301922, bots: 2, mode: 'quick' },
  { name: 'titres', seed: 777062, bots: 4, mode: 'quick' },
  { name: 'mont-st-jean', seed: 32676, bots: 4, mode: 'quick' },
  { name: 'victoire-duo', seed: 278165, bots: 2, mode: 'quick' },
];

interface Result { draws: number; hash: number; trace: string[]; final: string[] }

function play(c: Case): Result {
  let seed = c.seed;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const g = new Game('Joueur', rng, c.mode, c.bots);
  g.traceOn = true;
  let guard = 0;
  while (!g.over && guard++ < 300000) {
    if (g.pending) {
      if (g.pending.kind === 'money') g.applyMoney(botMoneyTransfer(g.ch));
      else {
        g.choose(botChoice(g.pending, g.ch, {
          engaged: g.activeCommands().has(g.ch.assignment),
          rng,
        }));
      }
    } else g.advance();
  }
  const final = g.chars.map((ch) =>
    `${ch.marechal ? 'M' : ch.rankIdx}|${ch.title ?? '-'}|N${ch.N} G${ch.G} E${ch.E}` +
    `|H${ch.H} C${ch.C} F${ch.F}|S${ch.standing}|${ch.mParis}+${ch.mPurse}` +
    `|LoH${ch.loh}|${ch.assignment}|morts ${ch.deaths}|bless ${ch.nonDuelWounds}`,
  );
  if (!g.over) final.push('PARTIE NON TERMINÉE');
  final.push(...g.victoryPoints().map((r) => `vp${r.vp} ${r.wins.join('|')}`));
  return { draws: g.rngDraws, hash: g.rngHash, trace: g.trace, final };
}

const update = process.argv.includes('--update');
const current: Record<string, Result> = {};
for (const c of CASES) current[c.name] = play(c);

if (update) {
  fs.mkdirSync('tests', { recursive: true });
  fs.writeFileSync(BASELINE, JSON.stringify(current, null, 1));
  const n = Object.values(current).reduce((a, b) => a + b.trace.length, 0);
  console.log(`référence enregistrée : ${CASES.length} parties, ${n} variations.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('Aucune référence. Lancez : npm run regress -- --update');
  process.exit(2);
}

const base: Record<string, Result> = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
let failed = 0;

for (const c of CASES) {
  const a = base[c.name];
  const b = current[c.name];
  const problems: string[] = [];
  if (!a) { console.log(`  ? ${c.name} — absent de la référence`); continue; }

  if (a.draws !== b.draws) problems.push(`tirages de dés : ${a.draws} → ${b.draws}`);
  if (a.hash !== b.hash) problems.push('empreinte du flux de dés différente');
  if (a.trace.length !== b.trace.length) {
    problems.push(`variations : ${a.trace.length} → ${b.trace.length}`);
  }
  const i = a.trace.findIndex((x, k) => x !== b.trace[k]);
  if (i >= 0) {
    problems.push(
      `première divergence à la variation n°${i} : attendu « ${a.trace[i]} », obtenu « ${b.trace[i] ?? '(fin)'} »`,
    );
  }
  a.final.forEach((f, k) => {
    if (f !== b.final[k]) problems.push(`état final n°${k} :\n        attendu ${f}\n        obtenu  ${b.final[k] ?? '(absent)'}`);
  });

  if (!problems.length) {
    console.log(`  ✓ ${c.name.padEnd(12)} ${b.draws} dés · ${b.trace.length} variations`);
    continue;
  }
  failed++;
  console.log(`  ✗ ${c.name}`);
  for (const p of problems.slice(0, 4)) console.log(`      ${p}`);
}

if (failed) {
  console.error(`\n${failed} partie(s) divergent. Si le changement est voulu : npm run regress -- --update`);
  process.exit(1);
}
console.log('\nAucune régression : la mécanique est intacte.');
