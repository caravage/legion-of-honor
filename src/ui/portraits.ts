/**
 * Attribution des visages : purement cosmétique, hors moteur. Le tirage
 * passe par `Math.random`, jamais par `this.rng()` — il ne doit rien changer
 * au flux de dés que compare la régression.
 */
import type { Game } from '../engine/game';
import { publicPath } from '../engine/data';
import { readPortraits, writePortraits } from '../engine/storage';

const VISAGE_COUNT = 10;

export function portraitSrc(visage: number): string {
  return publicPath(`portraits/visage-${visage}.jpg`);
}

export const BADGE = {
  N: publicPath('badges/N.jpg'),
  G: publicPath('badges/G.jpg'),
  E: publicPath('badges/E.jpg'),
  C: publicPath('badges/C.jpg'),
  F: publicPath('badges/F.jpg'),
  S: publicPath('badges/S.jpg'),
  mParis: publicPath('badges/paris.jpg'),
  mPurse: publicPath('badges/bourse.jpg'),
};

/**
 * Un visage par Grognard, jamais deux fois le même. Stable tant que
 * `deaths` ne bouge pas ; une renaissance en tire un nouveau parmi ceux que
 * les vivants ne portent pas déjà.
 */
export function getPortraits(game: Game): number[] {
  const stored = readPortraits();
  const used = new Set<number>();
  const result: number[] = [];
  const pending: number[] = [];

  game.chars.forEach((ch, i) => {
    const entry = stored[i];
    if (entry && entry.deaths === ch.deaths) {
      result[i] = entry.visage;
      used.add(entry.visage);
    } else {
      pending.push(i);
    }
  });

  for (const i of pending) {
    const free: number[] = [];
    for (let n = 1; n <= VISAGE_COUNT; n++) if (!used.has(n)) free.push(n);
    const pool = free.length ? free : Array.from({ length: VISAGE_COUNT }, (_, k) => k + 1);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    result[i] = pick;
    used.add(pick);
  }

  writePortraits(game.chars.map((ch, i) => ({ visage: result[i], deaths: ch.deaths })));
  return result;
}
