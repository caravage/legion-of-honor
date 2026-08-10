/**
 * Point d'entrée des données. Le JSON n'a pas de type : la conversion se fait
 * ici, une fois, et nulle part ailleurs. `validateCards()` et `validateTables()`
 * la doublent d'un contrôle au démarrage, seul rempart contre une faute de
 * frappe qui rendrait une carte inerte ou une fourchette trouée.
 */
import ranksJson from '../../data/tables/ranks.json';
import fateJson from '../../data/tables/fate-sheet.json';
import seasonsJson from '../../data/tables/seasons.json';
import assignmentsJson from '../../data/tables/assignments.json';
import inGarrisonJson from '../../data/cards/in-garrison.json';
import inGarrisonEventsJson from '../../data/cards/in-garrison-events.json';
import onCampaignJson from '../../data/cards/on-campaign.json';
import onCampaignEventsJson from '../../data/cards/on-campaign-events.json';
import combatJson from '../../data/cards/combat.json';
import duelJson from '../../data/cards/duel.json';
import imagesJson from '../../data/cards/images.json';
import type { CampaignCard, CombatCard, GarrisonCard } from './cards';
import type { DuelData } from './duel';
import type { AssignmentRow, LohLevel, Rank, Season, WoundRow } from './tables';

/** Le seul endroit du projet où l'on affirme la forme du JSON. */
const asShape = <T>(json: unknown) => json as T;

// On extrait la branche utile sans garder l'objet qui l'entoure : ce que rien
// ne retient, l'empaqueteur l'écarte du bundle.
const { images: CARD_IMAGES, numbers: CARD_NUMBERS, duel: DUEL_ART } =
  asShape<{
    images: Record<string, string>;
    numbers: Record<string, number>;
    duel: {
      back: string;
      cards: { type: string; natural: 'kill' | 'wound' | null; file: string }[];
    };
  }>(imagesJson);

/**
 * Racine des fichiers publics. Un chemin absolu casserait dès que le jeu est
 * servi ailleurs qu'à la racine d'un domaine — ce qui est le cas de la plupart
 * des hébergements de pages. Vite tient cette valeur pour nous ; hors navigateur
 * (simulations sous Node) elle n'existe pas, d'où le repli.
 */
const BASE = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** Chemin de l'image d'une carte, ou null si elle n'en a pas. */
export function cardImage(id: string): string | null {
  return CARD_IMAGES[id] ? BASE + CARD_IMAGES[id] : null;
}

/** Chemin d'un fichier de `public/`, valable quelle que soit la racine du site. */
export function publicPath(rel: string): string {
  return BASE + rel;
}

/** Dos du deck de duel — le seul visible côté adversaire. */
export function duelBack(): string { return publicPath(DUEL_ART.back); }

/**
 * Les faces du deck de duel, par type. Une carte se pointe en la retournant :
 * `natural` dit ce qui se lit en bas de la carte telle qu'elle est scannée, si
 * bien que la montrer dans l'autre intention demande une rotation de 180°.
 */
export function duelArt(type: string): { file: string; natural: 'kill' | 'wound' | null }[] {
  return DUEL_ART.cards.filter((c) => c.type === type).map((c) => ({
    file: publicPath(c.file), natural: c.natural,
  }));
}

/** Numéro imprimé sur l'écusson de la carte. */
export function cardNumber(id: string): number | null {
  return CARD_NUMBERS[id] ?? null;
}

export const RANKS = asShape<{ ranks: Rank[] }>(ranksJson).ranks;
export const LOH_LEVELS = asShape<{ legionOfHonor: { levels: LohLevel[] } }>(ranksJson).legionOfHonor.levels;
export const WOUND_TABLE = asShape<{ woundTable: { rows: WoundRow[] } }>(fateJson).woundTable.rows;
export const SEASONS = asShape<{ seasons: Season[] }>(seasonsJson).seasons;
export const ROUND_ENDS_ROUNDS = asShape<{ roundEndsCardRounds: string[] }>(seasonsJson).roundEndsCardRounds;
export const ASSIGNMENTS = asShape<{ bySeason: Record<string, AssignmentRow[]> }>(assignmentsJson).bySeason;
export const COMBAT_CARDS = asShape<{ cards: CombatCard[] }>(combatJson).cards;
export const DUEL = asShape<DuelData>(duelJson);

