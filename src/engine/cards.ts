/**
 * Forme des données de cartes.
 *
 * Les fichiers JSON étaient jusqu'ici manipulés en `any` : une faute de frappe
 * dans un nom de champ — `noCombatcard` pour `noCombatCard` — produisait une
 * carte silencieusement inerte, sans la moindre erreur de compilation. Ces types
 * ferment cette porte, et `validateCards()` la verrouille au démarrage.
 */

/** Un gain s'écrit en clair (`4`) ou en dés (`+1D10x3`, `-1D10/2down`, `100-1D10`). */
export type Amount = number | string;

/** Les trois catégories de grade auxquelles les cartes donnent des valeurs distinctes. */
export type RankCat = 'line' | 'field' | 'general';

/** Effets d'une carte sur les pistes du Grognard. */
export interface Effects {
  N?: Amount; G?: Amount; E?: Amount; M?: Amount; MParis?: Amount;
  H?: Amount; C?: Amount; F?: Amount; S?: Amount;
  /** Pourcentage de blessure et de capture. */
  W?: number; P?: number;
  /** Intitulé de l'action, affiché au joueur. */
  label?: string;
  /** Expérience gagnée si la tâche est menée avec zèle. */
  zeal?: number;
}

export interface RollTable {
  die?: '1D10' | '2D10';
  results: Record<string, string | Effects>;
}

export interface CardBase {
  id: string;
  name: string;
  num?: number | string | null;
  copies?: number;
  /** Écartée du jeu solo, avec sa raison. */
  soloPlayable?: false;
  soloNote?: string;
  requiresFairSex?: boolean;
  optionalRule?: 'spain' | 'fairSex';
  etienneGerard?: boolean;
  multiplayer?: boolean;
  verify?: boolean;
  numVerify?: boolean;
  note?: string;
  /** Texte libre affiché faute de traitement particulier. */
  effect?: string;
  special?: string;
}

export interface CampaignSubEvent {
  name?: string;
  /** Identifiant propre ; à défaut, celui de la carte qui le porte. */
  id?: string;
  commands?: string[];
  condition?: string;
  excluded?: string[];
  noCombatCard?: boolean;
  noPrisoner?: boolean;
  noPrisonerOnCombatCard?: boolean;
  noArmsOfHonor?: boolean;
  armsOfHonor?: boolean;
  legionOfHonor?: boolean;
  oneCombatCard?: boolean;
  oneEvent?: boolean;
  drawingGrognardOnly?: boolean;
  choice?: boolean;
  values?: Partial<Record<RankCat | 'any', Effects>>;
  wwt?: boolean | { restrictedTo?: string };
  special?: string;
  note?: string;
  verify?: boolean;
  carryTheDayBonus?: string;
}

export interface GarrisonCard extends CardBase {
  effects?: Effects;
  perRank?: Partial<Record<RankCat, Effects>>;
  roll?: RollTable;
  zeal?: number;
  idleTime?: boolean;
  actions?: Effects[];
  removeAfterRound?: string;
  appliesEvenIfAbsent?: boolean;
  choice?: unknown;
  subEvents?: CampaignSubEvent[];
  wwt?: boolean | { restrictedTo?: string; sameOption?: boolean };
  round?: string;
  condition?: string;
  option?: string;
  insufficientFunds?: { ifTotalMBelow: number; instead: unknown };
  meetALady?: boolean;
  loyalty?: unknown;
  order?: string;
  after?: string;
  unlocks?: string[];
}

/** Une carte de campagne porte les mêmes champs qu'un sous-évènement, plus les siens. */
export interface CampaignCard extends CardBase, Omit<CampaignSubEvent, 'name' | 'id'> {
  subEvents?: CampaignSubEvent[];
  zeal?: number;
  idleTime?: boolean;
  effects?: Effects;
  /** Ce qu'il advient si le Grognard décline la proposition. */
  decline?: Effects & { loseTurn?: boolean };
  roll?: RollTable;
  appliesEvenIfPrisoner?: boolean;
  perRank?: Partial<Record<RankCat, Effects>>;
  spainSubstitute?: boolean;
  round?: string;
}

