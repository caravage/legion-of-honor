/** Simulation headless : joue N carrières complètes en choisissant au hasard. */
import { Game } from '../src/engine/game';

const runs = Number(process.argv[2] ?? 5);
const verbose = process.argv.includes('-v');

for (let n = 0; n < runs; n++) {
  let seed = 1234 + n * 7919;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const g = new Game(`Grognard ${n + 1}`, rng);
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    if (g.pending) g.choose(Math.floor(rng() * g.pending.options.length));
    else g.advance();
  }
  if (verbose && n === 0) {
    for (const e of g.log) console.log(`[${e.cls}] ${e.t}`);
  }
  const s = g.score();
  console.log(
    `#${n + 1} guard=${guard} over=${g.over} saison=${g.season} | ${s.rank}` +
      `${s.title ? ' ' + s.title : ''} · G${s.G} · LoH${s.loh} · ${s.money}F · morts=${g.ch.deaths}` +
      ` · log=${g.log.length}`,
  );
}