export const GARRISON_CARDS = asShape<{ cards: GarrisonCard[] }>(inGarrisonJson).cards;
export const IDLE_TIME_CARDS = asShape<{ idleTime: GarrisonCard[] }>(inGarrisonJson).idleTime;
export const GARRISON_EVENTS = asShape<{ cards: GarrisonCard[] }>(inGarrisonEventsJson).cards;
export const CAMPAIGN_CARDS = asShape<{ cards: CampaignCard[] }>(onCampaignJson).cards;
export const CAMPAIGN_EVENTS = asShape<{ cards: CampaignCard[] }>(onCampaignEventsJson).cards;

/** Saison (1..16) -> clé de l'Assignment Sheet */
export function assignmentKey(season: number): string {
  const map: Record<number, string> = {
    1: 'I', 2: 'II-III', 3: 'II-III', 4: 'IV', 5: 'V', 6: 'VI-VII', 7: 'VI-VII',
    8: 'VIII', 9: 'IX', 10: 'X', 11: 'XI-XII', 12: 'XI-XII', 13: 'XIII', 14: 'XIV', 15: 'XV', 16: 'XVI',
  };
  return map[season];
}

export function assignmentFor(season: number, roll: number): AssignmentRow {
  const rows = ASSIGNMENTS[assignmentKey(season)];
  return rows.find((r) => roll >= r.range[0] && roll <= r.range[1]) ?? rows[rows.length - 1];
}

/** Commandements disponibles pour une saison, sans doublon, dans l'ordre de la fiche. */
export function commandsForSeason(season: number): string[] {
  const rows = ASSIGNMENTS[assignmentKey(season)] ?? [];
  return rows.map((r) => r.cmd);
}

export function commandName(cmd: string): string {
  const names: Record<string, string> = {
    'army-north': "Armée du Nord", 'army-center': "Armée du Centre", 'army-rhine': "Armée du Rhin",
    'army-italy': "Armée d'Italie", 'army-reserve': 'Armée de Réserve', 'army-sambre-meuse': 'Armée de Sambre-et-Meuse',
    'army-rhine-moselle': 'Armée de Rhin-et-Moselle', 'army-helvetia': "Armée d'Helvétie", 'army-orient': "Armée d'Orient",
    'corps-reserve': 'Corps de Réserve', 'imperial-guard': 'Garde Impériale',
    'army-andalusia': "Armée d'Andalousie", 'army-castille': 'Armée de Castille',
    'army-portugal': 'Armée du Portugal', 'army-catalonia': 'Armée de Catalogne',
  };
  if (names[cmd]) return names[cmd];
  const m = cmd.match(/^corps-(\d+)$/);
  if (m) {
    const romans = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI'];
    return `${romans[Number(m[1])] ?? m[1]} Corps`;
  }
  return cmd;
}

/** Les 21 cartes Combat, doublons résolus (sameAs) en cartes autonomes. */
export function expandedCombatCards(): CombatCard[] {
  return COMBAT_CARDS.map((c) => {
    if (!c.sameAs) return c;
    const src = COMBAT_CARDS.find((x) => x.id === c.sameAs)!;
    return { ...src, id: c.id, num: c.num, name: c.name, sameAs: undefined };
  });
}

/** 'carry-the-day-2' -> 'carry-the-day' */
export function combatBaseId(id: string): string {
  return id.replace(/-\d+$/, '');
}

/** Retrouve une carte par (kind, id) — pour reconstruire un deck sauvegardé. */
export function cardById(kind: string, id: string): GarrisonCard | CampaignCard | CombatCard | null {
  switch (kind) {
    case 'garrison-event': return GARRISON_EVENTS.find((c) => c.id === id) ?? null;
    case 'campaign-event': return CAMPAIGN_EVENTS.find((c) => c.id === id) ?? null;
    case 'campaign': return CAMPAIGN_CARDS.find((c) => c.id === id) ?? null;
    case 'combat': return expandedCombatCards().find((c) => c.id === id) ?? null;
    case 'garrison': {
      if (id.startsWith('idle-time')) {
        const c = IDLE_TIME_CARDS.find((x) => x.id === id);
        return c ? { ...c, name: 'Idle Time', idleTime: true } : null;
      }
      return GARRISON_CARDS.find((c) => c.id === id) ?? null;
    }
    default: return null;
  }
}

export function findWoundRow(roll: number): WoundRow {
  return WOUND_TABLE.find((r) => roll >= r.range[0] && roll <= r.range[1]) ?? WOUND_TABLE[WOUND_TABLE.length - 1];
}
