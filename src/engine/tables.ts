/**
 * Forme des tables du jeu : grades, saisons, affectations, blessures.
 *
 * Ces données changent rarement, mais elles sont lues partout — une faute de
 * frappe sur `promotion.G` passait jusqu'ici inaperçue et rendait une promotion
 * impossible sans le moindre signe.
 */
import type { RankCat } from './cards';

export interface Rank {
  id: string;
  name: string;
  category: RankCat;
  /** Solde perçu à chaque Income Phase. */
  income: number;
  /** Minimums de notice, gloire et expérience ; nul pour le maréchalat. */
  promotion: { N: number; G: number; E: number } | null;
  note?: string;
  verify?: boolean;
}

export interface LohLevel {
  id: string;
  level: number;
  /** Gloire perçue à chaque Glory Phase. */
  glory: number;
  /** Francs perçus à chaque Income Phase. */
  income: number;
}

export interface WoundRow {
  range: [number, number];
  type: 'killed' | 'gravely' | 'severely' | 'badly' | 'flesh' | 'scratch';
  effects: Record<string, number | string> | null;
  /** Fourchette du 2D10 qui envoie en captivité après un Unit Overrun. */
  overrunPrisoner?: [number, number];
  /** Multiplicateur des rounds passés en convalescence. */
  convalescenceMultiplier?: number;
  note?: string;
}

export interface Season {
  num: number;
  roman: string;
  name: string;
  years: string;
  /** Codes des rounds, dans l'ordre : chiffre pour la garnison, lettre pour la campagne. */
  rounds: string[];
  /** Cartes d'évènement de chaque round. */
  events: Record<string, string[]>;
  noSegment?: boolean;
  notes?: string[];
}

export interface AssignmentRow {
  cmd: string;
  /** Fourchette du 2D10 qui y conduit. */
  range: [number, number];
  /** Dissous à la fin de la saison. */
  dissolved?: boolean;
  /** Dissous à la fin de la saison nommée. */
  dissolvedIn?: string;
  /** Devient ce commandement à la saison suivante. */
  becomes?: string;
  /** Solde multiplié (Garde Impériale). */
  payMultiplier?: number;
  note?: string;
  prisonerNote?: string;
}

/**
 * Contrôle les tables au démarrage, comme `validateCards()` le fait pour les
 * cartes. Elles se lisent partout et ne se relisent jamais : une fourchette qui
 * laisse un trou envoie le Grognard dans la dernière ligne de la table sans
 * qu'aucune erreur ne le signale, et un `promotion.G` mal orthographié rend une
 * promotion inatteignable en silence.
 */
export function validateTables(t: {
  ranks: Rank[];
  lohLevels: LohLevel[];
  wounds: WoundRow[];
  seasons: Season[];
  assignments: Record<string, AssignmentRow[]>;
}): string[] {
  const p: string[] = [];
  const cats = new Set(['line', 'field', 'general']);
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

  t.ranks.forEach((r, i) => {
    const w = `grade ${r.id ?? `#${i}`}`;
    if (!r.id || !r.name) p.push(`${w} : identifiant ou nom manquant`);
    if (!cats.has(r.category)) p.push(`${w} : catégorie inconnue « ${r.category} »`);
    if (!num(r.income)) p.push(`${w} : solde non chiffré`);
    if (r.promotion !== null) {
      for (const k of ['N', 'G', 'E'] as const) {
        if (!num(r.promotion?.[k])) p.push(`${w} : seuil de promotion ${k} absent ou non chiffré`);
      }
    }
  });

  t.lohLevels.forEach((l, i) => {
    if (!num(l.level) || !num(l.glory) || !num(l.income)) {
      p.push(`Légion d’Honneur, niveau #${i} : valeur non chiffrée`);
    }
  });

  /** Une table de 2D10 doit couvrir 1 à 100 sans trou ni chevauchement (d100 rend 1..100). */
  const cover = (rows: { range: [number, number] }[], what: string) => {
    const sorted = [...rows].sort((a, b) => a.range[0] - b.range[0]);
    let expect = 1;
    for (const r of sorted) {
      if (!Array.isArray(r.range) || r.range.length !== 2 || !num(r.range[0]) || !num(r.range[1])) {
        p.push(`${what} : fourchette mal formée`);
        return;
      }
      if (r.range[0] > expect) p.push(`${what} : trou de ${expect} à ${r.range[0] - 1}`);
      if (r.range[0] < expect) p.push(`${what} : chevauchement à ${r.range[0]}`);
      expect = r.range[1] + 1;
    }
    if (expect !== 101) p.push(`${what} : la table s’arrête à ${expect - 1} au lieu de 100`);
  };

  const woundTypes = new Set(['killed', 'gravely', 'severely', 'badly', 'flesh', 'scratch']);
  for (const w of t.wounds) {
    if (!woundTypes.has(w.type)) p.push(`blessures : type inconnu « ${w.type} »`);
  }
  cover(t.wounds, 'table des blessures');

  const seen = new Set<string>();
  t.seasons.forEach((s, i) => {
    const w = `saison ${s.roman ?? `#${i + 1}`}`;
    if (s.num !== i + 1) p.push(`${w} : numérotée ${s.num} à la position ${i + 1}`);
    if (!s.roman || !s.name || !s.years) p.push(`${w} : intitulé incomplet`);
    if (!Array.isArray(s.rounds) || !s.rounds.length) p.push(`${w} : aucun round`);
    for (const code of Object.keys(s.events ?? {})) {
      if (!s.rounds.includes(code)) p.push(`${w} : évènements pour le round inconnu « ${code} »`);
    }
    for (const code of s.rounds ?? []) {
      if (seen.has(code)) p.push(`round « ${code} » déclaré deux fois`);
      seen.add(code);
    }
  });

  for (const [key, rows] of Object.entries(t.assignments)) {
    if (!rows.length) { p.push(`affectations ${key} : table vide`); continue; }
    for (const r of rows) if (!r.cmd) p.push(`affectations ${key} : ligne sans commandement`);
    cover(rows, `affectations ${key}`);
  }
  return p;
}
