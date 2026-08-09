/**
 * Rédaction du récit de fin de saison.
 *
 * Fonction pure : elle lit ce que le journal a retenu de la saison et l'état du
 * Grognard avant et après, et rend un paragraphe. Rien d'autre du moteur ne la
 * concerne, d'où sa sortie du fichier principal.
 */
import { Character, LogEntry } from './types';

export interface Chronicle {
  season: number;
  roman: string;
  name: string;
  years: string;
  text: string;
}

export interface ChronicleInput {
  season: number;
  def: { roman: string; name: string; years: string };
  /** Entrées du journal écrites pendant la saison. */
  lines: LogEntry[];
  /** Le Grognard au début de la saison, pour mesurer le chemin parcouru. */
  before: Character | null;
  /** Le Grognard tel qu'il en sort. */
  ch: Character;
}

  export function writeChronicle(ctx: ChronicleInput): Chronicle {
    const def = ctx.def;
    const before = ctx.before;
    const ch = ctx.ch;
    const lines = ctx.lines;
    const has = (re: RegExp) => lines.some((e) => re.test(e.t));
    const all = (re: RegExp) => lines.filter((e) => re.test(e.t)).map((e) => e.t);
    const s: string[] = [];

    const battles = all(/^⚔ /).map((t) => t.replace(/^⚔ /, ''));
    if (battles.length === 1) s.push(`Il s’est battu à ${battles[0]}.`);
    else if (battles.length > 1) {
      s.push(`Quatre saisons en une : ${battles.slice(0, -1).join(', ')} puis ${battles[battles.length - 1]}.`
        .replace('Quatre saisons en une : ', 'Il a vu le feu à '));
    } else if (!ch.absent) s.push('Aucune bataille : l’année s’est passée en garnison.');

    const promos = all(/^⭐ Promotion : /).map((t) => t.replace(/^⭐ Promotion : /, '').replace(/ \(.*\)$/, ''));
    if (promos.length) s.push(`Il est passé ${promos.join(', puis ')}.`);

    if (has(/Légion d’Honneur : /)) {
      const lvl = all(/Légion d’Honneur : /).pop()!.replace(/.*: /, '').replace(' !', '');
      s.push(`La croix lui a été remise : le voilà ${lvl}.`);
    } else if (has(/Arms of Honor/)) s.push('Il a reçu une arme d’honneur, en attendant mieux.');

    if (has(/👑 /)) s.push(all(/👑 /).pop()!.replace('👑 ', ''));
    if (has(/🦅 /)) s.push('Il a été admis dans la Garde Impériale.');
    if (has(/🏛 /)) s.push('Une sinécure est venue arrondir ses revenus.');

    if (has(/☠ Mort/)) s.push('Il est tombé au champ d’honneur.');
    else if (has(/Wound Table|— touché !/)) {
      const w = all(/2D10=\d+ → (Tué|Gravement|Sévèrement|Mal|Blessure superficielle|Une égratignure)/).length;
      s.push(w > 1 ? `Il a été touché ${w} fois.` : 'Il a été touché une fois.');
    }
    if (has(/Prisonnier ! |capturé !/)) s.push('Il a connu la captivité.');
    if (has(/Convalescence/)) s.push('Une partie de l’année s’est passée à l’hôpital.');
    if (has(/permission/i) && has(/Partir en permission/)) s.push('Il a pris une permission.');
    if (has(/est dissous/)) s.push('Son commandement a été dissous dans une réorganisation.');
    if (has(/déshonoré/)) s.push('Sa prudence sous le feu ne lui a pas fait honneur.');
    if (has(/Découvert !/)) s.push('Ses malversations ont éclaté au grand jour.');

    if (before) {
      const dG = ch.G - before.G;
      const dM = ch.mParis + ch.mPurse - (before.mParis + before.mPurse);
      const bits: string[] = [];
      if (dG > 0) bits.push(`${dG} de gloire`);
      if (dM > 0) bits.push(`${dM} francs`);
      else if (dM < 0) bits.push(`${-dM} francs de moins`);
      if (bits.length) s.push(`Bilan de l’année : ${bits.join(', ')}.`);
      if (ch.H <= before.H - 12) s.push(`Sa santé décline (${before.H} → ${ch.H}).`);
    }

    return {
      season: ctx.season,
      roman: def.roman,
      name: def.name,
      years: def.years,
      text: s.join(' ') || 'Une année sans relief.',
    };
}