/**
 * Un côté de carte Combat, pour une catégorie de grade. À la différence des
 * autres cartes, ses valeurs sont toujours chiffrées : aucun jet de dé ici.
 */
export interface CombatSide {
  N?: number; G?: number; E?: number; M?: number;
  /** Pourcentage de blessure et de capture. */
  W?: number; P?: number;
  /** Intitulé de l'acte de gloire et de l'acte de discrétion. */
  glory?: string;
  discretion?: string;
  /** Seuil du 2D10 en dessous duquel la discrétion déshonore. */
  disgrace?: number;
}

export interface CombatCard extends CardBase {
  line?: CombatSide;
  field?: CombatSide;
  general?: CombatSide;
  sameAs?: string;
  title?: boolean;
  plundered?: boolean;
  noChoice?: boolean;
  noDisgrace?: boolean;
  noComrades?: boolean;
}

/** Champs reconnus, par famille : tout le reste est une faute de frappe. */
const KNOWN = {
  common: [
    'id', 'name', 'num', 'copies', 'soloPlayable', 'soloNote', 'requiresFairSex',
    'optionalRule', 'etienneGerard', 'multiplayer', 'verify', 'numVerify', 'note',
    'effect', 'special', 'round', 'condition',
  ],
  garrison: [
    'effects', 'perRank', 'roll', 'zeal', 'idleTime', 'actions', 'removeAfterRound',
    'appliesEvenIfAbsent', 'choice', 'subEvents', 'wwt', 'option', 'insufficientFunds',
    'meetALady', 'loyalty', 'order', 'after', 'unlocks', 'inPlay', 'decline',
  ],
  campaign: [
    'commands', 'excluded', 'noCombatCard', 'noPrisoner', 'noPrisonerOnCombatCard',
    'noArmsOfHonor', 'armsOfHonor', 'legionOfHonor', 'oneCombatCard', 'oneEvent',
    'drawingGrognardOnly', 'choice', 'values', 'wwt', 'subEvents', 'perRank',
    'spainSubstitute', 'carryTheDayBonus', 'effects', 'decline', 'roll',
    'appliesEvenIfPrisoner',
  ],
  combat: ['line', 'field', 'general', 'sameAs', 'title', 'plundered', 'noChoice', 'noDisgrace', 'noComrades'],
};

/**
 * Contrôle au démarrage que les données ne contiennent aucun champ inconnu et
 * qu'aucun identifiant n'est en double. Renvoie la liste des anomalies.
 */
export function validateCards(sets: {
  garrison: unknown[]; garrisonEvents: unknown[]; idleTime: unknown[];
  campaign: unknown[]; campaignEvents: unknown[]; combat: unknown[];
}): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();

  const check = (list: unknown[], family: 'garrison' | 'campaign' | 'combat', where: string) => {
    const allowed = new Set([...KNOWN.common, ...KNOWN[family]]);
    for (const raw of list) {
      const c = raw as Record<string, unknown>;
      if (typeof c.id !== 'string' || !c.id) { problems.push(`${where} : carte sans identifiant`); continue; }
      if (seen.has(c.id)) problems.push(`${where} : identifiant en double « ${c.id} »`);
      seen.add(c.id);
      if (typeof c.name !== 'string' && where !== 'idle-time') {
        problems.push(`${where} : « ${c.id} » sans nom`);
      }
      for (const k of Object.keys(c)) {
        if (!allowed.has(k)) problems.push(`${where} : « ${c.id} » porte un champ inconnu « ${k} »`);
      }
    }
  };

  check(sets.garrison, 'garrison', 'in-garrison');
  check(sets.garrisonEvents, 'garrison', 'in-garrison-events');
  check(sets.idleTime, 'garrison', 'idle-time');
  check(sets.campaign, 'campaign', 'on-campaign');
  check(sets.campaignEvents, 'campaign', 'on-campaign-events');
  check(sets.combat, 'combat', 'combat');
  return problems;
}
