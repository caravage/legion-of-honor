import namesJson from '../../data/tables/names.json';
import { d6, RNG, defaultRng } from './dice';

type Table = Record<string, string>;
const GIVEN = (namesJson as any).given as Table;
const SECOND = (namesJson as any).second as Table;
const THIRD = (namesJson as any).third as Table;
const SURNAME = (namesJson as any).surname as Table;

export interface NameRoll {
  /** Détail lisible de chaque jet, pour le journal */
  steps: string[];
  given: string;
  middles: string[];
  surname: string;
  full: string;
}

/**
 * Nouveau porteur du même nom : un fils ou un neveu reprend le flambeau.
 * Seuls les prénoms sont retirés, le patronyme demeure.
 */
export function heirOf(fullName: string, rng: RNG = defaultRng): NameRoll {
  const surname = fullName.trim().split(/\s+/).pop() ?? '';
  const n = generateName(rng);
  const middles = n.middles;
  const full = [n.given, ...middles, surname].join(' ');
  return {
    steps: n.steps.filter((s) => !s.startsWith('Nom de famille')),
    given: n.given,
    middles,
    surname,
    full,
  };
}

/** Tire un couple 1d6+1d6 et renvoie [clé, texte du jet]. */
function pair(rng: RNG): [string, string] {
  const a = d6(rng);
  const b = d6(rng);
  return [`${a}-${b}`, `${a}-${b}`];
}

/**
 * Génère un nom selon le Grognard Name Generator.
 * Prénom 1d6+1d6 ; nombre de seconds prénoms 2d6 (2-6 aucun, 7-9 un, 10-12 deux) ;
 * les doublons sont relancés ; patronyme 1d6+1d6.
 */
export function generateName(rng: RNG = defaultRng): NameRoll {
  const steps: string[] = [];

  const [gk, gt] = pair(rng);
  const given = GIVEN[gk];
  steps.push(`Prénom : 1d6+1d6 = ${gt} → ${given}`);

  const c1 = d6(rng);
  const c2 = d6(rng);
  const sum = c1 + c2;
  const count = sum <= 6 ? 0 : sum <= 9 ? 1 : 2;
  steps.push(
    `Seconds prénoms : 2d6 = ${c1}+${c2} = ${sum} → ${count === 0 ? 'aucun' : count === 1 ? 'un' : 'deux'}`,
  );

  const middles: string[] = [];
  const tables = [SECOND, THIRD];
  for (let i = 0; i < count; i++) {
    const table = tables[i];
    let name = '';
    let guard = 0;
    let text = '';
    do {
      const [k, t] = pair(rng);
      name = table[k];
      text = t;
    } while ((name === given || middles.includes(name)) && guard++ < 40);
    middles.push(name);
    steps.push(`${i === 0 ? 'Deuxième' : 'Troisième'} prénom : 1d6+1d6 = ${text} → ${name}`);
  }

  const [sk, st] = pair(rng);
  const surname = SURNAME[sk];
  steps.push(`Nom de famille : 1d6+1d6 = ${st} → ${surname}`);

  const full = [given, ...middles, surname].join(' ');
  return { steps, given, middles, surname, full };
}
