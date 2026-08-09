export type RankCategory = 'line' | 'field' | 'general';
export type NobleTitle = null | 'comte' | 'duc' | 'prince';

export type AbsenceType =
  | 'furlough'
  | 'convalescence'
  | 'retirement'
  | 'death'
  | 'prisoner'
  | 'bonapartist-wait'
  | 'royalist-retired';

export interface Absence {
  type: AbsenceType;
  /** convalescence : multiplicateur du type de blessure (x3/x5/x8) */
  convMult?: number;
  /** rounds complets passés en convalescence */
  convRounds?: number;
  /** prisonnier aussi en convalescence */
  alsoConvalescing?: boolean;
  /** retraite volontaire prise dans le segment en cours : pas de retour cette saison */
  fresh?: boolean;
}

export interface CharacterFlags {
  regicide?: boolean;
  royalist38?: boolean;
  /** a déclaré Bonapartiste à l'Abdication (carte 38) — condition du titre à Waterloo */
  bonapartist38?: boolean;
  bonapartist?: boolean;
  marchedOnParis?: boolean;
  turncoat?: boolean;
  /** le Maréchalat existe (Création à la carte 31) */
  marshalate?: boolean;
  onStaff?: boolean;
  /**
   * Index du Grognard envers qui celui-ci est partie lésée : calomnie, dette
   * violée, disgrâce infligée. Seule une partie lésée peut porter un défi.
   */
  grievanceAgainst?: number;
  skipNextCard?: boolean;
  /** Raison pour laquelle la prochaine carte non-event est sans effet (vérole, prison…) */
  skipReason?: string;
  cannotSeekOffice?: boolean;
}

export interface Character {
  name: string;
  /** Grognard mené par la machine */
  bot?: boolean;
  /** Tempérament caché du concurrent */
  persona?: string;
  rankIdx: number; // index dans ranks.json (0 = sergent)
  marechal: boolean;
  assignment: string;
  standing: number; // -4..+5 ; figé à 0 (chapeau) pour général+
  N: number;
  G: number;
  E: number;
  mParis: number;
  mPurse: number;
  H: number;
  C: number;
  F: number;
  loh: number; // 0..5
  armsOfHonor: boolean; // true tant que Grand Review (VI-4) n'a pas eu lieu
  title: NobleTitle;
  office: boolean;
  absent: Absence | null;
  flags: CharacterFlags;
  deaths: number;
  nonDuelWounds: number;
}

/** 'ask' annonce un jet à venir et ce qu'il faut obtenir : la révélation s'y arrête. */
export type LogClass = 'phase' | 'card' | 'roll' | 'ask' | 'gain' | 'loss' | 'warn' | 'title' | 'info';

export interface LogEntry {
  t: string;
  cls: LogClass;
  /** Carte à l'origine de l'entrée : sert à afficher sa vignette dans le journal. */
  cardId?: string;
  /** Index du Grognard concerné : l'affichage en fait un bandeau, non une ligne. */
  actor?: number;
  /** Détail d'un calcul, montré en second plan derrière son résultat. */
  detail?: string;
}

export interface PendingOption {
  label: string;
  run: () => void;
}

export interface Pending {
  title: string;
  options: PendingOption[];
  /** Rendu particulier : dos de carte à retourner, curseur d’argent… */
  kind?: 'draw-combat' | 'money';
  /** Pour le curseur d’argent : applique un transfert signé puis l’impôt. */
  apply?: (amount: number) => void;
  data?: any;
}

/**
 * État d'une étape dans la séquence de jeu affichée :
 * done = déjà résolue · current = en cours · todo = à venir
 * na = ne s'applique pas (règle optionnelle inactive) · missing = pas encore implémentée
 */
export type StepState = 'done' | 'current' | 'todo' | 'na' | 'missing';

export interface PhaseStep {
  id: string;
  label: string;
  state: StepState;
  note?: string;
}

export interface Progress {
  /** Segment de saison, round de garnison ou round de campagne */
  blockLabel: string;
  blockKind: 'setup' | 'segment' | 'in-garrison' | 'on-campaign' | 'end';
  roundCode: string | null;
  roundNum: number;
  roundTotal: number;
  cardNum: number;
  cardTotal: number;
  steps: PhaseStep[];
}
