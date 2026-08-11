import { d10, d100, rollExpr, RNG, defaultRng } from './dice';
import {
  RANKS, LOH_LEVELS, SEASONS, ROUND_ENDS_ROUNDS, GARRISON_CARDS, IDLE_TIME_CARDS,
  GARRISON_EVENTS, CAMPAIGN_CARDS, CAMPAIGN_EVENTS, ASSIGNMENTS, assignmentFor, assignmentKey,
  cardById, combatBaseId, commandName, commandsForSeason, expandedCombatCards,
  findWoundRow, DUEL,
} from './data';
import { generateName, heirOf } from './names';
import type { CampaignCard, CampaignSubEvent, CombatCard, CombatSide, Effects, GarrisonCard, RankCat, RollTable } from './cards';
import type { Rank, Season, WoundRow } from './tables';
import {
  SwordDuel, pistolHits, pistolOrder, other, SWORD_LABEL,
  type Aim, type Duelist, type Side, type SwordOutcome, type SwordSetup,
} from './duel';
import { acceptsDuel, botChoice, botMoneyTransfer, botTarget, burgerWeapon, duelChoice, PERSONAS } from './policy';
import { Chronicle, writeChronicle } from './chronicle';
import { clearSave, hasSave, readSave, writeSave } from './storage';
import { Character, LogEntry, LogClass, Pending, PendingOption, PhaseStep, Progress, StepState } from './types';

export type AnyCard = GarrisonCard | CampaignCard | CombatCard;

/**
 * Une entrée de deck : le type de carte se déduit de la provenance, ce qui
 * dispense de vérifier à la main ce qu'on manipule.
 */
export type DeckEntry =
  | { kind: 'garrison' | 'garrison-event'; card: GarrisonCard }
  | { kind: 'campaign' | 'campaign-event'; card: CampaignCard }
  | { kind: 'combat'; card: CombatCard };

/**
 * Ce qu'un duel doit savoir en plus de ses cartes : comment le journal
 * l'appelle, quels résultats s'appliquent, et ce qu'il faut faire ensuite.
 */
export interface DuelTerms {
  /** Intitulé au journal — « Duel au sabre », « Le Burger sur le pré ». */
  label: string;
  /** Le F+1 des résultats ne récompense que le fer. */
  weapon: 'sword' | 'pistol';
  /**
   * Résultats communs de la planche : S−3, G+3, E+1 aux deux duellistes,
   * G+3 au vainqueur indemne, G+3 N−3 au tueur, F+1 pour un duel à l'épée.
   * Une carte qui dicte ses propres gains les remplace tous.
   */
  standard: boolean;
  /** Gains propres à la carte, pour celui qui l'a tirée. */
  drawerEffects?: Effects;
  /** Le vainqueur peut renoncer à frapper : G+5. Jamais contre une carte. */
  magnanimity?: boolean;
  /** Suite à donner une fois le pré quitté, avec la blessure portée s'il y en eut. */
  then?: (o: SwordOutcome | null, blessure?: WoundRow) => void;
}

type DuelRun = {
  sword: SwordDuel | null;
  terms: DuelTerms;
  a: Duelist;
  b: Duelist;
  /** Grognard actif avant le duel : on lui rend la main à la fin. */
  returnTo: number;
  /**
   * Le duel est un bloc : ses échanges vivent dans sa propre fenêtre et non
   * dans la chronique, qui n'en recevra qu'une ligne à la fermeture.
   */
  journal: string[];
  /** Feuilles au moment de dégainer, pour dire ce que l'affaire a coûté. */
  before: Record<number, Character>;
  /** Coup porté, en attente du jet de blessure que le joueur doit lancer. */
  wound?: { loser: Duelist; winner: Duelist; aim: Aim } | null;
  /** Le jet une fois tombé : deux faces de d10, et ce qu'elles donnent. */
  roll?: { faces: [number, number]; bonus: number; total: number; result: string } | null;
  /** Décompte final, affiché dans la fenêtre avant de la refermer. */
  summary?: string | null;
};

/** Gravité comparée d'une blessure, pour retenir la pire de deux balles. */
const GRAVITE: Record<string, number> = {
  scratch: 1, flesh: 2, badly: 3, severely: 4, gravely: 5, killed: 6,
};

type Stage =
  | 'setup' | 'segment' | 'round-start' | 'draw' | 'round-over' | 'season-end' | 'game-over';

export type SetupMode = 'quick' | 'guided';

/** Étapes de la mise en place détaillée (booklet, Setup — Campaign Scenario). */
const NAME_STEP = { id: 'name', label: 'Nom', expr: '1d6+1d6' };
const SETUP_STEPS: { id: string; label: string; expr: string }[] = [
  { id: 'assignment', label: 'Affectation', expr: '2D10' },
  { id: 'rank', label: 'Grade', expr: '1D10' },
  { id: 'N', label: 'Notice de Napoléon', expr: '1D10÷4↓' },
  { id: 'G', label: 'Gloire', expr: '1D10' },
  { id: 'E', label: 'Expérience', expr: '1D10÷2↑' },
  { id: 'mParis', label: 'Francs à Paris', expr: '2D10÷4↓' },
  { id: 'mPurse', label: 'Francs en bourse', expr: '1D10' },
  { id: 'H', label: 'Santé', expr: '100−1D10' },
  { id: 'C', label: 'Charme', expr: '1D10' },
  { id: 'F', label: 'Escrime', expr: '1D10÷3↑' },
];

const SEGMENT_PHASES = ['money', 'aging', 'assignment', 'glory'] as const;
const SEGMENT_HEADERS: Record<(typeof SEGMENT_PHASES)[number], string> = {
  money: 'Money Transfer & Tax Phase',
  aging: 'Aging Phase',
  assignment: 'Assignment Phase',
  glory: 'Glory Phase',
};
const ROUND_START_PHASES = ['furlough', 'recovery', 'income', 'deck'] as const;

export class Game {
  /** Tous les Grognards de la partie ; le premier est le joueur. */
  chars: Character[] = [];
  /** Index du Grognard dont c'est le tour. */
  active = 0;
  /** Celui dont c'est le tour : il ne bouge pas quand un autre résout un effet. */
  turnHolder = 0;
  get ch(): Character { return this.chars[this.active]; }
  /** Le joueur humain. */
  get me(): Character { return this.chars[0]; }
  /** Ordre de jeu du round : file d'index restant à traiter. */
  turnQueue: number[] = [];
  /** Trace mécanique, activée par le filet de non-régression seulement. */
  traceOn = false;
  trace: string[] = [];
  /** Nombre de tirages et empreinte du flux : ils pincent toute la mécanique. */
  rngDraws = 0;
  rngHash = 0;
  /** Senior Grognard du segment ou du round en cours ; il garde sa place jusqu'au bout. */
  senior = 0;
  rng: RNG;
  season = 1;
  roundIdx = 0;
  stage: Stage = 'round-start';
  sub = 0;
  deck: DeckEntry[] = [];
  eventsRemaining = 0;
  cardNumInRound = 0;
  /** Cartes tirées dans le round par chaque Grognard : le zèle se compte par tête. */
  cardsByPlayer: number[] = [];
  roundEnded = false;
  pending: Pending | null = null;
  log: LogEntry[] = [];
  removed = new Set<string>(); // cartes hors jeu (id)
  /** Cartes retirées jusqu'à la saison suivante seulement (la beuverie). */
  pausedCards = new Set<string>();
  playedEGOnce = new Set<string>();
  over = false;
  cardsPerRound = 3;
  /** Carte en cours de résolution, pour l'affichage */
  currentCard: DeckEntry | null = null;
  /** Carte Combat de la bataille en cours, affichée à côté de la carte d'événement */
  combatCard: DeckEntry | null = null;
  /** Les cartes Combat tirées pour l’évènement en cours, avec leur porteur. */
  battleCards: { card: DeckEntry; who: number }[] = [];
  /** Cartes tirées depuis le début du round, pour consultation */
  drawnThisRound: { id: string; name: string }[] = [];
  /** « We Were There! » : Grognards restant à interroger pour la carte en cours */
  wwtQueue: number[] = [];
  wwtCard: DeckEntry | null = null;
  wwtDrawer = 0;
  /**
   * Vrai quand une interface suit la partie. Le moteur s'en sert pour attendre
   * un geste — lancer les dés d'une blessure — là où une simulation doit
   * résoudre d'un trait. Les bancs d'essai le laissent faux, et retrouvent
   * exactement la mécanique d'avant la fenêtre de duel.
   */
  interactive = false;
  /** Duel en cours : tant qu'il dure, la partie ne tient pas en place. */
  duelRun: DuelRun | null = null;
  /**
   * Duel achevé dont la fenêtre montre encore le décompte. Il est détaché de
   * `duelRun` à dessein : un duel clos ne doit plus rien détourner du journal.
   */
  duelOver: { label: string; journal: string[]; summary: string; roll: DuelRun['roll'] } | null = null;
  /** Batailles restant à résoudre pour la carte en cours */
  battleQueue: { ev: CampaignSubEvent; name: string; who: number }[] = [];
  /** À exécuter quand la file de batailles est vide */
  afterBattles: (() => void) | null = null;
  /** Un Carry the Day tiré à Ligny/Quatre Bras/Wavre permet de repiocher à Waterloo */
  waterlooRedraw = false;
  /** Victory at Mont St. Jean tirée : victoire immortelle */
  victory = false;
  setupMode: SetupMode;
  /** Séquence de mise en place retenue pour cette partie */
  setupPlan: { id: string; label: string; expr: string }[];
  /** Étapes de mise en place déjà résolues (mode guidé), pour l'affichage */
  setupDone: { id: string; label: string; expr: string; text: string }[] = [];

  constructor(name: string, rng: RNG = defaultRng, mode: SetupMode = 'quick', bots = 0) {
    // chaque tirage laisse une empreinte : deux parties identiques la partagent
    this.rng = () => {
      const v = rng();
      this.rngDraws++;
      this.rngHash = (this.rngHash * 31 + Math.floor(v * 1e9)) % 2147483647;
      return v;
    };
    this.setupMode = mode;
    const named = name.trim().length > 0;
    // sans nom fourni, le patronyme est tiré aux dés comme le reste
    this.setupPlan = named ? [...SETUP_STEPS] : [NAME_STEP, ...SETUP_STEPS];
    this.chars = [this.blankCharacter(named ? name.trim() : '')];
    for (let i = 0; i < bots; i++) {
      const b = this.blankCharacter(generateName(rng).full);
      b.bot = true;
      b.persona = PERSONAS[Math.floor(rng() * PERSONAS.length)];
      this.chars.push(b);
    }
    if (named) this.title(`${name.trim()}`, 'Une carrière commence · 1792');
    else this.title('Une carrière commence', '1792');
    if (mode === 'quick') {
      this.rollAllSetup();
      this.beginCampaign();
    } else {
      this.stage = 'setup';
      this.sub = 0;
      this.info('Mise en place détaillée : lancez les dés pour chaque caractéristique.');
    }
    this.save();
  }

  /** Règles optionnelles actives (aucune pour l'instant). */
  fairSex = false;
  spain = false;

  /** Vrai dès qu'un concurrent est en jeu : les cartes qui visent un rival vivent. */
  get multi(): boolean { return this.chars.length > 1; }

  /** Cartes écartées de cette partie, avec la raison. */
  excludedCards(): { name: string; why: string }[] {
    const out: { name: string; why: string }[] = [];
    for (const c of [...GARRISON_CARDS, ...CAMPAIGN_CARDS]) {
      if (c.soloPlayable === false && !this.multi) out.push({ name: c.name, why: c.soloNote ?? 'Injouable en solo' });
      else if (c.requiresFairSex && !this.fairSex) out.push({ name: c.name, why: c.soloNote ?? 'Nécessite The Fair Sex' });
    }
    return out;
  }

  /**
   * Une carte peut-elle figurer dans un deck de cette partie ? Celles qui
   * exigent un rival — courir contre lui, le calomnier, croiser le fer — ne
   * sont écartées qu'en solo : dès qu'un concurrent est en jeu, elles rentrent.
   */
  private cardAllowed(c: AnyCard): boolean {
    if (c.soloPlayable === false && !this.multi) return false;
    if (c.requiresFairSex && !this.fairSex) return false;
    if (c.optionalRule === 'spain' && !this.spain) return false;
    return true;
  }

  private beginCampaign() {
    this.openSeasonChronicle();
    this.title('Saison I', `${SEASONS[0].name} · ${SEASONS[0].years}`);
    this.info('Pas de Campaign Season Segment en saison I.');
    this.stage = 'round-start';
    this.sub = 0;
  }

  // ---------- log ----------
  /**
   * Chaque entrée du journal garde l'état de la feuille au moment où elle est écrite :
   * l'interface peut ainsi n'afficher que ce que le joueur a déjà découvert.
   */
  snaps: Character[][] = [];

  /** Gains d'un concurrent en attente d'être résumés en une ligne. */
  private briefBuf: string[] = [];
  /**
   * À qui appartient ce qui attend. Le tampon ne doit jamais enjamber deux
   * Grognards : sans cela, les gains d'une bataille s'écrivaient sous la carte
   * du suivant, et l'on croyait Reconnaissance responsable d'un butin.
   */
  private briefActor: number | null = null;

  private add(t: string, cls: LogClass, cardId?: string, detail?: string) {
    /**
     * Un duel est un bloc : ses passes, ses jets et son décompte vivent dans
     * sa fenêtre, et la chronique n'en reçoit qu'une ligne à la fermeture.
     * Seuls les faits qui débordent le pré — une mort, une retraite — passent.
     */
    if (this.duelRun && cls !== 'title' && cls !== 'warn' && cls !== 'phase') {
      this.duelRun.journal.push(t);
      return;
    }
    // Un concurrent ne commente pas ses dés : on retient l'essentiel et on le
    // rendra d'un trait. Les faits marquants — promotion, croix, mort — passent.
    // Une carte est sur la table : là, ses dés roulent sur le plateau comme les
    // nôtres — c'est le moment où sa fortune se joue, et cela se regarde.
    if (this.chars.length > 1 && this.ch?.bot) {
      if (cls === 'ask' || cls === 'roll') {
        if (!this.currentCard) return;
        // les gains déjà mis de côté passent devant : l'ordre de lecture tient
        this.flushBrief();
      } else if (cls === 'gain' || cls === 'loss' || cls === 'info') {
        // le tampon change de main : on solde le précédent avant d'ouvrir le sien
        if (this.briefActor !== null && this.briefActor !== this.active) this.flushBrief();
        this.briefActor = this.active;
        // On coupe le détail du calcul — « (1D10=4/2↓=2) » —, jamais la raison
        // d'une ligne : « Instructions ignorées (zèle de la carte précédente) »
        // amputée de sa parenthèse ne dit plus rien à personne. Le détail se
        // reconnaît à ce qu'il compte : une parenthèse sans chiffre est du sens.
        this.briefBuf.push(t.replace(/ \([^)]*\d[^)]*\)/, ''));
        return;
      }
    }
    this.log.push({ t, cls, cardId, actor: this.active, detail });
    this.snaps.push(
      this.chars.map((c) => ({ ...c, flags: { ...c.flags }, absent: c.absent ? { ...c.absent } : null })),
    );
  }

  /**
   * Tout ce qu'il faut pour reproduire une situation signalée : l'état des
   * Grognards, la carte en cours, et la fin du journal. Le tirage n'est pas
   * rejouable — la partie tourne sur Math.random — mais le journal dit ce qui
   * s'est passé, et c'est ce qui manque le plus quand on cherche une faute.
   */
  bugReport(message: string) {
    const carte = (e: DeckEntry | null) => (e ? { kind: e.kind, id: e.card.id, name: e.card.name } : null);
    return {
      message,
      date: new Date().toISOString(),
      ou: {
        saison: this.season,
        round: this.roundCode(),
        etape: this.stage,
        sousEtape: this.sub,
        actif: this.active,
        aQuiLeTour: this.turnHolder,
        senior: this.senior,
        fileDuTour: this.turnQueue,
      },
      grognards: this.chars.map((c, i) => ({ i, ...c })),
      table: {
        carteEnCours: carte(this.currentCard),
        carteCombat: carte(this.combatCard),
        cartesCombat: this.battleCards.map((b) => ({ ...carte(b.card), qui: b.who })),
        enAttente: this.pending?.title ?? null,
        options: this.pending?.options.map((o) => o.label) ?? [],
        filesDeBataille: this.battleQueue.map((b) => ({ nom: b.name, qui: b.who })),
      },
      deck: this.deck.map((d) => ({ kind: d.kind, id: d.card.id })),
      tireesCeRound: this.drawnThisRound,
      journal: this.log.slice(-150),
    };
  }

  /** Cartes tirées dans le round en cours. */
  roundCards(): { id: string; name: string }[] { return this.drawnThisRound; }

  /** Tous les Grognards tels qu'ils étaient à l'entrée `i` du journal. */
  snapshotAll(i: number): Character[] {
    return this.snaps[Math.max(0, Math.min(i - 1, this.snaps.length - 1))] ?? this.chars;
  }

  /** La feuille du joueur telle qu'elle était à l'entrée `i`. */
  snapshotAt(i: number): Character {
    return this.snapshotAll(i)[0] ?? this.me;
  }

  /** Annonce un jet et son seuil de réussite ; la révélation marque une pause ici. */
  private announce(t: string) { this.add(t, 'ask'); }
  private title(t: string, detail?: string) { this.add(t, 'title', undefined, detail); }
  private phase(t: string) { this.add(t, 'phase'); }
  private info(t: string, detail?: string) { this.add(t, 'info', undefined, detail); }
  private warn(t: string) { this.add(t, 'warn'); }
  private roll(t: string) { this.add(t, 'roll'); }
  private cardLog(t: string, cardId?: string) { this.add(t, 'card', cardId); }

  // ---------- stats ----------
  rank(): Rank { return RANKS[this.ch.rankIdx]; }
  category(): 'line' | 'field' | 'general' { return this.ch.marechal ? 'general' : this.rank().category; }
  rankName(): string { return this.ch.marechal ? 'Maréchal' : this.rank().name; }
  isGeneralOfficer(): boolean { return this.category() === 'general'; }
  seasonDef(): Season { return SEASONS[this.season - 1]; }
  roundCode(): string { return this.seasonDef().rounds[this.roundIdx]; }
  isCampaignRound(code: string): boolean { return /-[A-Z]\d?$/.test(code) || /#/.test(code); }

  /**
   * `silent` : la piste bouge sans ligne de journal. Réservé aux cas où le
   * libellé du choix annonce déjà le mouvement — écrire « Standing -1 » sous
   * « Partir en permission (S−1) » ne dit rien de neuf.
   */
  applyStat(key: string, amount: number | string, label?: string, silent = false) {
    const c = this.ch as any;
    let v: number;
    let txt = '';
    if (typeof amount === 'number') v = amount;
    else {
      const r = rollExpr(amount, this.rng, { F: this.ch.F });
      v = r.value;
      txt = ` (${r.text})`;
      // un dé lancé se montre sur le plateau : il ne se cache pas dans la ligne de gain
      if (/D10/i.test(r.text)) this.roll(r.text);
    }
    if (v === 0) return;
    const names: Record<string, string> = {
      N: 'Notice de Napoléon', G: 'Gloire', E: 'Expérience', M: 'Bourse', MParis: 'Paris',
      H: 'Santé', C: 'Charme', F: 'Escrime', S: 'Standing',
    };
    const apply = (prop: string, min: number, max: number) => {
      const before = c[prop];
      c[prop] = Math.max(min, Math.min(max, before + v));
      const d = c[prop] - before;
      if (this.traceOn && d !== 0) this.trace.push(`${this.active}:${key}${d}`);
      if (d !== 0 && !silent) this.add(`${names[key] ?? key} ${d > 0 ? '+' : ''}${d}${txt} → ${c[prop]}`, d > 0 ? 'gain' : 'loss');
    };
    switch (key) {
      case 'N': apply('N', 0, 999); break;
      case 'G': apply('G', 0, 999); break;
      case 'E': apply('E', 0, 999); break;
      case 'M': apply('mPurse', 0, 99999); break;
      case 'MParis': apply('mParis', 0, 99999); break;
      case 'H': apply('H', 0, 99); if (this.ch.H <= 0) this.healthZero(); break;
      case 'C': apply('C', 0, 99); break;
      case 'F': apply('F', 0, 99); break;
      case 'S':
        if (this.isGeneralOfficer()) { this.info('Standing ignoré (chapeau de Napoléon).'); return; }
        apply('standing', -4, 5);
        break;
      default: this.info(`Effet non géré : ${key}${txt}`);
    }
    if (['N', 'G', 'E'].includes(key) && v > 0) this.checkPromotion();
  }

  applyEffects(effects: Effects | Record<string, unknown> | null | undefined, label?: string) {
    if (!effects) return;
    for (const [k, val] of Object.entries(effects)) {
      if (['W', 'P', 'label', 'zeal', 'promotion', 'rank'].includes(k)) continue;
      if (typeof val === 'number' || typeof val === 'string') {
        if (typeof val === 'string' && !/D10|^[+-]?\d+$|^F ?x/i.test(val)) { this.info(`${k}: ${val}`); continue; }
        this.applyStat(k, val as any, label);
      }
    }
  }

  // ---------- création ----------
  private blankCharacter(name: string): Character {
    return {
      name, rankIdx: 0, marechal: false, assignment: '', standing: 0,
      N: 0, G: 0, E: 0, mParis: 0, mPurse: 0, H: 0, C: 0, F: 0,
      loh: 0, armsOfHonor: true, title: null, office: false, absent: null,
      flags: {}, deaths: 0, nonDuelWounds: 0,
    };
  }

  /** Résout une étape de mise en place et renvoie le texte du jet. */
  private rollSetupStep(idx: number, silent = false): string {
    const ch = this.ch;
    const step = this.setupPlan[idx];
    let text: string;
    switch (step.id) {
      case 'name': {
        const n = generateName(this.rng);
        ch.name = n.full;
        if (!silent) for (const s of n.steps) this.info(s);
        text = `Nom : ${n.full}`;
        break;
      }
      case 'assignment': {
        const r = d100(this.rng);
        const a = assignmentFor(1, r);
        ch.assignment = a.cmd;
        text = `Affectation : 2D10=${r} → ${commandName(a.cmd)}`;
        break;
      }
      case 'rank': {
        const r = d10(this.rng);
        ch.rankIdx = r <= 5 ? 0 : 1;
        text = `Grade : 1D10=${r} → ${RANKS[ch.rankIdx].name}`;
        break;
      }
      case 'N': {
        const r = d10(this.rng);
        ch.N = Math.floor(r / 4);
        text = `Notice de Napoléon : 1D10=${r} ÷4↓ → ${ch.N}`;
        break;
      }
      case 'G': {
        const r = d10(this.rng);
        ch.G = r;
        text = `Gloire : 1D10=${r} → ${ch.G}`;
        break;
      }
      case 'E': {
        const r = d10(this.rng);
        ch.E = Math.ceil(r / 2);
        text = `Expérience : 1D10=${r} ÷2↑ → ${ch.E}`;
        break;
      }
      case 'mParis': {
        const r = d100(this.rng);
        ch.mParis = Math.floor(r / 4);
        text = `Francs à Paris : 2D10=${r} ÷4↓ → ${ch.mParis} F`;
        break;
      }
      case 'mPurse': {
        const r = d10(this.rng);
        ch.mPurse = r;
        text = `Francs en bourse : 1D10=${r} → ${ch.mPurse} F`;
        break;
      }
      case 'H': {
        const r = d10(this.rng);
        ch.H = 100 - r;
        text = `Santé : 100 − 1D10=${r} → ${ch.H}`;
        break;
      }
      case 'C': {
        const r = d10(this.rng);
        ch.C = r;
        text = `Charme : 1D10=${r} → ${ch.C}`;
        break;
      }
      case 'F': {
        const r = d10(this.rng);
        ch.F = Math.ceil(r / 3);
        text = `Escrime : 1D10=${r} ÷3↑ → ${ch.F}`;
        break;
      }
      default:
        text = '?';
    }
    this.setupDone.push({ ...step, text });
    return text;
  }

  private rollAllSetup() {
    for (let i = 0; i < this.setupPlan.length; i++) this.roll(this.rollSetupStep(i));
    this.ch.standing = 0;
    this.info('Standing : case +0 (5).');
    this.setupBots();
  }

  /** Les concurrents sont créés d'un bloc : leurs jets n'intéressent pas le joueur. */
  private setupBots() {
    const here = this.active;
    for (let i = 1; i < this.chars.length; i++) {
      this.active = i;
      for (let k = 0; k < this.setupPlan.length; k++) this.rollSetupStep(k, true);
      this.ch.standing = 0;
    }
    this.active = here;
    if (this.chars.length > 1) {
      this.info(
        'Concurrents : ' +
          this.chars.slice(1).map((c) => `${c.name} (${RANKS[c.rankIdx].name})`).join(', ') + '.',
      );
    }
  }

  private stepSetup() {
    if (this.sub >= this.setupPlan.length) {
      this.ch.standing = 0;
      this.info('Standing : case +0 (5).');
      this.beginCampaign();
      return;
    }
    this.roll(this.rollSetupStep(this.sub));
    this.sub++;
  }

  /** Étapes de mise en place, pour l'affichage (mode guidé). */
  setupSteps(): { id: string; label: string; expr: string; text?: string }[] {
    return this.setupPlan.map((s, i) => ({ ...s, text: this.setupDone[i]?.text }));
  }

  // ---------- promotions ----------
  /**
   * Les minimums d'un grade sont-ils atteints ?
   * La notice en excès peut tenir lieu de gloire (1 pour 1) et la gloire en excès
   * d'expérience (2 pour 1) ; ce qui est converti ne compte plus pour son propre seuil.
   */
  /**
   * Décompte des substitutions pour un grade donné.
   * Deux points de gloire en trop valent un point d'expérience ; un point de
   * notice en trop vaut un point de gloire. Ce qui sert de monnaie d'échange ne
   * compte plus pour son propre seuil, et rien n'est réellement transféré.
   * La notice ne couvre que l'exigence de gloire elle-même, jamais la gloire
   * dépensée en expérience : cette gloire-là, il faut la posséder.
   */
  rankGap(idx: number): {
    ok: boolean;
    gToE: number;
    nToG: number;
    lack: { N: number; G: number; E: number };
  } | null {
    const p = RANKS[idx]?.promotion;
    if (!p) return null;
    const ch = this.ch;
    const needN = this.season >= 6 ? p.N : 0;
    const gToE = Math.max(0, p.E - ch.E) * 2;
    const gLeft = ch.G - gToE; // gloire restante une fois l'expérience payée
    const nToG = Math.max(0, p.G - gLeft);
    const ok = gLeft >= 0 && ch.N - nToG >= needN;
    return {
      ok,
      gToE,
      nToG,
      lack: {
        N: Math.max(0, needN + nToG - ch.N),
        G: Math.max(0, p.G - ch.G),
        E: Math.max(0, p.E - ch.E),
      },
    };
  }

  meetsRank(idx: number): boolean {
    return this.rankGap(idx)?.ok ?? false;
  }

  /** Prochain grade, ce qui manque, et ce que les substitutions couvrent déjà. */
  nextRank(): {
    name: string;
    need: { N: number; G: number; E: number };
    gToE: number;
    nToG: number;
    ready: boolean;
    requiresN: boolean;
  } | null {
    const idx = this.ch.rankIdx + 1;
    const p = RANKS[idx]?.promotion;
    const gap = this.rankGap(idx);
    if (this.ch.marechal || !p || !gap) return null;
    return {
      name: RANKS[idx].name,
      need: gap.lack,
      gToE: gap.gToE,
      nToG: gap.nToG,
      ready: gap.ok,
      // avant la saison VI, et pour les premiers grades, la notice n'est pas exigée
      requiresN: this.season >= 6 && p.N > 0,
    };
  }

  private checkPromotion() {
    while (this.ch.rankIdx < RANKS.length - 2 && this.meetsRank(this.ch.rankIdx + 1)) {
      if (!this.promoteTo(this.ch.rankIdx + 1)) break; // refusée : ne pas boucler
    }
  }

  promoteTo(idx: number, reason?: string): boolean {
    if (this.ch.absent?.type === 'prisoner') { this.warn('Prisonnier : promotion impossible pour le moment.'); return false; }
    if (this.ch.absent?.type === 'death') return false;
    this.ch.rankIdx = Math.min(idx, RANKS.length - 2);
    this.title(`⭐ Promotion : ${this.rank().name}${reason ? ` (${reason})` : ''}`);
    if (this.isGeneralOfficer() && (this.rank().id === 'general' || this.ch.marechal)) {
      this.ch.standing = 0;
      this.info('Général : le standing est remplacé par le chapeau de Napoléon (+0).');
    } else {
      this.rollStanding('promotion');
    }
    return true;
  }

  private rollStanding(reason: string) {
    if (this.isGeneralOfficer() && (this.rank().id === 'general' || this.ch.marechal)) return;
    const r = d10(this.rng);
    const map: Record<number, number> = { 1: -4, 2: -3, 3: -2, 4: -1, 5: 0, 6: 1, 7: 2, 8: 3, 9: 4, 10: 5 };
    this.ch.standing = map[r];
    this.roll(`Standing (${reason}) : 1D10=${r} → ${this.ch.standing >= 0 ? '+' : ''}${this.ch.standing}`);
  }

  // ---------- blessures / mort / prison ----------
  checkWound(w: number): boolean {
    if (w <= 0) return false;
    this.announce(`Blessure ? — touché sur 2D10 ≤ ${w}`);
    const r = d100(this.rng);
    if (r > w) { this.roll(`2D10=${r} > ${w} — indemne.`); return false; }
    this.roll(`2D10=${r} ≤ ${w} — touché !`);
    this.ch.nonDuelWounds++;
    this.announce('Gravité de la blessure ? — 1-11 tué, 12-48 grave, 49-77 légère, 78+ égratignure');
    const wr = d100(this.rng);
    const row = findWoundRow(wr);
    this.roll(`2D10=${wr} → ${this.woundName(row.type)}`);
    this.applyWoundRow(row);
    return true;
  }

  private woundName(type: string): string {
    const n: Record<string, string> = {
      killed: 'Tué !', gravely: 'Gravement blessé', severely: 'Sévèrement blessé',
      badly: 'Mal blessé', flesh: 'Blessure superficielle', scratch: 'Une égratignure',
    };
    return n[type] ?? type;
  }

  /**
   * Applique une ligne de la table des blessures. Sur le pré, la gloire, le
   * standing et l'expérience qu'elle porte ne comptent pas : le duel a ses
   * propres résultats, et un homme embroché n'a pas gagné d'expérience.
   */
  private applyWoundRow(row: WoundRow, onDuelField = false) {
    if (row.type === 'killed') { this.die(); return; }
    if (row.effects) {
      for (const [k, v] of Object.entries(row.effects)) {
        if (onDuelField && (k === 'S' || k === 'G' || k === 'E')) continue;
        this.applyStat(k, v as any);
      }
    }
    if (row.convalescenceMultiplier) {
      // santé tombée à 0 : la retraite involontaire prime sur la convalescence
      if (this.ch.absent?.type === 'retirement') {
        this.info('Trop atteint pour l’hôpital militaire : réformé, il rentre chez lui.');
        return;
      }
      this.ch.absent = { type: 'convalescence', convMult: row.convalescenceMultiplier, convRounds: 0 };
      this.warn('Convalescence : absent jusqu’à récupération.');
    }
  }

  die() {
    this.title('☠ Mort au champ d’honneur.');
    this.ch.deaths++;
    this.ch.absent = { type: 'death' };
  }

  becomePrisoner() {
    if (this.ch.mPurse > 0) { this.warn(`Pillé : la bourse (${this.ch.mPurse} F) est perdue.`); this.ch.mPurse = 0; }
    const conv = this.ch.absent?.type === 'convalescence';
    this.ch.absent = { type: 'prisoner', alsoConvalescing: conv, convMult: this.ch.absent?.convMult, convRounds: this.ch.absent?.convRounds };
    this.warn('Prisonnier ! Absent jusqu’à l’échange en fin de saison.');
  }

  checkPrisoner(p: number) {
    if (p <= 0) return;
    if (this.ch.absent?.type === 'death') return;
    this.announce(`Prisonnier ? — capturé sur 2D10 ≤ ${p}`);
    const r = d100(this.rng);
    if (r <= p) { this.roll(`2D10=${r} ≤ ${p} — capturé !`); this.becomePrisoner(); }
    else this.roll(`2D10=${r} > ${p} — échappe à la capture.`);
  }

  private healthZero() {
    if (this.ch.absent?.type === 'prisoner') { this.warn('Santé à 0 en captivité : retraite à l’échange.'); return; }
    if (this.ch.absent?.type === 'retirement' || this.ch.absent?.type === 'death') return;
    this.warn('Santé à 0 : retraite involontaire.');
    this.ch.absent = { type: 'retirement' };
    if (this.ch.office) { this.ch.office = false; this.info('Office perdu (retraite).'); }
  }

  // ---------- atelier (god mode) ----------
  //
  // Ces deux entrées ne servent qu'à essayer le jeu : elles court-circuitent
  // la carrière pour poser une situation directement sur la table. Rien dans
  // le déroulement normal ne les appelle.

  /**
   * Saute au début d'une saison, exactement comme le ferait la fin de la
   * précédente : le segment de saison s'ouvre, et la phase d'affectation
   * remettra le Grognard dans un commandement qui existe encore.
   */
  jumpToSeason(n: number) {
    const target = Math.max(1, Math.min(SEASONS.length, Math.trunc(n)));
    if (target === this.season) return;
    this.pending = null;
    this.duelRun = null;
    this.battleQueue = [];
    this.afterBattles = null;
    this.wwtQueue = [];
    this.closeSeasonChronicle();
    this.season = target;
    this.roundIdx = 0;
    this.turnQueue = [];
    this.deck = [];
    this.currentCard = null;
    this.combatCard = null;
    this.openSeasonChronicle();
    this.title(`⚙ Atelier : la carrière reprend en saison ${this.seasonDef().roman}`,
      `${this.seasonDef().name} · ${this.seasonDef().years}`);
    this.stage = target === 1 ? 'round-start' : 'segment';
    this.sub = 0;
    this.save();
  }

  /**
   * Met deux hommes sur le pré, séance tenante. `foe` désigne un concurrent,
   * ou vaut null pour un adversaire de carte sans feuille — celui-ci ne
   * saigne pas et ne gagne rien, comme le Burger.
   */
  testDuel(foe: number | null, weapon: 'sword' | 'pistol', escrime = 5) {
    const me = this.asDuelist(0);
    const other = foe === null ? this.cardDuelist('Un inconnu masqué', escrime) : this.asDuelist(foe);
    const terms: DuelTerms = {
      label: `⚙ Atelier — duel ${weapon === 'sword' ? 'à l’épée' : 'au pistolet'}`,
      weapon,
      standard: true,
      magnanimity: foe !== null,
    };
    this.active = 0;
    if (weapon === 'sword') {
      this.startSwordDuel({ a: me, b: other, first: 'a' }, terms);
    } else {
      this.askAim('Pointer l’arme', (aim) =>
        this.pistolDuel(me, other, terms, { a: aim, b: 'wound' }));
    }
  }

  // ---------- désigner un rival ----------

  /**
   * Fait porter à un autre Grognard ce qu'on écrit là. `applyStat` et tout ce
   * qui en découle travaillent sur le Grognard actif : pour toucher un rival —
   * le calomnier, l'embrocher, lui verser une part de butin — il faut lui
   * passer la main le temps de l'écrire, puis la reprendre.
   */
  private asActor<T>(idx: number, fn: () => T): T {
    const back = this.active;
    if (idx === back) return fn();
    // Les gains d'un concurrent attendent en mémoire d'être rendus en une
    // ligne : il faut les écouler avant de changer de main, sinon la ligne
    // porterait le nom du mauvais Grognard.
    this.handOver(idx);
    try { return fn(); } finally { this.flushBrief(); this.active = back; }
  }

  /**
   * Passe la main à un autre Grognard pour de bon — le temps qu'il réponde à
   * une question, ou qu'on écrive en son nom. Ce qu'un concurrent avait mis de
   * côté part d'abord, faute de quoi sa ligne changerait de propriétaire.
   */
  private handOver(idx: number) {
    if (idx === this.active) return;
    this.flushBrief();
    this.active = idx;
  }

  /**
   * La disgrâce d'un Grognard rejaillit sur son commandement : chacun de ceux
   * qui s'y sont battus devient partie lésée envers lui, et peut lui demander
   * réparation. C'est la première des raisons que la planche reconnaît au défi,
   * et la seule qui se présente assez souvent pour que le pré serve.
   */
  private disgraceComrades() {
    const culprit = this.active;
    const witnesses = this.rivals({ sameCommand: true });
    if (!witnesses.length) return;
    for (const i of witnesses) this.chars[i].flags.grievanceAgainst = culprit;
    this.warn(`Le commandement a vu : ${witnesses.length > 1 ? 'ses camarades sont' : 'son camarade est'} en droit de lui demander réparation.`);
  }

  /** Les rivaux que l'on peut prendre pour cible, selon ce que la carte exige. */
  rivals(opts: { sameCommand?: boolean; sameRank?: boolean; from?: number } = {}): number[] {
    const selfIdx = opts.from ?? this.active;
    const self = this.chars[selfIdx];
    const out: number[] = [];
    this.chars.forEach((c, i) => {
      if (i === selfIdx) return;
      if (c.absent) return;
      if (opts.sameCommand && c.assignment !== self.assignment) return;
      if (opts.sameRank && (c.rankIdx !== self.rankIdx || c.marechal !== self.marechal)) return;
      out.push(i);
    });
    return out;
  }

  /** Comment un rival se présente au joueur qui doit le désigner. */
  private rivalLabel(i: number): string {
    const c = this.chars[i];
    const rank = c.marechal ? 'Maréchal' : RANKS[c.rankIdx].name;
    return `${c.name} — ${rank}, gloire ${c.G}, escrime ${c.F}, santé ${c.H}`;
  }

  /**
   * Désigne un rival, puis reprend le fil. Un concurrent tranche seul ; le
   * joueur choisit dans la liste — sauf quand la carte tire au sort, auquel cas
   * personne ne choisit.
   */
  private askTarget(
    title: string,
    candidates: number[],
    then: (idx: number) => void,
    opts: { random?: boolean; kind?: 'harm' | 'help' } = {},
  ) {
    if (!candidates.length) return;
    if (opts.random) {
      const pick = candidates[Math.floor(this.rng() * candidates.length)];
      this.info(`Le sort désigne ${this.chars[pick].name}.`);
      then(pick);
      return;
    }
    if (this.ch.bot) {
      then(botTarget(candidates.map((i) => ({ idx: i, ch: this.chars[i] })), opts.kind ?? 'harm'));
      return;
    }
    this.ask(title, candidates.map((i) => ({ label: this.rivalLabel(i), run: () => then(i) })));
  }

  // ---------- le duel ----------

  /** Un Grognard sur le pré, vu par le moteur de duel. */
  private asDuelist(idx: number): Duelist {
    const c = this.chars[idx];
    return { idx, pilot: idx, name: c.name, F: c.F, H: c.H, persona: c.persona };
  }

  /**
   * Un personnage de carte. Il n'a pas de feuille — rien ne l'atteint — mais
   * un Grognard peut tenir le rôle et choisir ses cartes ; `pilot` dit lequel,
   * et son escrime et sa santé servent aux cartes d'avantage quand la carte le
   * prévoit. Sans pilote, la machine s'en charge.
   */
  private cardDuelist(name: string, F: number, pilot: number | null = null, H = 0): Duelist {
    return { idx: null, pilot, name, F, H };
  }

  /** La machine joue-t-elle ce duelliste ? */
  private isAuto(d: Duelist): boolean {
    return d.pilot === null || !!this.chars[d.pilot]?.bot;
  }

  /**
   * Ouvre un assaut à l'épée et le mène jusqu'au sang — ou jusqu'à ce qu'il
   * faille demander une carte au joueur, auquel cas la main lui passe et le
   * duel reprendra à sa réponse.
   */
  private startSwordDuel(setup: SwordSetup, terms: DuelTerms) {
    this.duelRun = {
      sword: new SwordDuel(DUEL, this.rng, setup),
      terms,
      a: setup.a,
      b: setup.b,
      returnTo: this.active,
      journal: [],
      before: this.duelSnapshot(setup.a, setup.b),
    };
    const n = (s: Side) => this.duelRun!.sword!.hands[s].length;
    this.duelSay(`${setup.a.name} ${n('a')} cartes · ${setup.b.name} ${n('b')} cartes.`);
    this.stepDuel();
  }

  /** Une ligne dans le journal du duel — pas dans la chronique. */
  private duelSay(t: string) {
    this.duelRun?.journal.push(t);
  }

  /** Copie des feuilles concernées, pour mesurer ce que le duel aura changé. */
  private duelSnapshot(...who: Duelist[]): Record<number, Character> {
    const out: Record<number, Character> = {};
    for (const d of who) if (d.idx !== null) out[d.idx] = { ...this.chars[d.idx] };
    return out;
  }

  /**
   * Déroule le duel tant que la machine peut jouer seule. Dès qu'une carte est
   * attendue du joueur, on la lui demande sous son propre nom : le Grognard
   * actif devient le duelliste, faute de quoi la politique des concurrents
   * répondrait à sa place.
   */
  private stepDuel() {
    const run = this.duelRun;
    const duel = run?.sword;
    if (!run || !duel) return;
    let guard = 0;
    while (!duel.done && guard++ < 200) {
      const side = duel.turn!;
      const who = side === 'a' ? run.a : run.b;
      const choices = duel.choices();
      const answering = duel.answering;
      if (!choices.length) { this.playDuelCard(-1); continue; }
      if (!this.isAuto(who)) {
        // le joueur tient les cartes : on lui rend la main et l'on attend
        this.handOver(who.pilot ?? 0);
        this.ask(
          `${run.terms.label} — ${answering ? 'répondre' : 'ouvrir'} (${duel.hands[side].length} carte${duel.hands[side].length > 1 ? 's' : ''} en main)`,
          choices.map((c, i) => ({ label: c.label, run: () => this.playDuelCard(i) })),
        );
        return;
      }
      this.playDuelCard(duelChoice(choices, who.pilot === null ? null : this.chars[who.pilot], answering));
    }
    this.endSwordDuel();
  }

  /** Pose une carte et raconte ce qu'elle produit. */
  private playDuelCard(i: number) {
    const run = this.duelRun;
    const duel = run?.sword;
    if (!run || !duel) return;
    const side = duel.turn!;
    const who = side === 'a' ? run.a : run.b;
    const before = duel.deals;
    const responding = duel.answering;
    const played = duel.play(i);
    if (played) {
      const what = played.card === 'no-card'
        ? 'n’a plus de carte'
        : `${SWORD_LABEL[played.card]}${played.card !== 'parry' ? (played.aim === 'kill' ? ' pour tuer' : ' pour blesser') : ''}`;
      this.duelSay(`${who.name} ${responding ? 'répond' : 'ouvre'} : ${what}.`);
    }
    if (duel.deals > before && !duel.done) this.duelSay('Les deux mains sont vides : on redistribue.');
    // relancé par le joueur : c'est ici que la boucle reprend
    if (i >= 0 && !this.isAuto(who) && !duel.done) { this.stepDuel(); return; }
    if (duel.done) this.endSwordDuel();
  }

  /** Le sang versé, on compte les points. */
  private endSwordDuel() {
    const run = this.duelRun;
    const o = run?.sword?.outcome ?? null;
    if (!run) return;
    // le duel reste ouvert le temps du décompte : la fenêtre doit pouvoir le lire
    this.handOver(run.returnTo);
    if (!o || !o.woundedSide) {
      this.duelSay('Les témoins séparent les bretteurs : l’honneur est satisfait.');
      this.applyDuelResults(run, null);
      run.terms.then?.(o);
      this.closeDuel(run, null);
      return;
    }
    const winner = o.winnerSide === 'a' ? run.a : run.b;
    const loser = o.woundedSide === 'a' ? run.a : run.b;
    this.duelSay(`${winner.name} touche ${loser.name} — ${o.aim === 'kill' ? 'pour tuer' : 'pour blesser'}.`);
    // la magnanimité : renoncer à frapper vaut plus que le sang, mais on ne
    // l'accorde pas à un personnage de carte, qui n'a rien à en faire
    const spare = run.terms.magnanimity && loser.idx !== null && winner.idx !== null;
    const humain = this.interactive && (run.a.pilot === 0 || run.b.pilot === 0);
    const strike = () => {
      // Sur le pré, le joueur lance lui-même : le duel s'arrête ici et la
      // fenêtre lui tend les dés. Entre concurrents, rien n'attend personne.
      if (humain) { run.wound = { loser, winner, aim: o.aim }; return; }
      this.resolveDuelWound(run, o, loser, winner);
    };
    if (!spare) { strike(); return; }
    const askSpare = () => {
      this.handOver(winner.idx!);
      this.ask('Le fer est sur sa gorge', [
        { label: 'Frapper', run: () => { this.handOver(run.returnTo); strike(); } },
        {
          label: 'Faire grâce (G+5)',
          run: () => {
            this.handOver(winner.idx!);
            this.applyStat('G', 5, 'magnanimité');
            this.handOver(run.returnTo);
            this.applyDuelResults(run, o);
            this.duelSay(`${winner.name} fait grâce.`);
            run.terms.then?.(o);
            this.closeDuel(run, `${winner.name} fait grâce à ${loser.name}`);
          },
        },
      ]);
    };
    if (this.chars[winner.idx!].bot) {
      // un concurrent ne fait pas de quartier : la gloire du sang vaut la sienne
      strike();
      return;
    }
    askSpare();
  }

  /**
   * Referme le duel : une seule ligne dans la chronique, qui dit l'issue et ce
   * que l'affaire a coûté à chacun. Le détail des passes reste dans la fenêtre.
   */
  private closeDuel(run: DuelRun, issue: string | null) {
    const bilan = (d: Duelist): string | null => {
      if (d.idx === null) return null;
      const av = run.before[d.idx];
      const ap = this.chars[d.idx];
      if (!av) return null;
      const parts: string[] = [];
      const champs: [keyof Character, string][] = [
        ['N', 'N'], ['G', 'G'], ['E', 'E'], ['H', 'H'], ['C', 'C'], ['F', 'F'], ['standing', 'S'],
      ];
      for (const [k, nom] of champs) {
        const dv = (ap[k] as number) - (av[k] as number);
        if (dv) parts.push(`${nom}${dv > 0 ? '+' : ''}${dv}`);
      }
      if (ap.absent?.type && ap.absent.type !== av.absent?.type) {
        parts.push(ap.absent.type === 'death' ? 'mort' : ap.absent.type === 'convalescence' ? 'convalescence' : ap.absent.type);
      }
      return parts.length ? `${d.name} ${parts.join(' ')}` : null;
    };
    const comptes = [bilan(run.a), bilan(run.b)].filter(Boolean).join(' · ');
    const tete = issue ?? 'l’honneur est satisfait';
    this.duelRun = null;
    this.title(`⚔ ${run.terms.label} — ${tete}`, comptes || undefined);
    if (comptes) this.info(comptes);
    // le joueur doit pouvoir lire ce qui vient de se passer avant que la
    // fenêtre disparaisse ; entre concurrents, il n'y a rien à montrer
    if (this.interactive && (run.a.pilot === 0 || run.b.pilot === 0)) {
      run.journal.push(tete);
      if (comptes) run.journal.push(comptes);
      this.duelOver = { label: run.terms.label, journal: run.journal, summary: comptes || tete, roll: run.roll ?? null };
    }
  }

  /**
   * Ce que la fenêtre de duel a besoin de savoir. Elle lit, elle n'écrit pas :
   * tout ce qu'elle décide repasse par `playDuelCard`, `duelRollWound` ou
   * `choose`, comme n'importe quelle question posée au joueur.
   */
  duelView(): {
    label: string;
    journal: string[];
    /** Le camp du joueur, s'il tient des cartes ; sinon il regarde. */
    mine: { name: string; cards: number } | null;
    foe: { name: string; cards: number };
    table: { card: string; aim: Aim } | null;
    /** Qui doit poser une carte, en clair. */
    turnName: string | null;
    myTurn: boolean;
    /** La main du joueur, carte par carte, avec les pointes possibles. */
    hand: { card: string; aims: Aim[] }[];
    /** Une question du moteur pendant le duel — magnanimité, arme… */
    ask: { title: string; options: string[] } | null;
    /** Les dés attendent d'être lancés. */
    awaitingRoll: boolean;
    roll: { faces: [number, number]; bonus: number; total: number; result: string } | null;
    summary: string | null;
    done: boolean;
  } | null {
    const run = this.duelRun;
    if (!run) {
      const fini = this.duelOver;
      if (!fini) return null;
      return {
        label: fini.label, journal: fini.journal, mine: null, foe: { name: '', cards: 0 },
        table: null, turnName: null, myTurn: false, hand: [], ask: null,
        awaitingRoll: false, roll: fini.roll ?? null, summary: fini.summary, done: true,
      };
    }
    const duel = run.sword;
    const mienne = (d: Duelist) => d.pilot === 0;
    const moi = mienne(run.a) ? run.a : mienne(run.b) ? run.b : null;
    const lui = moi === run.a ? run.b : run.a;
    const side = duel?.turn ?? null;
    const qui = side ? (side === 'a' ? run.a : run.b) : null;
    const aMoi = !!side && !!qui && mienne(qui) && !!this.pending;
    const cartes = (d: Duelist): number => {
      if (!duel) return 0;
      return duel.hands[d === run.a ? 'a' : 'b'].length;
    };
    const main: { card: string; aims: Aim[] }[] = [];
    if (aMoi && duel && side) {
      for (const c of duel.hands[side]) {
        main.push({ card: c, aims: c === 'parry' ? [] : (['wound', 'kill'] as Aim[]) });
      }
    }
    // une question qui n'est pas un coup à jouer : elle s'affiche dans la fenêtre
    const question = this.pending && !aMoi
      ? { title: this.pending.title, options: this.pending.options.map((o) => o.label) }
      : null;
    return {
      label: run.terms.label,
      journal: run.journal,
      mine: moi ? { name: moi.name, cards: cartes(moi) } : null,
      foe: { name: lui.name, cards: cartes(lui) },
      table: duel?.table ? { card: duel.table.card, aim: duel.table.aim } : null,
      turnName: qui?.name ?? null,
      myTurn: aMoi,
      hand: main,
      ask: question,
      awaitingRoll: !!run.wound,
      roll: run.roll ?? null,
      summary: null,
      done: false,
    };
  }

  /** Pose la carte d'indice `i` de la main, pointée comme demandé. */
  playDuelCard2(i: number, aim: Aim) {
    const run = this.duelRun;
    const duel = run?.sword;
    const side = duel?.turn;
    if (!run || !duel || !side) return;
    const card = duel.hands[side][i];
    if (!card) return;
    const choix = duel.choices().findIndex((c) => c.card === card && (!c.aim || c.aim === aim));
    if (choix >= 0) this.choose(choix);
  }

  /** Referme la fenêtre une fois le décompte lu. */
  duelDismiss() {
    this.duelOver = null;
    this.save();
  }

  /**
   * La table des blessures, pointée par l'intention du coup. Les deux faces du
   * d10 sont rendues séparément : la fenêtre les montre rouler.
   */
  private duelWound(loser: Duelist, aim: Aim): { row: WoundRow; faces: [number, number]; total: number; bonus: number } {
    const bonus = aim === 'wound' ? 10 : 0;
    const t = d10(this.rng) % 10;
    const u = d10(this.rng) % 10;
    const brut = t * 10 + u === 0 ? 100 : t * 10 + u;
    const total = Math.min(100, brut + bonus);
    const row = findWoundRow(total);
    this.duelSay(`Blessure : 2D10=${brut}${bonus ? ` +${bonus}` : ''} → ${this.woundName(row.type)}`);
    if (loser.idx === null) this.duelSay(`${loser.name} : ${this.woundName(row.type).toLowerCase()}`);
    else this.asActor(loser.idx, () => this.applyWoundRow(row, true));
    return { row, faces: [t, u], total, bonus };
  }

  /** Porte le coup, applique les résultats, et prépare le décompte. */
  private resolveDuelWound(run: DuelRun, o: SwordOutcome, loser: Duelist, winner: Duelist) {
    const { row, faces, total, bonus } = this.duelWound(loser, o.aim);
    run.roll = { faces, bonus, total, result: this.woundName(row.type) };
    run.wound = null;
    this.applyDuelResults(run, o);
    run.terms.then?.(o, row);
    this.closeDuel(run, `${winner.name} touche ${loser.name} — ${this.woundName(row.type).toLowerCase()}`);
  }

  /** Le joueur lance les dés de blessure ; la fenêtre reste ouverte ensuite. */
  duelRollWound() {
    const run = this.duelRun;
    const w = run?.wound;
    const o = run?.sword?.outcome;
    if (!run || !w || !o) return;
    this.resolveDuelWound(run, o, w.loser, w.winner);
  }

  /** Les résultats de la planche, ou ceux que la carte impose à leur place. */
  private applyDuelResults(run: DuelRun, o: SwordOutcome | null) {
    const t = run.terms;
    const sides: [Duelist, Side][] = [[run.a, 'a'], [run.b, 'b']];
    if (t.standard) {
      for (const [d] of sides) {
        if (d.idx === null) continue;
        this.asActor(d.idx, () => {
          this.applyEffects(DUEL.results.bothDuelists as Effects, 'duel');
          if (t.weapon === 'sword') this.applyEffects(DUEL.results.swordDuel as Effects, 'duel à l’épée');
        });
      }
      if (o?.winnerSide) {
        const w = o.winnerSide === 'a' ? run.a : run.b;
        const l = o.woundedSide === 'a' ? run.a : run.b;
        if (w.idx !== null) {
          this.asActor(w.idx, () => {
            this.applyEffects(DUEL.results.winnerUnwounded as Effects, 'vainqueur indemne');
            if (l.idx !== null && this.chars[l.idx].absent?.type === 'death') {
              this.applyEffects(DUEL.results.kill as Effects, 'il a tué son homme');
            }
          });
        }
      }
    }
    if (t.drawerEffects && run.a.idx !== null) {
      this.asActor(run.a.idx, () => this.applyEffects(t.drawerEffects!, run.terms.label));
    }
  }

  /**
   * Le duel au pistolet. Chacun pointe son arme, les amorces décident de
   * l'ordre, et le second ne tire que s'il tient encore debout.
   */
  private pistolDuel(a: Duelist, b: Duelist, terms: DuelTerms, aims: Record<Side, Aim>, hitCap = 5) {
    this.phase(terms.label);
    const ord = pistolOrder(this.rng);
    this.roll(`Amorces : ${a.name} 2D10=${ord.rolls.a}${ord.misfire.a ? ' — raté !' : ''} · ${b.name} 2D10=${ord.rolls.b}${ord.misfire.b ? ' — raté !' : ''}`);
    if (ord.priority) {
      this.roll(`Qui tire le premier : ${a.name} 1D10=${ord.priority.a} · ${b.name} 1D10=${ord.priority.b}`);
    }
    const run: DuelRun = {
      sword: null, terms, a, b, returnTo: this.active,
      journal: [], before: this.duelSnapshot(a, b),
    };
    this.duelRun = run;
    if (ord.bothMisfired) {
      // « the duel can be over by mutual agreement » — les témoins l'entendent ainsi
      this.info('Les deux armes ont fait long feu : les témoins déclarent l’honneur satisfait.');
      this.applyDuelResults(run, null);
      terms.then?.(null);
      return;
    }
    const order: Side[] = ord.first === 'a' ? ['a', 'b'] : ['b', 'a'];
    let outcome: SwordOutcome | null = null;
    let blessure: WoundRow | undefined;
    /**
     * Les deux tirent, chacun son tour. Le second ne renonce que s'il est tué
     * ou **gravement** blessé — une égratignure ne dispense pas de rendre le
     * coup — ou si son amorce a raté. Les deux peuvent donc tomber.
     */
    let arrete = false;
    for (const side of order) {
      if (ord.misfire[side] || arrete) continue;
      const shooter = side === 'a' ? a : b;
      const target = side === 'a' ? b : a;
      // le Burger n'est pas un tireur : jouant son rôle, on ne touche que sur 1-4
      const cap = shooter.idx === null ? hitCap : 5;
      const shot = pistolHits(this.rng, cap);
      this.roll(`${shooter.name} fait feu : 1D10=${shot.roll} ≤ ${cap} ? — ${shot.hit ? 'touché !' : 'manqué.'}`);
      if (!shot.hit) continue;
      const tir = this.duelWound(target, aims[side]);
      run.roll = { faces: tir.faces, bonus: tir.bonus, total: tir.total, result: this.woundName(tir.row.type) };
      // le premier sang ne clôt pas l'affaire au pistolet : on garde le plus grave
      if (!outcome || !blessure || GRAVITE[tir.row.type] > GRAVITE[blessure.type]) {
        outcome = { woundedSide: other(side), winnerSide: side, aim: aims[side], deals: 0 };
        blessure = tir.row;
      }
      if (tir.row.type === 'killed' || tir.row.type === 'gravely') arrete = true;
    }
    if (!outcome) this.duelSay('Les deux balles se perdent : l’honneur est satisfait.');
    this.applyDuelResults(run, outcome);
    terms.then?.(outcome, blessure);
    const gagnant = outcome ? (outcome.winnerSide === 'a' ? a : b) : null;
    const perdant = outcome ? (outcome.woundedSide === 'a' ? a : b) : null;
    this.closeDuel(run, gagnant && perdant && blessure
      ? `${gagnant.name} touche ${perdant.name} — ${this.woundName(blessure.type).toLowerCase()}`
      : null);
  }

  // ---------- avancement ----------
  advance() {
    // Un duel oublié ouvert détournerait toute la chronique vers sa fenêtre.
    // Rien ne doit pouvoir le laisser traîner : si plus personne n'attend une
    // carte et qu'aucune question n'est posée, on le referme.
    if (this.duelRun && !this.pending) {
      if (this.duelRun.wound) this.duelRollWound();
      else if (!this.duelRun.sword || this.duelRun.sword.done) this.closeDuel(this.duelRun, null);
    }
    if (this.pending || this.over) return;
    if (this.wwtQueue.length) { this.processWWT(); this.save(); return; }
    switch (this.stage) {
      case 'setup': this.stepSetup(); break;
      case 'segment': this.stepSegment(); break;
      case 'round-start': this.stepRoundStart(); break;
      case 'draw': this.stepDraw(); break;
      case 'round-over': this.nextRound(); break;
      case 'season-end': this.endSeason(); break;
      case 'game-over': break;
    }
    this.save();
  }

  advanceUntilChoice(max = 200) {
    let i = 0;
    while (!this.pending && !this.over && i++ < max) this.advance();
  }

  choose(i: number) {
    const p = this.pending;
    if (!p || !p.options[i]) return;
    this.pending = null;
    // pendant un duel, la carte posée est déjà racontée : pas d'écho
    if (!this.duelRun) this.cardLog(`▸ ${p.options[i].label}`);
    p.options[i].run();
    this.resolveBotPending();
    this.save();
  }

  // ---------- sauvegarde ----------
  static hasSave(): boolean { return hasSave(); }

  static clearSave() { clearSave(); }

  /** Sauvegarde automatique — seulement à un point stable (aucune décision ni bataille en cours). */
  save() {
    try {
      if (this.pending || this.battleQueue.length || this.afterBattles || this.duelRun || this.over) return;
      const s = {
        v: 1,
        chars: this.chars,
        active: this.active,
        turnQueue: this.turnQueue,
        senior: this.senior,
        season: this.season, roundIdx: this.roundIdx, stage: this.stage, sub: this.sub,
        deck: this.deck.map((d) => ({ kind: d.kind, id: d.card.id })),
        eventsRemaining: this.eventsRemaining, cardNumInRound: this.cardNumInRound,
        cardsByPlayer: this.cardsByPlayer,
        roundEnded: this.roundEnded,
        removed: [...this.removed], paused: [...this.pausedCards], playedEG: [...this.playedEGOnce],
        currentCard: this.currentCard ? { kind: this.currentCard.kind, id: this.currentCard.card.id } : null,
        combatCard: this.combatCard ? { kind: this.combatCard.kind, id: this.combatCard.card.id } : null,
        log: this.log, cardsPerRound: this.cardsPerRound,
        setupMode: this.setupMode, setupPlan: this.setupPlan, setupDone: this.setupDone,
        waterlooRedraw: this.waterlooRedraw, victory: this.victory,
        drawnThisRound: this.drawnThisRound,
        chronicles: this.chronicles, seasonMark: this.seasonMark, seasonStart: this.seasonStart,
      };
      writeSave(s);
    } catch { /* la partie continue sans filet */ }
  }

  static load(): Game | null {
    try {
      const s = readSave<any>();
      if (!s || s.v !== 1) return null;
      const g: Game = Object.create(Game.prototype);
      g.rng = defaultRng;
      g.pending = null;
      g.battleQueue = [];
      g.afterBattles = null;
      g.duelRun = null;
      g.fairSex = false;
      g.spain = false;
      g.over = false;
      g.chars = s.chars ?? [s.ch];
      g.active = s.active ?? 0;
      g.turnQueue = s.turnQueue ?? [];
      g.senior = s.senior ?? 0;
      for (const c of g.chars) c.flags = c.flags ?? {};
      g.season = s.season; g.roundIdx = s.roundIdx; g.stage = s.stage; g.sub = s.sub;
      g.eventsRemaining = s.eventsRemaining; g.cardNumInRound = s.cardNumInRound;
      g.cardsByPlayer = s.cardsByPlayer ?? [];
      g.roundEnded = s.roundEnded;
      g.removed = new Set(s.removed ?? []);
      g.pausedCards = new Set(s.paused ?? []);
      g.playedEGOnce = new Set(s.playedEG ?? []);
      g.log = s.log ?? [];
      g.cardsPerRound = s.cardsPerRound ?? 3;
      g.setupMode = s.setupMode ?? 'quick';
      g.setupPlan = s.setupPlan ?? [];
      g.setupDone = s.setupDone ?? [];
      g.waterlooRedraw = s.waterlooRedraw ?? false;
      g.victory = s.victory ?? false;
      g.drawnThisRound = s.drawnThisRound ?? [];
      g.chronicles = s.chronicles ?? [];
      g.seasonMark = s.seasonMark ?? 0;
      g.seasonStart = s.seasonStart ?? null;
      g.snaps = [];
      // le type de la carte n'est connu qu'à l'exécution : on le rétablit ici
      const rebuild = (e: { kind: string; id: string } | null): DeckEntry | null => {
        if (!e) return null;
        const card = cardById(e.kind, e.id);
        return card ? ({ kind: e.kind, card } as DeckEntry) : null;
      };
      g.deck = (s.deck ?? []).map(rebuild).filter(Boolean) as DeckEntry[];
      g.currentCard = rebuild(s.currentCard);
      g.combatCard = rebuild(s.combatCard);
      return g;
    } catch { return null; }
  }

  /** Valide le curseur de transfert d'argent (positif : vers Paris). */
  applyMoney(amount: number) {
    const p = this.pending;
    if (!p?.apply) return;
    this.pending = null;
    const a = Math.trunc(amount);
    this.cardLog(
      a === 0
        ? '▸ Ne rien transférer'
        : a > 0
          ? `▸ Déposer ${a} F à Paris`
          : `▸ Retirer ${-a} F de Paris`,
    );
    p.apply(a);
    this.save();
  }

  private ask(title: string, options: { label: string; run: () => void }[], extra?: Partial<Pending>) {
    this.pending = { title, options, ...extra };
  }

  // ---------- We Were There! ----------

  /**
   * « We Were There! » (V.I) : d'autres Grognards non absents peuvent avoir pris
   * part à l'événement. Chacun lance 1D10 ; le résultat doit être inférieur ou
   * égal au nombre de Grognards en jeu. Un théâtre séparé — l'Orient, l'Espagne —
   * ne se mêle pas de ce qui se passe ailleurs, et certaines cartes n'admettent
   * qu'une armée donnée.
   */
  private startWWT(entry: DeckEntry, wwt: boolean | { restrictedTo?: string }) {
    if (this.chars.length < 2) return;
    const drawer = this.ch;
    const restricted: string | null = typeof wwt === 'object' ? wwt.restrictedTo ?? null : null;
    const theatre = (c: Character) =>
      c.assignment === 'army-orient' ? 'orient'
        : c.assignment.startsWith('army-andalusia') || c.assignment.startsWith('army-castille')
          || c.assignment.startsWith('army-portugal') || c.assignment.startsWith('army-catalonia') ? 'espagne'
          : 'principal';
    const here = theatre(drawer);
    const queue: number[] = [];
    this.chars.forEach((c, i) => {
      if (i === this.active) return;
      if (c.absent) return;
      if (theatre(c) !== here) return;
      if (restricted && c.assignment !== restricted) return;
      queue.push(i);
    });
    if (!queue.length) return;
    this.wwtQueue = queue;
    this.wwtCard = entry;
    this.wwtDrawer = this.active;
    this.add('We Were There ! Qui d’autre y était ?', 'phase');
    this.processWWT();
  }

  private processWWT() {
    const n = this.chars.length;
    while (this.wwtQueue.length) {
      this.active = this.wwtQueue.shift()!;
      const r = d10(this.rng);
      if (r > n) {
        this.add(`We Were There ! 1D10=${r} > ${n} — il n’y était pas.`, this.ch.bot ? 'info' : 'roll');
        continue;
      }
      if (!this.ch.bot) this.who();
      this.add(`We Were There ! 1D10=${r} ≤ ${n} — il y était.`, this.ch.bot ? 'info' : 'roll');
      const card = this.wwtCard!;
      if (card.kind === 'garrison-event') this.resolveGarrisonEvent(card.card);
      else if (card.kind === 'campaign-event') this.resolveCampaignEvent(card.card);
      this.resolveBotPending();
      if (this.pending) return; // le joueur doit trancher
    }
    this.wwtCard = null;
    this.active = this.wwtDrawer;
  }

  // ---------- ordre du tour ----------

  /**
   * Le Senior Grognard est le non-absent au plus haut grade ; à égalité on
   * descend la feuille : notice, gloire, expérience, argent, santé, charme, escrime.
   */
  seniorIndex(): number {
    const rank = (c: Character) => (c.marechal ? RANKS.length : c.rankIdx);
    const keys = (c: Character): number[] => [
      rank(c), c.N, c.G, c.E, c.mParis + c.mPurse, c.H, c.C, c.F,
    ];
    let best = 0;
    for (let i = 1; i < this.chars.length; i++) {
      const a = this.chars[i];
      const b = this.chars[best];
      if (!!a.absent !== !!b.absent) { if (!a.absent) best = i; continue; }
      const ka = keys(a);
      const kb = keys(b);
      for (let k = 0; k < ka.length; k++) {
        if (ka[k] !== kb[k]) { if (ka[k] > kb[k]) best = i; break; }
      }
    }
    return best;
  }

  /** Ordre de jeu affiché : le senior d'abord, puis dans le sens horaire. */
  turnOrder(): number[] {
    return this.buildTurnQueue(true);
  }

  /**
   * Qui retourne la prochaine carte. L'interface ne doit surtout pas le
   * redéduire : la pioche part à gauche du senior, et le senior est celui *figé*
   * pour le round, non le mieux classé de l'instant. Se tromper ici revient à
   * offrir un bouton là où le joueur attend un dos de carte.
   */
  nextDrawer(): number {
    return this.turnQueue.length ? this.turnQueue[0] : this.buildTurnQueue()[0];
  }

  /**
   * Fixe le Senior Grognard pour la durée d'un segment ou d'un round.
   * La règle est explicite : « il garde cette position pour tout le segment ou
   * le round », même si un autre le dépasse entre-temps.
   */
  private fixSenior() {
    this.senior = this.seniorIndex();
  }

  /** File des Grognards, à partir du senior ou de son voisin de gauche. */
  private buildTurnQueue(fromSenior = false): number[] {
    const n = this.chars.length;
    const start = fromSenior ? this.senior : (this.senior + 1) % n;
    return Array.from({ length: n }, (_, k) => (start + k) % n);
  }

  /** Un bot tranche seul : on applique sa politique tant qu'on l'interroge. */
  private resolveBotPending() {
    let guard = 0;
    while (this.pending && this.ch.bot && guard++ < 30) {
      const pend = this.pending;
      if (pend.kind === 'money') { this.applyMoney(botMoneyTransfer(this.ch)); continue; }
      const offender = this.challengeable();
      this.choose(botChoice(pend, this.ch, {
        engaged: this.activeCommands().has(this.ch.assignment),
        duelFavorable: offender >= 0 && acceptsDuel(this.ch, this.chars[offender]),
        rng: this.rng,
      }));
    }
  }

  /**
   * Fait jouer la phase `fn` à chaque Grognard tour à tour.
   * S'arrête dès qu'un humain doit décider ; `advance()` reprendra la file.
   */
  private eachGrognard(fn: () => void): boolean {
    while (this.turnQueue.length) {
      this.active = this.turnQueue[0];
      this.turnQueue.shift();
      if (this.chars.length > 1 && !this.ch.bot) this.who();
      fn();
      this.resolveBotPending();
      this.flushBrief();
      if (this.pending) return false; // le joueur doit trancher
    }
    this.active = 0;
    return true;
  }

  /** Signale au journal de qui il est question. */
  private who() {
    /* l'auteur est porté par chaque entrée : plus besoin d'une ligne pour lui */
  }

  /**
   * Ligne condensée d'un concurrent : elle contourne la mise en attente. Le nom
   * n'y figure pas — le journal le porte en pastille, en tête du groupe.
   */
  private brief(text: string, actor = this.active) {
    this.log.push({ t: text, cls: 'info', actor });
    this.snaps.push(
      this.chars.map((c) => ({ ...c, flags: { ...c.flags }, absent: c.absent ? { ...c.absent } : null })),
    );
  }

  /** Rend en une ligne ce qu'un concurrent vient de faire. */
  private flushBrief() {
    if (!this.briefBuf.length) { this.briefActor = null; return; }
    const parts = this.briefBuf.splice(0);
    const qui = this.briefActor ?? this.active;
    this.briefActor = null;
    this.brief(parts.join(' · '), qui);
  }

  /** Vrai si l'on doit détailler : le joueur seul a droit aux jets commentés. */
  private get verbose(): boolean {
    return !this.ch.bot;
  }

  // ---------- segment ----------
  private stepSegment() {
    // une phase entamée continue jusqu'au bout de sa file
    if (this.turnQueue.length) {
      const cur = SEGMENT_PHASES[this.sub - 1];
      this.eachGrognard(() => this.segmentPhaseFor(cur));
      return;
    }
    const ph = SEGMENT_PHASES[this.sub];
    if (!ph) { this.stage = 'round-start'; this.sub = 0; return; }
    if (this.sub === 0) this.fixSenior();
    this.sub++;
    this.turnQueue = this.buildTurnQueue(true);
    this.phase(SEGMENT_HEADERS[ph]);
    this.eachGrognard(() => this.segmentPhaseFor(ph));
  }

  private segmentPhaseFor(ph: (typeof SEGMENT_PHASES)[number]) {
    switch (ph) {
      case 'money': {
        const ch = this.ch;
        if (ch.absent?.type === 'death') { this.info('Mort : pas de finances.'); break; }
        if (ch.absent?.type === 'prisoner') {
          this.info('Prisonnier : aucun transfert possible.');
          this.applyTax();
          break;
        }
        const opts: PendingOption[] = [
          { label: 'Ne rien transférer', run: () => this.applyTax() },
        ];
        if (!ch.absent) {
          opts.push({
            label: '🏡 Prendre sa retraite volontaire (toute la saison)',
            run: () => {
              this.ch.absent = { type: 'retirement', fresh: true };
              if (this.ch.office) { this.ch.office = false; this.info('Office perdu (retraite).'); }
              this.warn('Retiré dans ses terres pour la saison.');
              this.applyTax();
            },
          });
        }
        this.ask(
          'Finances — ce qui reste à Paris sera imposé de 10 %',
          opts,
          {
            kind: 'money',
            data: { paris: ch.mParis, purse: ch.mPurse },
            // montant positif : bourse vers Paris ; négatif : Paris vers bourse
            apply: (amount: number) => { this.moveMoney(amount); this.applyTax(); },
          },
        );
        break;
      }
      case 'aging': {
        // (rien à faire ici pour l'argent)
        if (this.ch.absent?.type === 'death') break;
        this.announce('Vieillissement — la santé baisse de 1D10 ÷ 3 (donc 0 à 3 points)');
        const r = d10(this.rng);
        const loss = Math.floor(r / 3);
        this.roll(`1D10=${r} → santé −${loss}`);
        if (loss > 0) this.applyStat('H', -loss);
        break;
      }
      case 'assignment': this.assignmentPhase(); break;
      case 'glory': {
        if (this.ch.loh > 0 && !this.ch.armsOfHonor && !this.ch.absent) {
          this.applyStat('G', LOH_LEVELS[this.ch.loh - 1].glory, 'Légion d’Honneur');
        } else this.info('Rien à glaner.');
        break;
      }
    }
  }

  private assignmentPhase() {
    // captivités imposées par la fiche d'affectation
    this.checkForcedCaptivity();
    // retours d'absence en début de saison : pas de réaffectation dans le même segment
    if (this.handleSeasonStartReturns()) return;
    if (this.ch.absent) { this.info('Absent : pas de réaffectation.'); return; }

    // réorganisation de l'armée : le commandement change de nom, ou disparaît
    if (!this.applyArmyReorganization()) return;

    // saisons XV-XVI : demande de transfert vers la Garde Impériale
    this.maybeImperialGuard(() => this.reassignmentCheck());
  }

  /** Demande de transfert vers la Garde Impériale (IV.E), saisons XV et XVI. */
  private maybeImperialGuard(next: () => void) {
    const ch = this.ch;
    if ((this.season !== 15 && this.season !== 16) || ch.absent || ch.assignment === 'imperial-guard') {
      next();
      return;
    }
    const auto = ch.nonDuelWounds >= 5;
    const target = Math.ceil(ch.N / 25) + ch.loh;
    this.ask('Demander un transfert vers la Garde Impériale ?', [
      {
        label: auto
          ? 'Demander la Garde (accordé d’office : 5 blessures au service de la France)'
          : `Demander la Garde (1D10 ≤ N÷25↑ + LoH = ${target})`,
        run: () => {
          if (auto) {
            ch.assignment = 'imperial-guard';
            this.title('🦅 Ses cicatrices parlent pour lui : Garde Impériale !');
            this.rollStanding('Garde Impériale');
            return;
          }
          const r = d10(this.rng);
          if (r <= target) {
            ch.assignment = 'imperial-guard';
            this.roll(`Garde Impériale : 1D10=${r} ≤ ${target} — accepté !`);
            this.title('🦅 Il coiffe le bonnet à poil : Garde Impériale !');
            this.rollStanding('Garde Impériale');
          } else {
            this.roll(`Garde Impériale : 1D10=${r} > ${target} — refusé.`);
            next();
          }
        },
      },
      { label: 'Rester dans son commandement', run: next },
    ]);
  }

  /** Jet de réaffectation involontaire du segment. */
  private reassignmentCheck() {
    const threshold = this.reassignThreshold();
    const forcedRank = ['colonel', 'general-de-brigade', 'general-de-division', 'general'].includes(this.rank().id) || this.ch.marechal;
    this.announce(forcedRank
      ? 'Réaffectation ? — un officier supérieur change de poste sur 1D10 de 1 à 3'
      : `Réaffectation ? — muté si 1D10 atteint ${threshold} (seuil de son standing)`);
    const r = d10(this.rng);
    const forced = ['colonel', 'general-de-brigade', 'general-de-division', 'general'].includes(this.rank().id) || this.ch.marechal;
    let reassigned: boolean;
    if (forced) {
      reassigned = r <= 3;
      this.roll(`1D10=${r} → ${reassigned ? 'réaffecté' : 'maintenu'}`);
    } else {
      reassigned = r >= threshold;
      this.roll(`1D10=${r} vs ${threshold} → ${reassigned ? 'réaffecté' : 'maintenu'}`);
    }
    if (reassigned) this.reassign();
  }

  private commandExistsThisSeason(cmd: string): boolean {
    return commandsForSeason(this.season).includes(cmd);
  }

  /**
   * Applique la réorganisation de l'armée entre deux saisons.
   * Un commandement « becomes » un autre : le Grognard suit, puis fait son jet normal.
   * Un commandement dissous : réaffectation au hasard, sans second jet.
   * Renvoie false si la phase est terminée.
   */
  private applyArmyReorganization(): boolean {
    const ch = this.ch;
    if (this.season < 2) return true;
    const prevKey = assignmentKey(this.season - 1);
    if (prevKey === assignmentKey(this.season)) {
      // même tableau qu'à la saison précédente : rien ne change de nom
      if (this.commandExistsThisSeason(ch.assignment)) return true;
    }
    const prevRow = (ASSIGNMENTS[prevKey] ?? []).find((r) => r.cmd === ch.assignment);

    // cas particulier : l'Armée du Centre se scinde en deux à la fin de la saison I
    if (ch.assignment === 'army-center') {
      const r = d10(this.rng);
      const dest = r % 2 === 1 ? 'army-sambre-meuse' : 'army-rhine-moselle';
      this.roll(`Dislocation de l’Armée du Centre : 1D10=${r} (${r % 2 === 1 ? 'impair' : 'pair'}) → ${commandName(dest)}`);
      ch.assignment = dest;
      this.info('Pas de jet de réaffectation cette saison.');
      return false;
    }

    if (prevRow?.becomes) {
      ch.assignment = prevRow.becomes;
      this.info(`Son commandement devient ${commandName(prevRow.becomes)}.`);
      return true; // il fait quand même son jet de réaffectation
    }

    if (!this.commandExistsThisSeason(ch.assignment)) {
      this.warn(`${commandName(ch.assignment)} est dissous : réorganisation de l’armée.`);
      this.reassign(false);
      return false; // pas de second jet
    }
    return true;
  }

  /** Captivités imposées par les notes de la fiche d'affectation (V/VII Corps, IV/XI Corps). */
  private checkForcedCaptivity() {
    const ch = this.ch;
    if (ch.absent?.type === 'death') return;
    if (this.season === 15 && ['corps-5', 'corps-7'].includes(ch.assignment)) {
      this.warn(`${commandName(ch.assignment)} a capitulé : prisonnier pour toute la saison XV.`);
      this.becomePrisoner();
      ch.assignment = '';
    }
  }

  private reassignThreshold(): number {
    const s = this.ch.standing;
    return s === 5 ? 10 : s + 5;
  }

  /** Commandements engagés dans une bataille de la saison en cours. */
  activeCommands(season = this.season): Set<string> {
    const def = SEASONS[season - 1];
    const out = new Set<string>();
    for (const ids of Object.values(def.events) as string[][]) {
      for (const id of ids) {
        const ev = CAMPAIGN_EVENTS.find((e) => e.id === id);
        if (!ev) continue;
        const cmds: string[] = ev.commands ?? (ev.subEvents ?? []).flatMap((x) => x.commands ?? []);
        for (const c of cmds) out.add(c);
      }
    }
    return out;
  }

  /**
   * Commandements dont Napoléon ou Bonaparte est le chef : un Grognard général
   * ou maréchal ne peut pas y être le commandant en titre.
   */
  private precludedForGeneral(cmd: string): boolean {
    if (!this.isGeneralOfficer() || !['general', 'marechal'].includes(this.ch.marechal ? 'marechal' : this.rank().id)) {
      return false;
    }
    if (cmd === 'army-italy' && (this.season === 2 || this.season === 3)) return true;
    if (cmd === 'army-orient' && this.season === 4) return true;
    if (cmd === 'army-reserve' && this.season === 5) return true;
    return false;
  }

  /** Réaffectation au hasard. Le standing est toujours relancé ; c'est le second jet de transfert qui saute. */
  reassign(_unused?: boolean) {
    let r = d100(this.rng);
    let row = assignmentFor(this.season, r);
    let guard = 0;
    while (this.precludedForGeneral(row.cmd) && guard++ < 30) {
      this.roll(`Nouvelle affectation : 2D10=${r} → ${commandName(row.cmd)} — déjà commandée en chef, on relance.`);
      r = d100(this.rng);
      row = assignmentFor(this.season, r);
    }
    this.ch.assignment = row.cmd;
    this.roll(`Nouvelle affectation : 2D10=${r} → ${commandName(row.cmd)}`);
    this.rollStanding('réaffectation');
  }

  /** Retours d'absence. Renvoie true si le Grognard vient de rentrer : pas de jet de réaffectation. */
  private handleSeasonStartReturns(): boolean {
    const a = this.ch.absent;
    if (!a) return false;
    if (a.type === 'death') { this.reviveFromDeath(); return true; }
    if (a.type === 'retirement') {
      if (a.fresh) { a.fresh = undefined; return false; }
      if (this.ch.H >= 1) {
        this.ask('Sortir de retraite ?', [
          { label: 'Revenir au service', run: () => { this.ch.absent = null; this.info('Retour de retraite.'); this.reassign(); } },
          { label: 'Prolonger la retraite une saison', run: () => this.info('Il reste sur la retired list.') },
        ]);
        return true;
      }
      this.warn('Toujours en retraite (santé 0).');
      return false;
    }
    if (a.type === 'prisoner') this.warn('Toujours prisonnier (pas d’échange).');
    return false;
  }

  /** Transfert d'argent : positif = bourse → Paris, négatif = Paris → bourse. */
  private moveMoney(amount: number) {
    if (amount > 0) { this.applyStat('M', -amount, 'transfert'); this.applyStat('MParis', amount, 'transfert'); }
    else if (amount < 0) { this.applyStat('MParis', amount, 'transfert'); this.applyStat('M', -amount, 'transfert'); }
  }

  private applyTax() {
    const tax = Math.floor(this.ch.mParis * 0.1);
    if (tax > 0) this.applyStat('MParis', -tax, 'impôt (10 %)');
    else this.info('Pas d’impôt (Paris trop pauvre).');
  }

  private reviveFromDeath() {
    const ch = this.ch;
    // un fils ou un neveu reprend le nom : prénoms neufs, patronyme intact
    const heir = heirOf(ch.name, this.rng);
    this.title(`Un parent reprend le flambeau : ${heir.full}.`);
    for (const st of heir.steps) this.info(st);
    ch.name = heir.full;
    const red = (v: number) => Math.ceil(v * 0.75);
    ch.N = red(ch.N); ch.G = red(ch.G); ch.E = red(ch.E);
    ch.mParis = red(ch.mParis); ch.mPurse = red(ch.mPurse); ch.C = red(ch.C); ch.F = red(ch.F);
    this.info(
      'Qualités réduites à 75 %',
      `N ${ch.N} · G ${ch.G} · E ${ch.E} · Paris ${ch.mParis} F · Bourse ${ch.mPurse} F · C ${ch.C} · F ${ch.F}`,
    );
    // grade recalculé
    let idx = 0;
    for (let i = RANKS.length - 2; i >= 0; i--) {
      const p = RANKS[i].promotion;
      if (!p) continue;
      const needN = this.season >= 6 ? p.N : 0;
      if (ch.N >= needN && ch.G >= p.G && ch.E >= p.E) { idx = i; break; }
    }
    ch.rankIdx = idx; ch.marechal = false;
    this.info(`Grade au retour : ${RANKS[idx].name}`);
    ch.H = Math.max(30, 85 - d10(this.rng));
    this.info(`Santé : ${ch.H} (adaptation solo)`);
    if (ch.loh > 0) { ch.loh--; this.info(`Légion d’Honneur réduite d’un niveau (${ch.loh}).`); }
    ch.office = false; ch.title = null;
    ch.absent = null;
    this.reassign(true);
  }

  // ---------- rounds ----------
  private stepRoundStart() {
    const code = this.roundCode();
    if (/#/.test(code)) {
      // round exclusivement espagnol : le temps passe quand même (étapes 0-1)
      if (this.sub === 0) {
        this.title(`Round ${code}`, 'Opérations en Espagne');
        this.info('Aucun Grognard en Espagne : seules les rigueurs de la campagne s’appliquent.');
        if (!this.ch.absent || this.ch.absent.type === 'prisoner') this.applyStat('H', -1, 'rigueurs de la campagne');
        this.sub++;
        return;
      }
      this.stage = 'round-over';
      this.sub = 0;
      return;
    }
    if (this.turnQueue.length) {
      const cur = ROUND_START_PHASES[this.sub - 1];
      this.eachGrognard(() => this.roundPhaseFor(cur, code));
      return;
    }
    const ph = ROUND_START_PHASES[this.sub];
    if (!ph) {
      this.stage = 'draw';
      this.sub = 0;
      this.turnQueue = this.buildTurnQueue(); // la pioche commence à gauche du senior
      return;
    }
    if (this.sub === 0) {
      this.fixSenior();
      this.title(`Round ${code}`, this.isCampaignRound(code) ? 'On Campaign' : 'In Garrison');
    }
    this.sub++;
    if (ph === 'deck') { this.active = this.senior; this.buildDeck(code); return; }
    this.turnQueue = this.buildTurnQueue(true);
    this.phase(
      ph === 'furlough'
        ? this.isCampaignRound(code) ? 'Retour de permission' : 'Permission ?'
        : ph === 'recovery'
          ? this.isCampaignRound(code) ? 'Recovery & Health Phase' : 'Recovery Phase'
          : 'Income Phase',
    );
    this.eachGrognard(() => this.roundPhaseFor(ph, code));
  }

  private roundPhaseFor(ph: (typeof ROUND_START_PHASES)[number], code: string) {
    switch (ph) {
      case 'furlough': this.furloughPhase(code); break;
      case 'recovery': this.recoveryPhase(code); break;
      case 'income': this.incomePhase(); break;
      case 'deck': break;
    }
  }

  /** Étape 1 du round de garnison : entrer, poursuivre ou quitter la permission. */
  private furloughPhase(code: string) {
    const ch = this.ch;
    if (this.isCampaignRound(code)) {
      if (ch.absent?.type === 'furlough') {
        ch.absent = null;
        this.info('La permission prend fin : il rejoint son commandement.');
      } else this.info('Rien à signaler.');
      return;
    }
    // seuls les Grognards au service ou déjà en permission peuvent décider
    if (ch.absent && ch.absent.type !== 'furlough') { this.info('Absent : sans objet.'); return; }
    if (this.season === 16 && ch.flags.bonapartist && !ch.flags.marchedOnParis) { this.info('Sans objet.'); return; }

    // le libellé du choix dit déjà tout : rien ne se répète en dessous
    if (ch.absent?.type === 'furlough') {
      this.ask('Permission en cours', [
        { label: 'Poursuivre la permission (S−1)', run: () => { this.applyStat('S', -1, undefined, true); } },
        { label: 'Reprendre le service', run: () => { ch.absent = null; } },
      ]);
    } else {
      this.ask('Prendre une permission ?', [
        { label: 'Rester au service', run: () => {} },
        {
          label: 'Partir en permission (S−1, solde de moitié)',
          run: () => {
            ch.absent = { type: 'furlough' };
            this.applyStat('S', -1, undefined, true);
          },
        },
      ]);
    }
  }

  private recoveryPhase(code: string) {
    const campaign = this.isCampaignRound(code);
    const a = this.ch.absent;
    if (a && (a.type === 'convalescence' || a.alsoConvalescing)) {
      const rounds = a.convRounds ?? 0;
      const mult = a.convMult ?? 3;
      const bonus = rounds * mult;
      this.announce(
        `Récupération ? — rétabli si 1D10 + ${bonus} atteint 10` +
          (bonus > 0
            ? ` (${rounds} round${rounds > 1 ? 's' : ''} de convalescence × ${mult})`
            : ' — il faut donc un 10'),
      );
      const r = d10(this.rng);
      const total = r + bonus;
      this.roll(`1D10=${r} + ${bonus} = ${total}`);
      if (total >= 10) {
        if (a.type === 'convalescence') { this.ch.absent = null; this.info('Rétabli ! Retour au jeu.'); }
        else { a.alsoConvalescing = false; this.info('Rétabli, mais toujours prisonnier.'); }
      } else {
        a.convRounds = rounds + 1;
        this.warn('Toujours en convalescence.');
      }
    }
    if (campaign && (!this.ch.absent || this.ch.absent.type === 'prisoner')) {
      this.applyStat('H', -1, 'rigueurs de la campagne');
    }
  }

  private incomePhase() {
    const ch = this.ch;
    if (ch.absent?.type === 'death') { this.info('Mort : aucun revenu.'); return; }
    let rankM = ch.marechal ? 22 : this.rank().income;
    if (ch.assignment === 'imperial-guard') rankM = Math.ceil(rankM * 1.5);
    let officeM = ch.office ? 10 : 0;
    if (ch.absent) { rankM = Math.floor(rankM / 2); officeM = Math.floor(officeM / 2); }
    if (ch.absent?.type === 'retirement') { rankM = Math.floor((ch.marechal ? 22 : this.rank().income) / 2); officeM = 0; }
    const titleM = ch.title === 'prince' ? 35 : ch.title === 'duc' ? 25 : ch.title === 'comte' ? 15 : 0;
    const lohM = ch.loh > 0 && !ch.armsOfHonor ? LOH_LEVELS[ch.loh - 1].income : 0;
    const total = rankM + officeM + titleM + lohM;
    const dest = ch.absent?.type === 'prisoner' ? 'MParis' : 'M';
    // Une seule ligne, de la même forme que la récupération — « Bourse +4 → 9 » —
    // et le calcul derrière, à dérouler d'un clic.
    const prop = dest === 'MParis' ? 'mParis' : 'mPurse';
    const before = ch[prop];
    if (total > 0) this.applyStat(dest, total, 'solde', true);
    const gained = ch[prop] - before;
    this.add(
      `${dest === 'MParis' ? 'Paris' : 'Bourse'} +${gained} → ${ch[prop]}`
        + (dest === 'MParis' ? ' (prisonnier : versé à Paris)' : ''),
      gained > 0 ? 'gain' : 'info',
      undefined,
      `grade ${rankM} · office ${officeM} · titre ${titleM} · Légion d’Honneur ${lohM} = ${total} F`,
    );
  }

  private buildDeck(code: string) {
    const campaign = this.isCampaignRound(code);
    let seasonEvents: string[] = (this.seasonDef().events[code] ?? []).filter((id: string) => !this.removed.has(id));
    // Cent-Jours : seule Ligny entre dans le deck ; Quatre Bras, Wavre et Waterloo s'enchaînent après elle
    if (code === 'XVI-A') seasonEvents = seasonEvents.filter((id) => id === 'battle-of-ligny');
    const eventCards: DeckEntry[] = [];
    for (const id of seasonEvents) {
      if (id === 'round-ends-card') {
        const c = GARRISON_EVENTS.find((x) => x.id === 'round-ends-card');
        if (c) eventCards.push({ kind: 'garrison-event', card: c });
        continue;
      }
      const ge = GARRISON_EVENTS.find((x) => x.id === id);
      if (ge) { eventCards.push({ kind: 'garrison-event', card: ge }); continue; }
      const ce = CAMPAIGN_EVENTS.find((x) => x.id === id);
      if (ce) eventCards.push({ kind: 'campaign-event', card: ce });
    }
    const pool: DeckEntry[] = [];
    const pushCopies = (entry: DeckEntry) => {
      const copies = typeof entry.card.copies === 'number' ? entry.card.copies : 1;
      for (let i = 0; i < copies; i++) pool.push(entry);
    };
    if (!campaign) {
      for (const c of GARRISON_CARDS) {
        if (c.id === 'round-ends-card') continue;
        if (!this.cardAllowed(c)) continue;
        if (this.removed.has(c.id) || this.pausedCards.has(c.id)) continue;
        if (c.etienneGerard && (this.season < 7 || this.playedEGOnce.has(c.id))) continue;
        if (c.id === 'you-are-accused' && (this.season > 6 || (this.season === 6 && this.roundIdx >= 3))) continue;
        pushCopies({ kind: 'garrison', card: c });
      }
      for (const c of IDLE_TIME_CARDS) pool.push({ kind: 'garrison', card: { ...c, name: 'Idle Time', idleTime: true } });
    } else {
      for (const c of CAMPAIGN_CARDS) {
        if (!this.cardAllowed(c)) continue;
        if (this.removed.has(c.id)) continue;
        if (c.etienneGerard && (this.season < 7 || this.playedEGOnce.has(c.id))) continue;
        pushCopies({ kind: 'campaign', card: c });
      }
    }
    // mélange
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const fillCount = Math.max(0, this.cardsPerRound * this.chars.length - eventCards.length);
    this.deck = [...eventCards, ...pool.slice(0, fillCount)];
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
    this.eventsRemaining = eventCards.length;
    this.cardNumInRound = 0;
    this.cardsByPlayer = this.chars.map(() => 0);
    this.turnQueue = [];
    this.drawnThisRound = [];
    this.roundEnded = false;
    // le compte du deck appartient à l'en-tête : c'est un fait du round, non
    // d'un Grognard, et le filtre des concurrents l'aurait égaré ailleurs
    this.add(
      'Deck Phase',
      'phase',
      undefined,
      `${this.deck.length} cartes · ${eventCards.length} event${eventCards.length > 1 ? 's' : ''}`,
    );
  }

  private stepDraw() {
    if (this.roundEnded || this.deck.length === 0) {
      // le round se ferme : la table se débarrasse aussi de la carte Combat,
      // qui restait sinon affichée jusqu'au prochain tirage
      this.currentCard = null;
      this.combatCard = null;
      this.battleCards = [];
      this.stage = 'round-over';
      this.sub = 0;
      return;
    }
    // à qui le tour ? la rotation repart quand elle est épuisée
    if (!this.turnQueue.length) this.turnQueue = this.buildTurnQueue();
    this.active = this.turnQueue.shift()!;
    this.turnHolder = this.active;
    if (this.chars.length > 1) this.who();
    const entry = this.deck.shift()!;
    this.currentCard = entry;
    this.combatCard = null;
    this.drawnThisRound.push({ id: entry.card.id, name: entry.card.name });
    this.cardNumInRound++;
    this.cardsByPlayer[this.active] = (this.cardsByPlayer[this.active] ?? 0) + 1;
    const isEvent = entry.kind.endsWith('event');
    this.cardLog(`${entry.card.name}${isEvent ? ' (Event)' : ''}`, entry.card.id);
    if (isEvent) this.eventsRemaining--;
    this.resolveEntry(entry);
    this.resolveBotPending();
    this.flushBrief();
  }

  private nextRound() {
    this.title(`Fin du round ${this.roundCode()}`);
    // Le tour perdu au zèle, à la vérole ou à la prison ne vaut que pour ce round :
    // si la carte annulée n'a pas été tirée avant la fin, la dette s'éteint.
    for (const c of this.chars) {
      c.flags.skipNextCard = undefined;
      c.flags.skipReason = undefined;
    }
    this.roundIdx++;
    if (this.roundIdx >= this.seasonDef().rounds.length) { this.stage = 'season-end'; this.sub = 0; }
    else { this.stage = 'round-start'; this.sub = 0; }
  }

  private endSeason() {
    this.title(`Fin de la saison ${this.seasonDef().roman}`);
    // Échange de prisonniers — pour tous : un concurrent oublié en captivité
    // n'en sortait jamais, et la carrière se terminait derrière les barreaux.
    this.chars.forEach((c, i) => {
      if (c.absent?.type !== 'prisoner') return;
      if (this.season === 14) {
        if (i === 0) this.warn('Pas d’échange de prisonniers entre les saisons XIV et XV.');
        return;
      }
      this.asActor(i, () => {
        this.info('Échange de prisonniers : retour au commandement.');
        if (c.absent!.alsoConvalescing) c.absent = { type: 'convalescence', convMult: c.absent!.convMult, convRounds: c.absent!.convRounds };
        else c.absent = null;
        if (c.H <= 0) this.healthZero();
      });
    });
    if (this.season >= 16) { this.finishGame(); this.closeSeasonChronicle(); return; }
    this.closeSeasonChronicle();
    // la beuverie ne se tient qu'une fois par saison : la carte revient
    this.pausedCards.clear();
    this.season++;
    this.openSeasonChronicle();
    this.roundIdx = 0;
    this.title(`Saison ${this.seasonDef().roman}`, `${this.seasonDef().name} · ${this.seasonDef().years}`);
    this.stage = 'segment';
    this.sub = 0;
  }

  private finishGame() {
    // la Restauration règle ses comptes avec chaque Bonapartiste (sauf victoire)
    const here = this.active;
    for (let i = 0; i < this.chars.length; i++) {
      this.active = i;
      if (this.ch.flags.bonapartist && !this.victory) {
        if (this.chars.length > 1) this.who();
        this.bourbonPersecution();
      }
    }
    this.active = here;
    this.over = true;
    this.stage = 'game-over';
    this.title('🏁 Fin de la partie', this.victory ? 'L’Empire triomphe !' : '1815'); 
    const ch = this.ch;
    this.info(`Grade final : ${this.rankName()}${ch.title ? ` · ${ch.title}` : ''}`);
    this.info(`Gloire ${ch.G} · Légion d’Honneur niveau ${ch.loh} · Fortune ${ch.mParis + ch.mPurse} F`);
    this.info(`Score de carrière : ${this.finalScore().total}`);
    if (this.chars.length > 1) {
      this.title('Décompte des points de victoire');
      for (const r of this.victoryPoints()) {
        this.info(`${r.vp} pt${r.vp > 1 ? 's' : ''} — ${r.ch.name}${r.ch.bot ? '' : ' (vous)'}` +
          (r.wins.length ? ` : ${r.wins.join(', ')}` : ''));
      }
      const top = this.victoryPoints()[0].vp;
      const winners = this.victoryPoints().filter((r) => r.vp === top);
      this.title(winners.length > 1
        ? `Ex æquo : ${winners.map((w) => w.ch.name).join(' et ')} entrent ensemble au Panthéon.`
        : `${winners[0].ch.name} l'emporte.`);
    }
  }

  /** Persécution des Bourbons (XXI.F) après la défaite de Waterloo. */
  private bourbonPersecution() {
    const ch = this.ch;
    this.title('⚖ La Restauration demande des comptes.');
    this.announce('Persécution des Bourbons ? — épargné à partir de 5 sur 1D10 modifié');
    const raw = d10(this.rng);
    let r = raw;
    const mods: string[] = [];
    if (ch.flags.regicide) { r -= 1; mods.push('régicide −1'); }
    if (ch.flags.turncoat) { r -= 1; mods.push('retourné de veste −1'); }
    if (ch.flags.marchedOnParis) { r -= 1; mods.push('marche sur Paris −1'); }
    this.roll(`Persécution : 1D10=${raw}${mods.length ? ` (${mods.join(', ')})` : ''} → ${r}`);
    if (r >= 5) { this.info('Les Bourbons passent leur chemin : nulle poursuite.'); return; }
    if (r <= 1) {
      this.warn('☠ Exécuté par la vengeance des Bourbons !');
      ch.deaths++;
      const red = (v: number) => Math.ceil(v * 0.75);
      ch.N = red(ch.N); ch.G = red(ch.G); ch.E = red(ch.E);
      ch.mParis = red(ch.mParis); ch.mPurse = red(ch.mPurse);
      if (ch.loh > 0) ch.loh--;
      ch.title = null; ch.office = false;
      this.info('Un héritier portera son nom devant la postérité (qualités réduites à 75 %).');
      return;
    }
    if (r === 2) {
      this.warn('Cassé : rayé des cadres de l’armée, sans grade.');
      ch.rankIdx = 0;
      ch.marechal = false;
    }
    if (r <= 3) {
      this.warn('Privé de ses domaines : la moitié de sa fortune est confisquée.');
      ch.mParis = Math.floor(ch.mParis / 2);
      ch.mPurse = Math.floor(ch.mPurse / 2);
    }
    if (ch.title || ch.office) this.warn('Honneurs confisqués : titres et offices perdus.');
    ch.title = null;
    ch.office = false;
  }

  // ---------- chroniques de saison ----------

  /** Un paragraphe par saison écoulée, consultable après coup. */
  chronicles: Chronicle[] = [];
  seasonMark = 0;
  seasonStart: Character | null = null;

  private openSeasonChronicle() {
    this.seasonMark = this.log.length;
    const ch = this.ch;
    this.seasonStart = { ...ch, flags: { ...ch.flags }, absent: ch.absent ? { ...ch.absent } : null };
  }

  /** Clôt la saison en cours et en range le récit. */
  private closeSeasonChronicle() {
    this.chronicles.push(writeChronicle({
      season: this.season,
      def: this.seasonDef(),
      lines: this.log.slice(this.seasonMark),
      before: this.seasonStart,
      ch: this.ch,
    }));
  }

  /**
   * Décompte officiel (XXII) : un point par catégorie — plus haut grade
   * (départagé par le titre), plus de gloire, plus haut niveau de Légion
   * d'Honneur, plus grande fortune. Les ex æquo marquent chacun leur point.
   */
  victoryPoints(): { ch: Character; vp: number; wins: string[] }[] {
    const titleRank = (t: string | null) => (t === 'prince' ? 3 : t === 'duc' ? 2 : t === 'comte' ? 1 : 0);
    const cats: { key: string; of: (c: Character) => number }[] = [
      { key: 'grade', of: (c) => (c.marechal ? RANKS.length : c.rankIdx) * 10 + titleRank(c.title) },
      { key: 'gloire', of: (c) => c.G },
      { key: 'Légion d’Honneur', of: (c) => c.loh },
      { key: 'fortune', of: (c) => c.mParis + c.mPurse },
    ];
    const out = this.chars.map((ch) => ({ ch, vp: 0, wins: [] as string[] }));
    for (const cat of cats) {
      const best = Math.max(...this.chars.map(cat.of));
      out.forEach((o) => {
        if (cat.of(o.ch) === best) { o.vp++; o.wins.push(cat.key); }
      });
    }
    return out.sort((a, b) => b.vp - a.vp);
  }

  /** Score de carrière (adaptation solo du décompte multijoueur). */
  finalScore(): { rank: number; glory: number; loh: number; fortune: number; titles: number; victory: number; total: number } {
    const ch = this.ch;
    const titleBonus = ch.title === 'prince' ? 30 : ch.title === 'duc' ? 20 : ch.title === 'comte' ? 10 : 0;
    const parts = {
      rank: ch.rankIdx * 15 + (ch.marechal ? 25 : 0),
      glory: ch.G,
      loh: ch.loh * 12,
      fortune: Math.floor((ch.mParis + ch.mPurse) / 10),
      titles: titleBonus,
      victory: this.victory ? 100 : 0,
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    return { ...parts, total };
  }

  // ---------- résolution des cartes ----------
  private resolveEntry(entry: DeckEntry) {
    const c = entry.card;
    const ch = this.ch;
    // End of Round?
    if (c.id === 'end-of-round-ig' || c.id === 'end-of-round-oc') {
      if (this.eventsRemaining <= 0) { this.info('Toutes les cartes événements sont sorties : le round s’achève.'); this.roundEnded = true; }
      else this.info('Des cartes événements restent à venir : le round continue.');
      return;
    }
    if (c.id === 'round-ends-card') { this.info('Le round s’achèvera au prochain End of Round.'); return; }
    // absence
    const isEvent = entry.kind.endsWith('event');
    // les cartes 20 et 75 se jouent même absent — sauf mort ou prisonnier
    // Cartes 20 et 75 : jouées même absent, sauf mort ou prisonnier.
    // Cartes 38 et 39 : tout Grognard déclare sa loyauté, même absent, sauf mort.
    const alwaysApplies =
      (['you-are-denounced', 'you-are-accused'].includes(c.id) &&
        ch.absent?.type !== 'death' && ch.absent?.type !== 'prisoner') ||
      (['the-abdication', 'the-emperor-returns'].includes(c.id) && ch.absent?.type !== 'death');
    if (ch.absent && !alwaysApplies) {
      const leisure = ch.absent.type === 'furlough' ? 'Permission'
        : ch.absent.type === 'retirement' ? 'Retraite' : null;

      // « The card takes effect and applies to all players although the
      // recovering Grognard does not take part in the event. » L'absent est
      // écarté par les filtres de chaque résolution ; l'évènement, lui, court.
      if (isEvent) {
        this.info('Absent : il n’y prend pas part, la carte vaut pour les autres.');
        if (entry.kind === 'garrison-event') {
          const w = entry.card.wwt;
          if (w) this.startWWT(entry, w);
        } else if (entry.kind === 'campaign-event') {
          this.resolveCampaignEvent(entry.card);
        }
        // il garde son occupation, si rien n'attend déjà une décision
        if (leisure && !this.pending) this.offerLeisure(leisure, leisure === 'Permission');
        return;
      }

      if (ch.absent.type === 'furlough') { this.offerLeisure('Permission', true); return; }
      if (ch.absent.type === 'retirement') { this.offerLeisure('Retraite', false); return; }
      if (ch.absent.type === 'prisoner' && !ch.absent.alsoConvalescing && entry.kind === 'campaign') {
        this.announce('Tentative d’évasion ? — réussie sur 2D10 ≤ 15');
        const r = d100(this.rng);
        if (r <= 15) {
          this.roll(`2D10=${r} ≤ 15 — évadé !`);
          const conv = ch.absent;
          this.ch.absent = conv.alsoConvalescing
            ? { type: 'convalescence', convMult: conv.convMult, convRounds: conv.convRounds }
            : null;
          this.info('De retour à son commandement.');
        }
        else this.roll(`2D10=${r} > 15 — repris avant d’avoir franchi les lignes.`);
        return;
      }
      if (isEvent) this.info('Événement noté, mais absent : n’y prend pas part.');
      else this.info('Absent : la carte reste sans effet.');
      return;
    }
    // détaché à l'état-major : gain avant chaque carte, puis jet de sortie
    if (ch.flags.onStaff) {
      if (this.isCampaignRound(this.roundCode())) {
        ch.flags.onStaff = false;
        this.info('Le début de la campagne le rend à son commandement.');
      } else {
        this.applyStat('E', 2, 'état-major');
        const r = d10(this.rng);
        if (r <= 3) { ch.flags.onStaff = false; this.roll(`Sortie de l’état-major : 1D10=${r} ≤ 3 — il rejoint la troupe.`); }
        else this.roll(`Sortie de l’état-major : 1D10=${r} — il y reste.`);
      }
    }
    if (ch.flags.skipNextCard) {
      ch.flags.skipNextCard = false;
      if (!isEvent) { this.info('Instructions ignorées (zèle de la carte précédente).'); return; }
    }
    if (ch.flags.skipReason) {
      const why = ch.flags.skipReason;
      ch.flags.skipReason = undefined;
      if (!isEvent) { this.info(`${why} : la carte reste sans effet.`); return; }
    }
    if (entry.kind === 'garrison-event') {
      const card = entry.card;
      this.resolveGarrisonEvent(card);
      if (card.wwt && !this.pending) this.startWWT(entry, card.wwt);
      return;
    }
    if (entry.kind === 'campaign-event') {
      const card = entry.card;
      this.resolveCampaignEvent(card);
      const w = card.wwt ?? (card.subEvents ?? []).find((e) => e.wwt)?.wwt;
      if (w && !this.pending) this.startWWT(entry, w);
      return;
    }
    if (entry.kind === 'combat') return; // les cartes Combat passent par resolveBattle
    const card = entry.card;
    if (card.idleTime) { this.resolveIdleTime(card); return; }
    this.resolveRegular(card, entry.kind);
  }

  private perRankBlock(c: { perRank?: Partial<Record<RankCat, Effects>> }): Effects | null {
    if (!c.perRank) return null;
    return c.perRank[this.category()] ?? null;
  }

  private resolveRegular(c: GarrisonCard | CampaignCard, kind: 'garrison' | 'campaign') {
    if (c.etienneGerard) this.playedEGOnce.add(c.id);
    // cas spéciaux
    switch (c.id) {
      case 'you-contract-the-pox':
        this.applyEffects(c.effects);
        this.ch.flags.skipReason = 'Alité (vérole)';
        this.warn('N’agira pas sur sa prochaine carte (sauf event).');
        return;
      case 'meet-a-lady':
        this.applyStat('C', 1, 'lecture');
        this.info('(Fair Sex non active : il lit un livre.)');
        return;
      case 'assigned-to-staff':
        this.applyStat('E', 2);
        if (this.isGeneralOfficer()) { this.info('Officier général : il ne rejoint pas l’état-major.'); return; }
        this.ch.flags.onStaff = true;
        this.info('Détaché à l’état-major : E+2 avant chaque carte, jusqu’à ce qu’un 1D10 de 1 à 3 l’en sorte.');
        return;
      case 'illegal-activity': {
        const mult = this.category() === 'line' ? 2 : this.category() === 'field' ? 4 : 6;
        const r = d10(this.rng);
        const gain = r * mult;
        this.ask(`Activité illégale — gain possible ${gain} F (1D10=${r}×${mult})`, [
          {
            label: `Empocher ${gain} F (risque ${Math.ceil(gain / 2)}%)`,
            run: () => {
              const risk = Math.ceil(gain / 2);
              const fo = d100(this.rng);
              if (fo <= risk) {
                this.roll(`Découvert ! 2D10=${fo} ≤ ${risk}`);
                this.applyStat('S', -Math.floor(gain / 10));
                this.applyStat('N', -Math.floor(gain / 5));
              } else {
                this.roll(`Ni vu ni connu (2D10=${fo} > ${risk}).`);
                this.applyStat('M', gain, 'activité illégale');
              }
            },
          },
          { label: 'S’abstenir (tour perdu)', run: () => this.info('Il reste honnête… cette fois.') },
        ]);
        return;
      }
      case 'burger-insults-napoleon':
        this.cardBurger();
        return;
      case 'eg-foxhunt':
        this.cardFoxhunt();
        return;
      case 'challenged-by-enemy-champion':
        this.cardEnemyChampion();
        return;
      case 'challenge-to-horse-race':
        this.cardHorseRace();
        return;
      case 'spread-rumors':
        this.cardSpreadRumors();
        return;
      case 'spread-rumors-of-cowardice':
        this.cardRumorsOfCowardice();
        return;
      case 'celebratory-drinking-bout':
        this.cardDrinkingBout();
        return;
      case 'second-to-dhubert':
        this.cardSecondToDHubert();
        return;
      case 'sack-the-town':
        this.cardSackTheTown();
        return;
      case 'dangerous-mission':
        this.cardDangerousMission();
        return;
      case 'eg-corsican-brothers': {
        this.applyEffects(c.effects);
        if (c.effects?.W) this.checkWound(c.effects.W);
        const r = d10(this.rng);
        if (r <= 5) this.promoteTo(this.ch.rankIdx + 1, 'faveur impériale');
        else this.roll(`Promotion ? 1D10=${r} — pas cette fois.`);
        return;
      }
      case 'eg-brigand-deserters': {
        this.ask('Exterminer un nid de déserteurs avec Gérard ?', [
          {
            label: 'Accepter (W20 P5 — mort si capturé)',
            run: () => {
              this.applyEffects(c.effects);
              this.checkWound(20);
              if (this.ch.absent?.type !== 'death') {
                const r = d100(this.rng);
                if (r <= 5) { this.roll(`Capturé (2D10=${r} ≤ 5) — exécuté par les brigands.`); this.die(); }
                else this.roll(`Capture évitée (2D10=${r} > 5).`);
              }
            },
          },
          { label: 'Décliner (tour perdu)', run: () => {} },
        ]);
        this.playedEGOnce.add(c.id);
        return;
      }
      case 'eg-diplomatic-communique':
        this.info('Nécessite The Fair Sex (étape 5) : tour perdu.');
        return;
      case 'eg-carry-dispatches': {
        this.ask('Porter les dépêches de l’Empereur avec Gérard ?', [
          {
            label: 'Accepter (W15 P5)',
            run: () => {
              this.applyEffects({ G: 5, E: 4 });
              this.applyStat('N', -3, 'ruse déjouée');
              this.checkWound(15);
              if (this.ch.absent?.type !== 'death') this.checkPrisoner(5);
            },
          },
          { label: 'Décliner (N-1D10/2down, tour perdu)', run: () => this.applyStat('N', '-1D10/2down') },
        ]);
        return;
      }
      case 'sack-the-town':
        this.applyStat('M', '+1D10x3', 'mise à sac');
        return;
      case 'dangerous-mission':
        this.ask('Mission dangereuse (aucun autre officier disponible : à vous l’honneur)', [
          {
            label: 'Accepter (W20 P7)',
            run: () => {
              this.applyEffects({ G: 3, E: 3 });
              this.checkWound(20);
              if (this.ch.absent?.type !== 'death') this.checkPrisoner(7);
            },
          },
        ]);
        return;
    }
    // générique
    if (this.resolveChoiceCard(c)) return;
    const block = this.perRankBlock(c) ?? c.effects ?? null;
    const zealGain = c.zeal ?? block?.zeal;
    if (zealGain !== undefined) {
      const zeal = zealGain;
      const canZeal = (this.cardsByPlayer[this.active] ?? 0) < this.cardsPerRound;
      const normal = () => { this.applyEffects(block ?? {}); };
      if (canZeal) {
        this.ask(`${c.name} — avec zèle ?`, [
          { label: `Tâche normale${block?.E ? ` (E+${block.E})` : ''}`, run: normal },
          {
            label: `Avec zèle (E+${zeal}, prochaine carte ignorée)`,
            run: () => {
              const b = { ...(block ?? {}) };
              delete (b as any).E;
              this.applyEffects(b);
              this.applyStat('E', zeal, 'zèle');
              this.ch.flags.skipNextCard = true;
            },
          },
        ]);
      } else normal();
      return;
    }
    const apply = () => {
      if (block?.label) this.info(block.label);
      this.applyEffects(block ?? {});
      if (c.roll) this.resolveRollField(c.roll);
      if (block?.W) {
        this.checkWound(block.W);
        if (this.ch.absent?.type !== 'death' && block.P) this.checkPrisoner(block.P);
      }
      if (c.effect && !block) this.info(c.effect);
    };
    // Une carte qui prévoit son refus le propose : sans cela on force la main
    // au Grognard, et le prix du refus reste lettre morte.
    const decline = (c as CampaignCard).decline;
    if (decline && block) {
      const { loseTurn, ...cost } = decline;
      const prix = Object.entries(cost)
        .map(([k, v]) => `${k}${typeof v === 'number' && v >= 0 ? '+' : ''}${v}`)
        .join(', ');
      this.ask(c.name, [
        { label: `Accepter (${this.riskLabel(block)})`, run: apply },
        {
          label: `Refuser${prix ? ` (${prix})` : ''}${loseTurn ? ' — tour perdu' : ''}`,
          run: () => this.applyEffects(cost as Effects),
        },
      ]);
      return;
    }
    apply();
  }

  /** Ce qu'une proposition met en jeu, résumé pour le bouton qui l'accepte. */
  private riskLabel(block: Effects): string {
    return Object.entries(block)
      .filter(([k]) => k !== 'label' && k !== 'zeal')
      .map(([k, v]) => (k === 'W' ? `blessure ${v}%` : k === 'P' ? `capture ${v}%` : `${k}${typeof v === 'number' && v >= 0 ? '+' : ''}${v}`))
      .join(', ');
  }

  /**
   * Une carte qui propose un marché : chaque branche porte son intitulé, ses
   * gains, et parfois son jet. Rien ne lisait ce champ — une carte qui n'avait
   * que lui traversait la table sans rien produire.
   *
   * Les cartes qui ont leur propre cas n'arrivent jamais ici : elles ont rendu
   * la main plus haut. Une branche écrite en prose n'est pas jouable ; faute de
   * deux branches applicables, on laisse la carte suivre son cours ordinaire.
   */
  private resolveChoiceCard(c: GarrisonCard | CampaignCard): boolean {
    const choice = c.choice as Record<string, unknown> | undefined;
    if (!choice || typeof choice !== 'object') return false;
    const opts: PendingOption[] = [];
    for (const branch of Object.values(choice)) {
      if (!branch || typeof branch !== 'object') continue;
      const b = branch as Effects & { label?: string; roll?: RollTable; duel?: string };
      const { label, roll, duel, ...eff } = b;
      if (duel) return false; // un duel se traite à la main, pas ici
      const gains = Object.entries(eff)
        .map(([k, v]) => `${k}${typeof v === 'number' && v >= 0 ? '+' : ''}${v}`)
        .join(', ');
      opts.push({
        label: gains ? `${label ?? '—'} (${gains})` : `${label ?? '—'}`,
        run: () => {
          this.applyEffects(eff as Effects);
          if (roll) this.resolveRollField(roll);
        },
      });
    }
    if (opts.length < 2) return false;
    this.ask(c.name, opts);
    return true;
  }

  private resolveRollField(rollDef: RollTable) {
    const die = rollDef.die === '1D10' ? d10(this.rng) : d100(this.rng);
    this.roll(`${rollDef.die ?? '1D10'} = ${die}`);
    for (const [range, effect] of Object.entries(rollDef.results ?? {})) {
      const [lo, hi] = range.includes('-') ? range.split('-').map(Number) : [Number(range), Number(range)];
      if (die >= lo && die <= hi) {
        if (typeof effect === 'string') {
          this.info(effect);
          if (/guillotin|mort/i.test(effect)) this.die();
          else if (/emprisonné|perd son prochain tour/i.test(effect)) this.ch.flags.skipReason = 'Emprisonné';
          else if (/réaffecté en Espagne/i.test(effect)) {
            // La règle Espagne est inactive : le texte prévoit lui-même la
            // solution de rechange, et elle se perdait faute d'être appliquée.
            this.info('Règle Espagne inactive : il en est quitte pour la notice.');
            this.applyStat('N', -2, 'la liaison s’ébruite');
          }
        } else this.applyEffects(effect as Effects);
        return;
      }
    }
  }

  // ---------- cartes qui prennent un rival pour cible ----------
  //
  // Ces cartes dormaient : sans second Grognard, courir, calomnier ou croiser
  // le fer n'avait pas d'objet. Elles rentrent dès qu'un concurrent est en jeu.

  /** Course de chevaux : le sort désigne l'adversaire, qui y laisse son tour. */
  private cardHorseRace() {
    const cands = this.rivals();
    if (!cands.length) { this.info('Personne contre qui courir : tour perdu.'); return; }
    this.askTarget('Course — contre qui ?', cands, (idx) => {
      const rival = this.chars[idx];
      rival.flags.skipNextCard = true;
      rival.flags.skipReason = 'Retenu par la course';
      const mine = d10(this.rng);
      const his = d10(this.rng);
      this.roll(`Course : ${this.ch.name} 1D10=${mine} · ${rival.name} 1D10=${his}`);
      const win = (who: number, other: number) => {
        this.asActor(who, () => { this.applyStat('G', 3, 'course gagnée'); this.applyStat('E', 1); });
        this.asActor(other, () => { this.applyStat('G', -1, 'course perdue'); this.applyStat('E', 1); });
      };
      if (mine === his) {
        for (const i of [this.active, idx]) {
          this.asActor(i, () => { this.applyStat('G', 1, 'course indécise'); this.applyStat('E', 1); });
        }
      } else if (mine > his) win(this.active, idx);
      else win(idx, this.active);
    }, { random: true });
  }

  /** Calomnie : une enquête s'ouvre, et il arrive qu'elle innocente. */
  private cardSpreadRumors() {
    const cands = this.rivals();
    if (!cands.length) { this.info('Personne à calomnier : tour perdu.'); return; }
    this.askTarget('Calomnier lequel ?', cands, (idx) => {
      this.asActor(idx, () => {
        const r = d10(this.rng);
        if (r <= 5) {
          this.roll(`Enquête : 1D10=${r} ≤ 5 — la rumeur prend.`);
          this.applyStat('G', -2, 'rumeur');
          this.applyStat('S', -2, 'rumeur');
        } else {
          this.roll(`Enquête : 1D10=${r} > 5 — il en sort blanchi.`);
          this.applyStat('S', 1, 'exonéré');
        }
      });
    });
  }

  /** Accusation de lâcheté : elle porte à coup sûr, et fait un ennemi. */
  private cardRumorsOfCowardice() {
    const cands = this.rivals();
    if (!cands.length) { this.info('Personne à accuser : tour perdu.'); return; }
    const accuser = this.active;
    this.askTarget('Accuser lequel de lâcheté ?', cands, (idx) => {
      this.asActor(idx, () => {
        this.applyStat('G', -3, 'accusé de lâcheté');
        this.applyStat('S', -1);
      });
      this.chars[idx].flags.grievanceAgainst = accuser;
      this.warn(`${this.chars[idx].name} est désormais partie lésée envers ${this.chars[accuser].name}.`);
    });
  }

  /**
   * La beuverie. Tournée après tournée, un franc et un jet contre sa propre
   * santé : le dernier debout emporte autant de gloire qu'il y a eu de tournées.
   * Une seule par saison — la carte dort jusqu'à la suivante.
   */
  private cardDrinkingBout() {
    this.pausedCards.add('celebratory-drinking-bout');
    const table = [this.active, ...this.rivals()];
    if (table.length < 2) { this.info('Seul au comptoir : vainqueur sans avoir bu, pour zéro gloire.'); return; }
    const start = (drinkers: number[]) => {
      const rounds: Record<number, number> = {};
      let standing = [...drinkers];
      let turn = 0;
      while (standing.length > 1 && turn++ < 40) {
        const next: number[] = [];
        for (const i of standing) {
          const c = this.chars[i];
          if (c.mPurse < 1) { this.brief(`${c.name} n’a plus un sou : il glisse sous la table.`); continue; }
          this.asActor(i, () => this.applyStat('M', -1, 'tournée', true));
          rounds[i] = (rounds[i] ?? 0) + 1;
          const r = d100(this.rng);
          if (r > c.H) this.info(`${c.name} : 2D10=${r} > santé ${c.H} — sous la table.`);
          else next.push(i);
        }
        // tous tombés dans la même tournée : personne ne reste debout
        if (!next.length) { standing = []; break; }
        standing = next;
      }
      this.roll(`Beuverie : ${turn} tournée${turn > 1 ? 's' : ''}.`);
      if (standing.length === 1) {
        const w = standing[0];
        this.asActor(w, () => this.applyStat('G', turn, 'dernier debout'));
        this.title(`🍷 ${this.chars[w].name} tient encore debout.`);
      } else this.info('Toute la compagnie est sous la table : personne n’en tire gloire.');
    };
    // le joueur peut refuser de trinquer ; les concurrents boivent
    const others = table.filter((i) => i !== this.active);
    if (this.ch.bot) { start(table); return; }
    this.ask('Beuverie de célébration', [
      { label: 'Trinquer (1 F par tournée, 2D10 > santé = sous la table)', run: () => start(table) },
      {
        label: 'Décliner la tournée (G−3)',
        run: () => { this.applyStat('G', -3, 'refus de trinquer'); start(others); },
      },
    ]);
  }

  /**
   * Le second de D'Hubert. Le tireur se bat pour un autre ; celui qui tient le
   * fer d'en face n'y gagne ni ne perd rien que ses blessures.
   */
  private cardSecondToDHubert() {
    const cands = this.rivals();
    if (!cands.length) { this.info('Aucun Grognard pour servir Feraud : tour perdu.'); return; }
    this.askTarget('Qui sert de second à Feraud ?', cands, (idx) => {
      this.removed.add('second-to-dhubert');
      // « Do not apply any results of the duel to the Grognard dueling as
      // Feraud's second » : il tient les cartes, mais rien ne l'atteint. Son
      // escrime et sa santé comptent tout de même pour les cartes d'avantage.
      const foe = this.cardDuelist(`${this.chars[idx].name} (second de Feraud)`,
        this.chars[idx].F, idx, this.chars[idx].H);
      this.startSwordDuel(
        { a: this.asDuelist(this.active), b: foe, first: 'b' },
        {
          label: `Duel — second de D’Hubert contre second de Feraud (${this.chars[idx].name})`,
          weapon: 'sword',
          standard: false,
          drawerEffects: { N: -2, G: 5, E: 3, S: -2, F: 1 },
        },
      );
    });
  }

  /** Le sac de la ville : le tireur taxe les réactionnaires, et partage ou non. */
  private cardSackTheTown() {
    const r = d10(this.rng);
    const loot = r * 3;
    this.roll(`Contribution de guerre : 1D10=${r}×3 = ${loot} F`);
    const present = this.rivals({ sameCommand: true });
    if (!present.length || this.ch.bot) {
      // un concurrent ne partage pas : la fortune compte au décompte final
      this.applyStat('M', loot, 'sac de la ville');
      return;
    }
    const share = Math.floor(loot / (present.length + 1));
    this.ask(`${loot} F à répartir`, [
      { label: `Tout garder (M+${loot})`, run: () => this.applyStat('M', loot, 'sac de la ville') },
      {
        label: `Partager en parts égales (M+${share} chacun)`,
        run: () => {
          this.applyStat('M', loot - share * present.length, 'sac de la ville');
          for (const i of present) this.asActor(i, () => this.applyStat('M', share, 'part du butin'));
        },
      },
    ]);
  }

  /** La mission dangereuse : la faire, ou s'arranger pour qu'un autre la fasse. */
  private cardDangerousMission() {
    const mission = () => {
      this.applyStat('G', 3, 'mission dangereuse');
      this.applyStat('E', 3);
      this.checkWound(20);
      if (this.ch.absent?.type !== 'death') this.checkPrisoner(7);
    };
    if (this.isGeneralOfficer()) { this.info('Officier général : on ne l’envoie pas ramper dans les lignes — tour perdu.'); return; }
    const cands = this.rivals({ sameCommand: true }).filter((i) => !this.chars[i].marechal && this.chars[i].rankIdx < RANKS.findIndex((x) => x.id === 'general'));
    if (!cands.length) { this.info('Personne d’autre sous la main : il doit y aller.'); mission(); return; }
    this.ask('Mission dangereuse (W20, P7 — G+3, E+3)', [
      { label: 'Accepter (G+3, E+3)', run: mission },
      {
        label: 'Arranger pour qu’un autre s’en charge',
        run: () => this.askTarget('Qui envoyer ?', cands, (idx) => {
          this.info(`${this.chars[idx].name} est porté volontaire malgré lui.`);
          this.asActor(idx, mission);
        }, { kind: 'harm' }),
      },
    ]);
  }

  // ---------- duels contre un personnage de carte ----------

  /**
   * Le Burger. Un bourgeois insulte l'Empereur : le Grognard est partie lésée.
   * Il n'a pas de feuille — sa carte d'avantage lui est acquise d'office, et
   * aucune carte de santé n'entre en compte.
   *
   * `verify` : la carte dit « perte de N et S selon la blessure du Burger ».
   * On la lit comme le prix d'avoir embroché un civil, d'autant plus lourd que
   * la blessure est grave.
   */
  private cardBurger() {
    if (this.season < 3 || (this.season === 3 && this.roundIdx < 1)) {
      this.info('Avant III-2, l’affaire n’a pas de suite : tour perdu.');
      return;
    }
    const colonelIdx = RANKS.findIndex((r) => r.id === 'colonel');
    if (this.ch.marechal || this.ch.rankIdx >= colonelIdx) {
      this.info('À ce grade on n’a pas de duel avec un bourgeois : on lui envoie des gros bras. Tour perdu.');
      return;
    }
    const drawer = this.active;
    const terms = (weapon: 'sword' | 'pistol'): DuelTerms => ({
      label: `${weapon === 'sword' ? 'Duel à l’épée' : 'Duel au pistolet'} — le Burger`,
      weapon,
      /**
       * La procédure est celle d'un duel ordinaire, mais pas ses résultats :
       * « Do not apply any other modifications to the drawing Grognard's status
       * as listed at F. Results of Duels (Exception: fencing F+1 if swords) ».
       * Donc E+1 et G+3 de la carte, F+1 à l'épée, le barème N/S — et pas de
       * S−3, que seul un duel entre Grognards fait payer.
       */
      standard: false,
      drawerEffects: weapon === 'sword' ? { E: 1, G: 3, F: 1 } : { E: 1, G: 3 },
      then: (o, blessure) => {
        if (o?.winnerSide !== 'a' || !blessure) return;
        // Avoir versé le sang d'un bourgeois se paie, et d'autant plus cher
        // qu'on l'a mal arrangé : c'est le barème de la carte.
        const tarif: Record<string, [number, number]> = {
          killed: [-3, -3], gravely: [-2, -2], severely: [-2, -2], badly: [-1, -1],
        };
        // un bourgeois mort ne se relève pas : la carte quitte le jeu
        if (blessure.type === 'killed') {
          this.removed.add('burger-insults-napoleon');
          this.warn('Le Burger est mort : l’affaire ne se rejouera plus.');
        }
        const [n, s] = tarif[blessure.type] ?? [0, 0];
        if (!n && !s) return;
        this.asActor(drawer, () => {
          this.applyStat('N', n, 'il s’est battu contre un bourgeois');
          this.applyStat('S', s);
        });
      },
    });
    /**
     * Le Burger n'a pas de feuille : un autre Grognard le *tient*, il ne le
     * devient pas. Ni blessure ni résultat ne touchent celui qui joue le rôle
     * — seul le tireur se bat vraiment. Le rôle revient au joueur dès qu'il
     * n'est pas le tireur ; c'est la machine qui s'en charge sinon.
     */
    // le rôle revient à un autre joueur ; chez nous, à l'humain dès qu'il n'est
    // pas le tireur — sa feuille n'est de toute façon jamais touchée
    const roleAuJoueur = !!this.chars[drawer].bot;
    const burger = this.cardDuelist('Le Burger', this.chars[drawer].F, roleAuJoueur ? 0 : null);
    const fight = (weapon: 'sword' | 'pistol') => {
      this.handOver(drawer);
      if (weapon === 'sword') {
        this.startSwordDuel(
          { a: this.asDuelist(drawer), b: burger, first: 'b', autoCard: 'a', healthCard: 'none' },
          terms('sword'),
        );
      } else {
        this.askAim('Pointer l’arme', (aim) =>
          this.pistolDuel(this.asDuelist(drawer), burger, terms('pistol'), { a: aim, b: 'wound' }, 4));
      }
    };
    // l'arme appartient à qui tient le Burger, jamais au tireur
    const chooseWeapon = () => {
      if (!roleAuJoueur) { fight(burgerWeapon(this.chars[drawer])); return; }
      this.handOver(0);
      this.info('Vous tenez le Burger : ni ses blessures ni ses résultats ne vous touchent.');
      this.ask('Vous tenez le Burger — quelle arme ?', [
        { label: 'L’épée', run: () => fight('sword') },
        { label: 'Le pistolet', run: () => fight('pistol') },
      ]);
    };
    this.ask('Le Burger insulte l’Empereur', [
      { label: 'Le défier', run: chooseWeapon },
      { label: 'Passer l’éponge (G−5)', run: () => this.applyStat('G', -5, 'affront ravalé') },
    ]);
  }

  /** Le huntmaster de Gérard : on l'a tué de trop près, il faut en répondre. */
  private cardFoxhunt() {
    this.ask('La chasse au renard, avec Étienne Gérard', [
      { label: 'Épargner le renard (tour perdu)', run: () => this.info('Le renard s’en tire ; Gérard hausse les épaules.') },
      {
        label: 'Tuer le renard (E+1, G+1 — duel obligatoire)',
        run: () => {
          this.applyStat('E', 1, 'la chasse');
          this.applyStat('G', 1);
          this.startSwordDuel(
            {
              a: this.asDuelist(this.active),
              b: this.cardDuelist('Le maître d’équipage', this.ch.F),
              first: 'b',
              autoCard: 'b',
              healthCard: 'none',
            },
            {
              label: 'Duel à l’épée — le maître d’équipage',
              weapon: 'sword',
              standard: false,
              drawerEffects: { F: 1 },
            },
          );
        },
      },
    ]);
  }

  /** Le champion ennemi : son escrime ne se connaît qu'une fois le défi relevé. */
  private cardEnemyChampion() {
    this.ask('Un champion ennemi vous défie', [
      { label: 'Décliner (G−5)', run: () => this.applyStat('G', -5, 'défi décliné') },
      {
        label: 'Relever le défi (N+1, E+3, S+1, G+escrime du champion)',
        run: () => {
          const f = d10(this.rng);
          this.roll(`Escrime du champion : 1D10=${f}`);
          this.applyStat('N', 1, 'défi relevé');
          this.applyStat('G', f, 'la réputation du champion');
          this.applyStat('E', 3);
          this.applyStat('S', 1);
          this.startSwordDuel(
            {
              a: this.asDuelist(this.active),
              b: this.cardDuelist('Le champion ennemi', f),
              first: 'b',
              healthCard: 'random',
            },
            {
              label: 'Duel à l’épée — le champion ennemi',
              weapon: 'sword',
              standard: false,
              drawerEffects: { F: 1 },
              then: (o) => {
                if (o?.winnerSide !== 'a') return;
                const g = d100(this.rng);
                this.roll(`Dépouille du champion : 2D10=${g}`);
                this.applyStat('M', g, 'dépouille du champion');
              },
            },
          );
        },
      },
    ]);
  }

  /** Pointer l'arme : tuer, ou seulement blesser. */
  private askAim(title: string, then: (aim: Aim) => void) {
    if (this.ch.bot) { then(this.ch.persona === 'sabreur' ? 'kill' : 'wound'); return; }
    this.ask(title, [
      { label: 'Pour blesser (blessure adoucie)', run: () => then('wound') },
      { label: 'Pour tuer (G+3, N−3 si mort)', run: () => then('kill') },
    ]);
  }

  private resolveIdleTime(c: GarrisonCard) {
    const opts = (c.actions ?? []).map((a) => ({
      label: this.idleLabel(a),
      run: () => this.applyIdleAction(a),
    }));
    opts.push(...this.commonActions());
    opts.push({ label: 'Ne rien faire', run: () => {} });
    this.ask('Idle Time — choisir une action', opts);
  }

  /**
   * Occupations d'un Grognard en permission ou en retraite, en lieu et place du texte de la carte.
   * En permission il peut en outre demander un transfert, briguer un office et pratiquer la corruption.
   */
  private offerLeisure(context: string, fullAccess: boolean) {
    const opts: PendingOption[] = [
      { label: 'Pratiquer l’escrime (F+1)', run: () => this.applyStat('F', 1, 'entraînement') },
      { label: 'Prendre une cure (H+2)', run: () => this.applyStat('H', 2, 'cure') },
    ];
    if (fullAccess) {
      opts.push(...this.commonActions().filter((o) => !/Jouer/.test(o.label)));
    }
    opts.push({ label: 'Ne rien faire', run: () => {} });
    this.ask(`${context} — choisir une occupation`, opts);
  }

  // ---------- actions communes (Idle Time et permission) ----------

  /** Les actions disponibles quel que soit le contenu de la carte Idle Time. */
  commonActions(): PendingOption[] {
    const out: PendingOption[] = [];
    const ch = this.ch;

    // — Demander un transfert —
    const rankId = this.rank().id;
    if (!ch.marechal && rankId !== 'general') {
      const div: Record<string, number> = {
        colonel: 15, 'general-de-brigade': 20, 'general-de-division': 25,
      };
      const label = div[rankId]
        ? `Demander un transfert (1D10 < N÷${div[rankId]} = ${Math.floor(ch.N / div[rankId])})`
        : `Demander un transfert (1D10 ≥ ${this.reassignThreshold()})`;
      out.push({ label, run: () => this.doRequestTransfer(div[rankId]) });
    }

    // — Chercher un office —
    const gdbIdx = RANKS.findIndex((r) => r.id === 'general-de-brigade');
    if (!ch.office && !ch.flags.cannotSeekOffice && (ch.marechal || ch.rankIdx >= gdbIdx)) {
      out.push({
        label: `Briguer un office (1D10 ≤ N÷10 = ${Math.floor(ch.N / 10)})`,
        run: () => this.doSeekOffice(),
      });
    }

    // — Défier —
    const offender = this.challengeable();
    if (offender >= 0) {
      out.push({
        label: `Demander réparation à ${this.chars[offender].name} (S−3)`,
        run: () => this.issueChallenge(offender),
      });
    }

    // — Corruption —
    if (ch.office) {
      out.push({ label: 'Pratiquer la corruption…', run: () => this.askCorruption() });
    }

    // — Jouer contre la maison —
    if (ch.mPurse > 0) {
      out.push({ label: 'Jouer contre la maison…', run: () => this.askGamble(1, ch.mPurse) });
    }

    // — Jouer contre un camarade —
    if (ch.mPurse > 0 && this.rivals({ sameCommand: true }).some((i) => this.chars[i].mPurse > 0)) {
      out.push({ label: 'Proposer un pari à un camarade…', run: () => this.askWager() });
    }

    return out;
  }

  /**
   * Qui l'on peut appeler sur le pré. Il faut être partie lésée — on ne se bat
   * pas sans motif — et les conditions de la planche : tous deux présents, même
   * commandement, même grade, et pas au-delà du colonel, où l'on règle ses
   * comptes autrement. Renvoie l'index de l'offenseur, ou −1.
   */
  private challengeable(): number {
    const ch = this.ch;
    const target = ch.flags.grievanceAgainst;
    if (target === undefined || !this.chars[target]) return -1;
    const colonelIdx = RANKS.findIndex((r) => r.id === 'colonel');
    if (ch.marechal || ch.rankIdx >= colonelIdx) return -1;
    return this.rivals({ sameCommand: true, sameRank: true }).includes(target) ? target : -1;
  }

  /**
   * Le défi. Il coûte trois points de standing à qui le porte comme à qui
   * l'accepte ; le décliner coûte cinq points de gloire. Le grief s'éteint dans
   * tous les cas — on ne demande pas deux fois réparation du même affront.
   */
  private issueChallenge(idx: number) {
    const challenger = this.active;
    const foe = this.chars[idx];
    this.chars[challenger].flags.grievanceAgainst = undefined;
    const accepted = foe.bot
      ? acceptsDuel(foe, { F: this.chars[challenger].F, H: this.chars[challenger].H })
      : null;
    const label = `Duel — ${this.chars[challenger].name} contre ${foe.name}`;
    /**
     * Celui qui accepte choisit l'arme (XVIII.B), puis, à l'épée, annonce qui
     * pose la première carte (XVIII.C, étape 2). Les deux décisions lui
     * appartiennent : ni le provocateur ni la carte n'en décident.
     */
    const fight = (weapon: 'sword' | 'pistol', first: Side) => {
      this.handOver(challenger);
      const terms: DuelTerms = { label, weapon, standard: true, magnanimity: true };
      if (weapon === 'sword') {
        this.startSwordDuel({ a: this.asDuelist(challenger), b: this.asDuelist(idx), first }, terms);
      } else {
        this.askAim('Pointer l’arme', (aim) =>
          this.pistolDuel(this.asDuelist(challenger), this.asDuelist(idx), terms, { a: aim, b: 'wound' }));
      }
    };
    /** Le défié arme la rencontre : l'acier ou la poudre, et qui ouvre. */
    const armAndStart = () => {
      if (foe.bot) {
        // il prend le pistolet contre une meilleure lame, et laisse l'autre ouvrir
        const weapon = this.chars[challenger].F > foe.F ? 'pistol' : 'sword';
        fight(weapon, 'a');
        return;
      }
      this.handOver(idx);
      this.ask(`${this.chars[challenger].name} vous demande réparation — l’arme est à vous`, [
        { label: 'L’épée, à lui d’ouvrir', run: () => fight('sword', 'a') },
        { label: 'L’épée, j’ouvre', run: () => fight('sword', 'b') },
        { label: 'Le pistolet', run: () => fight('pistol', 'a') },
      ]);
    };
    const refuse = () => {
      this.asActor(idx, () => this.applyStat('G', -5, 'défi décliné'));
      this.info(`${foe.name} refuse le fer.`);
    };
    if (accepted === null) {
      // Le défié est le joueur : la main lui passe pour de bon le temps qu'il
      // réponde. La rendre tout de suite laisserait la politique des
      // concurrents décider à sa place.
      this.handOver(idx);
      this.ask(`${this.chars[challenger].name} demande réparation`, [
        { label: 'Accepter le duel (S−3)', run: armAndStart },
        { label: 'Décliner (G−5)', run: () => { this.handOver(challenger); refuse(); } },
      ]);
      return;
    }
    if (accepted) armAndStart();
    else refuse();
  }

  private doRequestTransfer(divisor?: number) {
    const ch = this.ch;
    const r = d10(this.rng);
    let approved: boolean;
    if (divisor) {
      const target = Math.floor(ch.N / divisor);
      approved = r < target;
      this.roll(`Transfert : 1D10=${r} vs N÷${divisor}=${target} → ${approved ? 'accordé' : 'refusé'}`);
    } else {
      const t = this.reassignThreshold();
      approved = r >= t;
      this.roll(`Transfert : 1D10=${r} vs (${t}) → ${approved ? 'accordé' : 'refusé'}`);
    }
    if (!approved) { this.info('L’état-major reste sourd à sa requête.'); return; }
    const cmds = commandsForSeason(this.season);
    const active = this.activeCommands();
    const move = (cmd: string) => {
      ch.assignment = cmd;
      this.info(`Affecté à ${commandName(cmd)}${active.has(cmd) ? ' — où l’on se bat cette saison.' : '.'}`);
      this.rollStanding('transfert');
    };
    // un concurrent va où l'on se bat : c'est là que se gagnent gloire et croix
    if (ch.bot) {
      const wanted = cmds.filter((c) => active.has(c));
      const pool = wanted.length ? wanted : cmds;
      move(pool[Math.floor(this.rng() * pool.length)]);
      return;
    }
    this.ask('Transfert accordé — choisir un commandement', [
      ...cmds.map((cmd) => ({
        label:
          commandName(cmd) +
          (active.has(cmd) ? ' ⚔ engagé cette saison' : '') +
          (cmd === ch.assignment ? ' (le sien — relance le standing)' : ''),
        run: () => move(cmd),
      })),
    ]);
  }

  private doSeekOffice() {
    const ch = this.ch;
    const target = Math.floor(ch.N / 10);
    this.announce(`Office ? — obtenu si 1D10 ≤ ${target} (notice ${ch.N} ÷ 10)`);
    const r = d10(this.rng);
    if (r <= target) {
      ch.office = true;
      this.roll(`1D10=${r} ≤ ${target} — obtenu !`);
      this.title('🏛 Il obtient une sinécure (M+10 par Income Phase).');
    } else {
      this.roll(`1D10=${r} > ${target} — la place échappe à ses intrigues.`);
    }
  }

  private askCorruption() {
    const amounts = [8, 20, 40, 60, 80, 99];
    this.ask('Corruption — combien détourner ?', [
      ...amounts.map((m) => ({
        label: `${m} F (découvert si 2D10 ≤ ${Math.ceil(m / 4)})`,
        run: () => this.doCorruption(m),
      })),
      { label: 'Renoncer', run: () => {} },
    ]);
  }

  private doCorruption(amount: number) {
    const risk = Math.ceil(amount / 4);
    const r = d100(this.rng);
    if (r <= risk) {
      this.roll(`Découvert ! 2D10=${r} ≤ ${risk}`);
      this.warn('Ses malversations éclatent au grand jour.');
      this.ch.office = false;
      this.ch.flags.cannotSeekOffice = true;
      this.info('Office perdu — et plus jamais d’office de sa vie.');
      this.applyStat('S', -Math.floor(amount / 10));
      this.applyStat('N', -Math.floor(amount / 5));
    } else {
      this.roll(`Ni vu ni connu : 2D10=${r} > ${risk}`);
      this.applyStat('M', amount, 'corruption');
    }
  }

  private askGamble(betNum: number, purseAtStart: number) {
    const ch = this.ch;
    const sizes = [5, 10, 25, 50, 100].filter((s) => s <= ch.mPurse);
    if (!sizes.length) { this.finishGamble(purseAtStart); return; }
    this.ask(`Jeu — mise n°${betNum} sur 3 (bourse : ${ch.mPurse} F)`, [
      ...sizes.map((s) => ({
        label: `Miser ${s} F`,
        run: () => {
          const mine = d10(this.rng);
          const house = d10(this.rng);
          const won = mine > house;
          this.roll(`Mise ${s} F — vous 1D10=${mine} · maison 1D10=${house} → ${won ? 'gagné' : 'perdu'}`);
          this.applyStat('M', won ? s : -s, 'jeu');
          if (betNum < 3 && ch.mPurse > 0) this.askGamble(betNum + 1, purseAtStart);
          else this.finishGamble(purseAtStart);
        },
      })),
      { label: 'Quitter la table', run: () => this.finishGamble(purseAtStart) },
    ]);
  }

  /**
   * Le pari entre Grognards. Une seule mise, contre un camarade du même
   * commandement : refuser coûte trois points de gloire, et l'égalité annule
   * tout. La gloire ne suit l'argent que par tranches de vingt-cinq francs.
   */
  private askWager() {
    const ch = this.ch;
    const cands = this.rivals({ sameCommand: true }).filter((i) => this.chars[i].mPurse > 0);
    if (!cands.length) { this.info('Personne à la table.'); return; }
    this.askTarget('À qui proposer le pari ?', cands, (idx) => {
      const foe = this.chars[idx];
      const max = Math.min(ch.mPurse, foe.mPurse, 100);
      const sizes = [5, 10, 25, 50, 100].filter((s) => s <= max);
      if (!sizes.length) { this.info('Les bourses sont trop plates pour parier.'); return; }
      const settle = (stake: number) => {
        const challenger = this.active;
        const accepted = foe.bot ? foe.mPurse >= stake * 2 || stake <= 10 : null;
        const play = () => {
          const mine = d10(this.rng);
          const his = d10(this.rng);
          this.roll(`Pari de ${stake} F — ${ch.name} 1D10=${mine} · ${foe.name} 1D10=${his}`);
          if (mine === his) { this.info('Égalité : le pari est annulé.'); return; }
          const winner = mine > his ? challenger : idx;
          const loser = mine > his ? idx : challenger;
          this.asActor(loser, () => this.applyStat('M', -stake, 'pari perdu'));
          this.asActor(winner, () => {
            this.applyStat('M', stake, 'pari gagné');
            const g = Math.floor(stake / 25);
            if (g > 0) this.applyStat('G', g, 'sa veine fait jaser');
          });
        };
        const decline = () => {
          this.asActor(idx, () => this.applyStat('G', -3, 'pari refusé'));
          this.info(`${foe.name} se dérobe.`);
        };
        if (accepted === null) {
          // le pari vise le joueur : la main lui passe jusqu'à sa réponse
          this.handOver(idx);
          this.ask(`${this.chars[challenger].name} propose un pari de ${stake} F`, [
            { label: `Tenir le pari (${stake} F)`, run: () => { this.handOver(challenger); play(); } },
            { label: 'Refuser (G−3)', run: () => { this.handOver(challenger); decline(); } },
          ]);
          return;
        }
        if (accepted) play();
        else decline();
      };
      if (this.ch.bot) { settle(sizes[Math.floor(this.rng() * sizes.length)]); return; }
      this.ask(`Pari contre ${foe.name} — combien ?`, [
        ...sizes.map((s) => ({ label: `Miser ${s} F`, run: () => settle(s) })),
        { label: 'Renoncer', run: () => {} },
      ]);
    }, { kind: 'harm' });
  }

  private finishGamble(purseAtStart: number) {
    const net = this.ch.mPurse - purseAtStart;
    if (net > 0) {
      const g = Math.floor(net / 25);
      this.info(`Il quitte la table avec ${net} F de gain.`);
      if (g > 0) this.applyStat('G', g, 'sa veine fait jaser');
    } else if (net < 0) {
      this.info(`Il laisse ${-net} F sur le tapis.`);
    } else {
      this.info('Il repart comme il est venu.');
    }
  }

  private idleLabel(a: Effects): string {
    const parts: string[] = [a.label ?? ''];
    for (const [k, v] of Object.entries(a)) {
      if (k === 'label') continue;
      parts.push(`${k}${typeof v === 'number' ? (v >= 0 ? `+${v}` : v) : ` ${v}`}`);
    }
    return parts.join(' · ');
  }

  private applyIdleAction(a: Effects) {
    const label = a.label ?? '';
    if (/^Carouse/.test(label)) {
      const max = Math.min(this.ch.mPurse, /40/.test(label) ? 40 : 30);
      const spendable = Math.floor(max / 5) * 5;
      if (spendable < 5) { this.info('Trop pauvre pour faire la fête.'); return; }
      const opts = [];
      for (let s = 5; s <= spendable; s += 5) {
        opts.push({
          label: `Dépenser ${s} F (G+${s / 5})`,
          run: () => { this.applyStat('M', -s); this.applyStat('G', s / 5, 'fête'); },
        });
      }
      opts.push({ label: 'Finalement non', run: () => {} });
      this.ask('Faire la fête — combien dépenser ?', opts);
      return;
    }
    // coût M négatif à vérifier avant
    const cost = typeof a.M === 'number' && a.M < 0 ? -a.M : 0;
    if (cost > this.ch.mPurse) { this.warn('Bourse insuffisante pour cette action.'); return; }
    this.applyEffects(a);
  }

  // ---------- events In Garrison ----------
  private resolveGarrisonEvent(c: GarrisonCard) {
    const ch = this.ch;
    const inCmd = (cmd: string) => ch.assignment === cmd;
    switch (c.id) {
      case 'louis-xvi-arrested':
        if (inCmd('army-reserve')) {
          this.ask('Entonner la Marseillaise ?', [
            {
              label: 'Chanter à pleins poumons',
              run: () => {
                const r = d10(this.rng);
                if (r <= 5) this.applyStat('N', 1);
                this.roll(`Remarqué ? 1D10=${r}${r <= 5 ? ' — le pouvoir apprécie' : ''}`);
                this.applyStat('G', 1); this.applyStat('E', 1); this.applyStat('M', '+1D10/2up');
              },
            },
            { label: 'Rester discret', run: () => {} },
          ]);
        } else this.info('Loin de Paris : simple rumeur.');
        return;
      case 'you-are-denounced': {
        const r = d10(this.rng);
        this.roll(`Dénoncé ! 1D10=${r}`);
        if (r === 1) { this.warn('Guillotiné !'); this.die(); }
        else if (r <= 3) { this.warn('Emprisonné : prochain tour perdu.'); ch.flags.skipReason = 'Emprisonné'; }
        else this.info('Exonéré.');
        return;
      }
      case 'louis-xvi-guillotined':
        if (inCmd('army-reserve')) {
          this.ask('Prendre part au régicide ?', [
            {
              label: 'Oui (régicide : gare aux Bourbons en 1815)',
              run: () => {
                const r = d10(this.rng);
                if (r <= 5) this.applyStat('N', 3);
                this.roll(`1D10=${r}${r <= 5 ? ' — N+3' : ''}`);
                this.applyStat('G', 6); this.applyStat('E', 1);
                ch.flags.regicide = true;
              },
            },
            { label: 'Non', run: () => {} },
          ]);
        } else this.info('Son commandement n’est pas concerné.');
        return;
      case 'coup-9-thermidor':
        if (inCmd('army-reserve')) {
          const r = d10(this.rng);
          this.roll(`Répression des Jacobins : 1D10=${r}`);
          this.applyStat('N', r <= 5 ? 1 : -1);
          this.applyStat('G', 1); this.applyStat('E', 1);
        } else this.info('Il n’y prend pas part.');
        return;
      case 'coup-13-vendemiaire':
        if (inCmd('army-reserve')) {
          this.applyStat('N', 4); this.applyStat('G', 1); this.applyStat('E', 1);
          this.ask('Suivre Bonaparte à l’Armée d’Italie ?', [
            { label: 'Oui — réaffectation immédiate', run: () => { ch.assignment = 'army-italy'; this.info('Affecté à l’Armée d’Italie.'); this.rollStanding('réaffectation'); } },
            { label: 'Non', run: () => {} },
          ]);
        } else this.info('Il n’y prend pas part.');
        return;
      case 'marriage-josephine':
        if (ch.N >= 8) {
          if (ch.mPurse + ch.mParis < 5) { this.applyStat('N', -2); this.warn('Trop pauvre pour paraître : l’absence est remarquée.'); }
          else { this.payAnyPurse(5); this.applyStat('N', 2); this.applyStat('G', 1); this.applyStat('C', 1); }
        } else this.info('Pas assez en vue pour être invité.');
        return;
      case 'wurmser-mantua':
        if (inCmd('army-italy')) { this.applyStat('N', 1); this.applyStat('G', 3); this.applyStat('E', 2); this.applyStat('M', '+1D10'); }
        else this.info('Il n’y prend pas part.');
        return;
      case 'coup-18-fructidor':
        if (inCmd('army-reserve')) { this.applyStat('N', 3); this.applyStat('G', 1); this.applyStat('E', 1); }
        else this.info('Il n’y prend pas part.');
        return;
      case 'coup-18-brumaire':
        if (inCmd('army-reserve')) { this.applyStat('N', 6); this.applyStat('G', 1); this.applyStat('E', 1); }
        else this.info('Il n’y prend pas part.');
        return;
      case 'infernal-machine':
        this.applyStat('N', 3); this.applyStat('G', 1); this.applyStat('C', 1);
        return;
      case 'fall-moreau-pichegru':
        if (ch.N >= 5) {
          this.promoteTo(ch.rankIdx + 1, 'poste d’un conspirateur');
          this.applyStat('M', -2);
        } else this.info('Pas assez en vue pour en profiter.');
        return;
      case 'execution-enghien':
        this.applyStat('N', 5); this.applyStat('G', 1); this.applyStat('E', 1); this.applyStat('M', '+1D10/2up');
        return;
      case 'grand-review-boulogne': {
        ch.flags.marshalate = true;
        if (ch.assignment !== 'corps-2') this.applyStat('G', 1, 'Création du Maréchalat');
        const rev = { line: { N: 3, E: 2 }, field: { N: 2, E: 2 }, general: { N: 1, E: 2 } }[this.category()];
        this.applyStat('N', rev.N); this.applyStat('E', rev.E);
        if (ch.armsOfHonor) {
          ch.armsOfHonor = false;
          if (ch.loh > 0) this.title(`Les Arms of Honor deviennent la Légion d’Honneur (niveau ${ch.loh}) !`);
          else this.info('La Légion d’Honneur est instituée.');
        }
        return;
      }
      case 'crowning-of-napoleon':
        if (ch.standing >= 2 || this.isGeneralOfficer()) {
          if (ch.mPurse + ch.mParis < 3) this.info('Trop pauvre pour le sacre.');
          else { this.payAnyPurse(3); this.applyStat('G', 1); this.applyStat('C', 1); }
        } else this.info('Standing insuffisant pour être convié au sacre.');
        return;
      case 'christmas-warsaw':
        if (['corps-3', 'corps-4', 'corps-7', 'corps-reserve'].includes(ch.assignment)) this.applyStat('N', '+1D10/3down');
        else this.info('Il n’y prend pas part.');
        return;
      case 'peace-of-tilsit':
        if (inCmd('corps-3')) { this.applyStat('N', '+1D10/3down'); this.applyStat('G', 1); this.applyStat('E', 1); }
        else this.info('Il n’y prend pas part.');
        return;
      case 'revolt-of-may-2nd': {
        const r = d10(this.rng);
        this.roll(`Espagne ? 1D10=${r}`);
        if (r <= 4) this.info('Désigné pour l’Espagne — règle optionnelle non active : il y échappe (tour perdu).');
        else this.info('Épargné par le bourbier espagnol.');
        return;
      }
      case 'marriage-marie-louise':
        if (ch.N >= 20) {
          if (ch.mPurse + ch.mParis < 10) { this.applyStat('N', -2); this.warn('Absence remarquée (fonds insuffisants).'); }
          else { this.payAnyPurse(10); this.applyStat('N', 2); this.applyStat('C', 1); this.applyStat('H', 5); }
        } else this.info('Pas invité aux noces impériales.');
        return;
      case 'birth-king-of-rome':
        if (ch.mPurse + ch.mParis < 5) { this.applyStat('N', -2); this.warn('Absence remarquée (fonds insuffisants).'); }
        else { this.payAnyPurse(5); this.applyStat('N', '+1D10/3up'); this.applyStat('C', 1); }
        return;
      case 'the-abdication':
        this.ask('L’Empereur abdique. Votre loyauté ?', [
          {
            label: 'Royaliste (grade +1, N-10)',
            run: () => {
              ch.flags.royalist38 = true;
              if (ch.rankIdx < RANKS.findIndex((r) => r.id === 'general')) this.promoteTo(ch.rankIdx + 1, 'faveur des Bourbons');
              this.applyStat('N', -10);
            },
          },
          {
            label: 'Bonapartiste (absent, sans solde, jusqu’au retour de l’Empereur)',
            run: () => { ch.flags.bonapartist = true; ch.flags.bonapartist38 = true; ch.absent = { type: 'bonapartist-wait' }; this.warn('Il attend son Empereur, à l’écart de l’armée des Bourbons.'); },
          },
        ]);
        return;
      case 'the-emperor-returns':
        if (ch.absent?.type === 'bonapartist-wait') ch.absent = null;
        this.ask('L’Empereur est de retour ! Votre loyauté ?', [
          {
            label: 'Bonapartiste',
            run: () => {
              const wasRoyalist = ch.flags.royalist38;
              ch.flags.bonapartist = true;
              if (wasRoyalist) { ch.flags.turncoat = true; this.warn('Retourné de veste : rien à gagner, et les Bourbons s’en souviendront.'); }
              else { this.applyStat('N', 5); this.applyStat('G', 3); this.applyStat('E', 1); }
              this.ask('Marcher sur Paris avec l’Empereur ?', [
                { label: 'Oui (N+5, G+6, E+2)', run: () => { ch.flags.marchedOnParis = true; this.applyStat('N', 5); this.applyStat('G', 6); this.applyStat('E', 2); this.reassign(true); } },
                { label: 'Non', run: () => this.reassign(true) },
              ]);
            },
          },
          {
            label: 'Royaliste (retraite définitive)',
            run: () => { ch.absent = { type: 'royalist-retired' }; this.warn('Retiré pour de bon : la partie s’achèvera sans lui.'); },
          },
        ]);
        return;
      default:
        this.applyEffects(c.effects);
        if (c.special) this.info(String(c.special));
        return;
    }
  }

  private payAnyPurse(amount: number) {
    const fromPurse = Math.min(this.ch.mPurse, amount);
    if (fromPurse > 0) this.applyStat('M', -fromPurse);
    const rest = amount - fromPurse;
    if (rest > 0) this.applyStat('MParis', -rest);
  }

  // ---------- events On Campaign ----------
  private resolveCampaignEvent(c: CampaignCard) {
    const ch = this.ch;
    if (c.id === 'the-terror') {
      // « commands: all » : chacun passe devant le Comité, non le seul piocheur.
      // Un absent, lui, n'est pas là pour qu'on l'y traîne.
      const first = this.active;
      for (let i = 0; i < this.chars.length; i++) {
        this.active = (first + i) % this.chars.length;
        if (this.ch.absent) { this.info('Absent : la Terreur ne l’atteint pas.'); continue; }
        if (this.chars.length > 1) this.who();
        const r = d10(this.rng);
        this.roll(`La Terreur : 1D10=${r}`);
        if (r === 1) { this.warn('Guillotiné !'); this.die(); }
        else if (r <= 3) { this.warn('Emprisonné : prochaine carte sans effet.'); this.ch.flags.skipReason = 'Emprisonné'; }
        else this.info('Exonéré.');
      }
      this.active = first;
      return;
    }
    const drawer = this.active;
    // Chaque Grognard dont le commandement figure sur la carte y prend part,
    // en commençant par celui qui l'a tirée puis dans le sens horaire.
    const n = this.chars.length;
    const rotation = Array.from({ length: n }, (_, k) => (drawer + k) % n);
    const engaged = (cmds: string[] | undefined, who: Character) =>
      !cmds || cmds.includes('all') || cmds.includes('all-not-spain') || cmds.includes(who.assignment);

    const subEvents = c.subEvents ?? [c];
    let any = false;
    const battles: { ev: CampaignSubEvent; name: string; who: number }[] = [];
    let armistice = false;

    for (const ev of subEvents) {
      const cmds = ev.commands as string[] | undefined;
      if (ev.name === 'The Armistice') {
        if (engaged(cmds, this.chars[drawer])) { any = true; armistice = true; }
        continue;
      }
      // certaines actions n'appartiennent qu'à celui qui a tiré la carte : les
      // autres n'y étaient pas, quand bien même leur commandement y figure
      const rota = ev.drawingGrognardOnly ? [drawer] : rotation;
      for (const idx of rota) {
        const who = this.chars[idx];
        if (!engaged(cmds, who) || who.absent) continue;
        // les batailles des Cent-Jours n'engagent que les Bonapartistes
        if (/Bonapartistes/i.test(ev.condition ?? '') && !who.flags.bonapartist) continue;
        any = true;
        if (ev.noCombatCard) {
          // Il rejoint la file au lieu d'être résolu sur-le-champ : une carte se
          // joue dans son ordre de lecture, et le second évènement attend que le
          // premier soit terminé pour tous ceux qu'il concerne.
          battles.push({ ev: { ...ev, id: ev.id ?? c.id, noCombatCard: true }, name: ev.name ?? c.name, who: idx });
          continue;
        }
        if (ev.excluded !== undefined || ev.oneCombatCard || ev.oneEvent || ev.values) {
          battles.push({ ev: { ...ev, id: ev.id ?? c.id }, name: ev.name ?? c.name, who: idx });
        }
      }
    }
    this.active = drawer;
    if (!any) { this.info('Aucun commandement engagé.'); return; }

    // Ligny tirée : après sa bataille, enchaîner Quatre Bras, Wavre et Waterloo, puis clore le round
    if (c.id === 'battle-of-ligny') {
      this.afterBattles = () => this.hundredDaysSequence();
    } else if (armistice) {
      this.afterBattles = () => this.armisticeInterlude();
    }
    if (battles.length) this.queueBattles(battles);
    else { const f = this.afterBattles; this.afterBattles = null; f?.(); }
  }

  /** Événement de campagne sans carte Combat : valeurs propres, blessure, capture, LoH éventuelle. */
  private resolveFieldEvent(ev: CampaignSubEvent, c: CampaignCard) {
    this.cardLog(`⚔ ${ev.name ?? c.name}`, c.id);
    const gStart = this.ch.G;
    const vals = ev.values ? (ev.values[this.category()] ?? ev.values.any) : null;
    if (vals) {
      // l'ordre de la carte : on encaisse d'abord, on récolte ensuite — sinon
      // un homme monte en grade avant qu'on sache s'il finit prisonnier
      const { W, P, M, ...rest } = vals;
      if (W) this.checkWound(W);
      if (P && this.ch.absent?.type !== 'death') this.checkPrisoner(P);
      this.applyEffects(rest);
      if (M && this.ch.absent?.type !== 'prisoner') this.applyStat('M', M, 'butin');
    }
    if ((ev.legionOfHonor || ev.armsOfHonor) &&
        this.ch.absent?.type !== 'death' && this.ch.absent?.type !== 'prisoner') {
      this.legionCheck(this.ch.G - gStart);
    }
  }

  // ---------- batailles ----------

  private queueBattles(list: { ev: CampaignSubEvent; name: string; who: number }[]) {
    if (!this.battleQueue.length) this.battleCards = [];
    this.battleQueue.push(...list);
    this.nextBattle();
  }

  private nextBattle() {
    // ce que le précédent a gagné se dit avant qu’un autre entre en lice,
    // sans quoi ses lignes s’écrivent sous la carte du suivant
    this.flushBrief();
    const t = this.battleQueue.shift();
    if (!t) {
      const f = this.afterBattles;
      this.afterBattles = null;
      f?.();
      return;
    }
    this.active = t.who;
    if (this.ch.absent) {
      this.brief(`${t.name} : hors de combat`);
      this.nextBattle();
      return;
    }
    if (this.chars.length > 1) this.who();
    // un évènement de terrain n'appelle pas de carte Combat, mais il prend son
    // rang dans la file : c'est ainsi que l'ordre de lecture est respecté
    if (t.ev.noCombatCard) {
      this.resolveFieldEvent(t.ev, this.currentCard?.card as CampaignCard);
      this.nextBattle();
      return;
    }
    this.resolveBattle(t.ev, t.name);
  }

  private resolveBattle(ev: CampaignSubEvent, name: string) {
    this.title(`⚔ ${name}`);
    this.combatCard = null;
    const isWaterloo = ev.id === 'battle-of-waterloo';
    const excluded: string[] = [...(ev.excluded ?? [])];
    if (isWaterloo) excluded.push('carry-the-day', 'held-in-reserve');
    this.ask('Votre commandement est engagé', [{
      label: 'Tirer une carte Combat',
      run: () => this.drawCombat(ev, name, excluded, isWaterloo, isWaterloo && this.waterlooRedraw),
    }], { kind: 'draw-combat' });
  }

  private drawCombat(ev: CampaignSubEvent, name: string, excluded: string[], isWaterloo: boolean, mayRedraw: boolean) {
    const pool = expandedCombatCards().filter((c) => {
      const base = combatBaseId(c.id);
      if (base === 'victory-mont-st-jean') return isWaterloo;
      return !excluded.includes(base);
    });
    const card = pool[Math.floor(this.rng() * pool.length)];
    this.combatCard = { kind: 'combat', card };
    this.battleCards.push({ card: this.combatCard, who: this.active });
    this.drawnThisRound.push({ id: card.id, name: card.name });
    this.cardLog(`Carte Combat : ${card.name}`, card.id);
    if (combatBaseId(card.id) === 'victory-mont-st-jean') { this.resolveVictoryMSJ(); return; }
    const proceed = () => this.chooseAct(ev, card);
    if (mayRedraw) {
      this.ask('Le Carry the Day des jours précédents permet de rejouer ce tirage', [
        { label: `Garder ${card.name}`, run: proceed },
        {
          label: 'Défausser et repiocher',
          run: () => { this.waterlooRedraw = false; this.drawCombat(ev, name, excluded, isWaterloo, false); },
        },
      ]);
    } else proceed();
  }

  /** Le côté de la carte Combat qui vaut pour le grade du Grognard. */
  private combatSide(card: CombatCard): CombatSide {
    return card[this.category()] ?? {};
  }

  private chooseAct(ev: CampaignSubEvent, card: CombatCard) {
    const cb = this.combatSide(card);
    if (card.noChoice) {
      this.info('Tenu en réserve : il n’a pas voix au chapitre.');
      this.resolveAct(ev, card, true);
      return;
    }
    this.ask('Acte de gloire ou de discrétion ?', [
      { label: `⚔ Acte de gloire : ${cb.glory} (W${cb.W} P${cb.P})`, run: () => this.resolveAct(ev, card, true) },
      {
        label: `🛡 Acte de discrétion : ${cb.discretion} (moitié des gains, Disgrace? ${cb.disgrace})`,
        run: () => this.resolveAct(ev, card, false),
      },
    ]);
  }

  /** Modification par le standing : ajouté (plafond au double) ou soustrait (plancher à 0). */
  private standingMod(v: number): number {
    if (v <= 0) return Math.max(0, v);
    const s = this.isGeneralOfficer() ? 0 : this.ch.standing;
    if (s > 0) return Math.min(v * 2, v + s);
    if (s < 0) return Math.max(0, v + s);
    return v;
  }

  private resolveAct(ev: CampaignSubEvent, card: CombatCard, glory: boolean) {
    const ch = this.ch;
    const cat = this.category();
    const cb = this.combatSide(card);
    const evv = (ev.values ? (ev.values[cat] ?? ev.values.any ?? {}) : {}) as Effects;
    const num = (x: unknown) => (typeof x === 'number' ? x : 0);
    const gStart = ch.G;

    let N = (cb.N ?? 0) + num(evv.N);
    let G = (cb.G ?? 0) + num(evv.G);
    let E = (cb.E ?? 0) + num(evv.E);
    let disgraced = false;

    if (!glory) {
      const dis = cb.disgrace ?? 0;
      this.announce(`Disgrâce ? — déshonoré si 2D10 ≤ ${dis}`);
      const r = d100(this.rng);
      if (r <= dis) {
        disgraced = true;
        this.roll(`2D10=${r} ≤ ${dis} — déshonoré !`);
        this.warn('Sa prudence se remarque : ni notice ni gloire pour cette bataille.');
        this.disgraceComrades();
      } else this.roll(`2D10=${r} > ${dis} — personne n’a rien vu.`);
      N = Math.floor(N / 2); G = Math.floor(G / 2); E = Math.floor(E / 2);
    }
    if (disgraced) { N = 0; G = 0; }
    else {
      const n0 = N, g0 = G;
      N = this.standingMod(N); G = this.standingMod(G);
      if ((N !== n0 || G !== g0) && !this.isGeneralOfficer()) {
        this.info(this.ch.standing > 0 ? 'Cité dans les dépêches (standing).' : 'Son fait d’armes est passé sous silence (standing).');
      }
    }
    // L'ordre de la carte, et il compte : blessure, capture, puis seulement les
    // gains. Autrement le Grognard était promu avant qu'on sache s'il tombait
    // aux mains de l'ennemi — et un prisonnier ne monte pas en grade.
    let becamePrisoner = false;
    if (glory) {
      const W = (cb.W ?? 0) + num(evv.W);
      if (W > 0) this.checkWound(W);
      if (ch.absent?.type !== 'death') {
        const P = (cb.P ?? 0) + num(evv.P);
        if (P > 0) this.checkPrisoner(P);
        becamePrisoner = ch.absent?.type === 'prisoner';
      }
    } else this.info('À distance respectueuse : ni blessure ni capture possibles.');

    if (N) this.applyStat('N', N, 'bataille');
    if (G) this.applyStat('G', G, 'bataille');
    if (E) this.applyStat('E', E, 'bataille');

    if (ch.absent?.type !== 'death' && !becamePrisoner) {
      if (cb.M) this.applyStat('M', cb.M, 'butin');
      if (evv.M) this.applyStat('M', evv.M, 'butin');
      if (card.plundered && ch.mPurse > 0) {
        const r = d10(this.rng) - (glory ? 1 : 5);
        const pct = Math.max(0, r) * 10;
        const loss = Math.floor((ch.mPurse * pct) / 100);
        this.roll(`Pillé ? 1D10−${glory ? 1 : 5} → ${Math.max(0, r)} soit ${pct} % du contenu de la bourse`);
        if (loss > 0) this.applyStat('M', -loss, 'bagages pillés');
        else this.info('Ses bagages échappent au pillage.');
      }
    }
    this.postBattle(ev, gStart, glory, card, becamePrisoner);
  }

  private postBattle(ev: CampaignSubEvent, gStart: number, glory: boolean, card: CombatCard, becamePrisoner: boolean) {
    const ch = this.ch;
    const dead = ch.absent?.type === 'death';
    if (!dead && !becamePrisoner) {
      this.legionCheck(ch.G - gStart);
      if (glory && this.season >= 7 && card.title && ev.id !== 'battle-of-waterloo') this.checkTitles(card);
    } else if (dead) this.info('Les morts ne reçoivent ni croix ni titre.');
    else this.info('Un prisonnier ne reçoit ni croix ni titre.');

    if (['battle-of-ligny', 'battle-of-quatre-bras', 'battle-of-wavre'].includes(ev.id ?? '') &&
        combatBaseId(card.id) === 'carry-the-day') {
      this.waterlooRedraw = true;
      this.info('Ce Carry the Day donnera droit à repiocher la première carte de Waterloo.');
    }
    this.nextBattle();
  }

  /** Jet de Légion d'Honneur : 1D10 ≤ gloire de la bataille ÷ 4. */
  private legionCheck(gained: number) {
    const target = Math.floor(Math.max(0, gained) / 4);
    if (target <= 0) return;   // aucune gloire gagnée : rien à annoncer
    this.announce(`Légion d’Honneur ? — décoré si 1D10 ≤ ${target} (gloire de la bataille ${Math.max(0, gained)} ÷ 4)`);
    const r = d10(this.rng);
    if (r <= target) {
      this.roll(`1D10=${r} ≤ ${target} — décoré !`);
      this.awardLoH();
    } else this.roll(`1D10=${r} > ${target} — pas cette fois.`);
  }

  private awardLoH() {
    const ch = this.ch;
    if (ch.loh >= 5) { this.info('Déjà grande-croix : la France n’a rien de plus à offrir.'); return; }
    ch.loh++;
    if (ch.armsOfHonor) {
      this.title(`🎖 Arms of Honor (niveau ${ch.loh}) — en attendant que la Légion d’Honneur existe.`);
    } else {
      this.title(`🎖 Légion d’Honneur : ${LOH_LEVELS[ch.loh - 1].id} !`);
    }
  }

  /** Titres après une bataille : maréchal, puis au plus un titre nobiliaire. */
  private checkTitles(card: CombatCard) {
    const ch = this.ch;
    const base = combatBaseId(card.id); // carry-the-day / lead-counterattack / telling-maneuver
    const rankId = this.rank().id;
    if (!ch.marechal && rankId === 'general' && ch.flags.marshalate) {
      ch.marechal = true;
      this.title('👑 Le bâton de Maréchal de France !');
    }
    const gdbIdx = RANKS.findIndex((r) => r.id === 'general-de-brigade');
    if (base === 'carry-the-day' && ch.marechal && ch.title === 'duc') {
      ch.title = 'prince';
      this.title('👑 Élevé à la dignité de Prince !');
    } else if ((ch.marechal || rankId === 'general') && ch.title !== 'duc' && ch.title !== 'prince') {
      ch.title = 'duc';
      this.title('👑 Créé Duc de l’Empire !');
    } else if (!ch.title && ch.rankIdx >= gdbIdx) {
      ch.title = 'comte';
      this.title('👑 Créé Comte de l’Empire !');
    }
  }

  /** Carte 180 : la victoire immortelle. */
  private resolveVictoryMSJ() {
    const ch = this.ch;
    this.victory = true;
    this.title('🇫🇷 VICTORY AT MONT ST. JEAN ! L’Histoire bascule : la France est sauvée !');
    const ctd = expandedCombatCards().find((c) => c.id === 'carry-the-day-1')!;
    const cb = this.combatSide(ctd);
    const gStart = ch.G;
    this.applyStat('N', this.standingMod(cb.N ?? 0), 'Mont St. Jean');
    this.applyStat('G', this.standingMod(cb.G ?? 0), 'Mont St. Jean');
    this.applyStat('E', cb.E ?? 0, 'Mont St. Jean');
    if (ch.marechal) this.info('Déjà maréchal : nul grade au-dessus.');
    else if (this.rank().id === 'general') { ch.marechal = true; this.title('👑 Promu Maréchal de France sur le champ de bataille !'); }
    else this.promoteTo(ch.rankIdx + 1, 'Mont St. Jean');
    this.awardLoH();
    if (ch.flags.bonapartist38) this.checkTitles(ctd);
    this.checkWound(cb.W ?? 0);
    if (ch.absent?.type !== 'death') this.applyStat('M', cb.M ?? 0, 'butin');
    this.info(`Gloire du jour : ${ch.G - gStart}.`);
    this.battleQueue = [];
    this.afterBattles = null;
    this.roundEnded = true;
  }

  /** Après Ligny : Quatre Bras, Wavre puis Waterloo, à la suite, sans repioche du deck. */
  private hundredDaysSequence() {
    const seq = ['battle-of-quatre-bras', 'battle-of-wavre', 'battle-of-waterloo'];
    const n = this.chars.length;
    const rotation = Array.from({ length: n }, (_, k) => (this.active + k) % n);
    const tasks: { ev: CampaignSubEvent; name: string; who: number }[] = [];
    for (const id of seq) {
      const e = CAMPAIGN_EVENTS.find((x) => x.id === id)!;
      for (const idx of rotation) {
        const who = this.chars[idx];
        if (who.absent || !who.flags.bonapartist) continue;
        if (!(e.commands ?? []).includes(who.assignment)) continue;
        tasks.push({ ev: e, name: e.name, who: idx });
      }
    }
    this.afterBattles = () => { this.roundEnded = true; };
    if (tasks.length) this.queueBattles(tasks);
    else this.roundEnded = true;
  }

  /** L'Armistice (XIV-A) : un intermède de garnison d'une seule carte. */
  private armisticeInterlude() {
    this.title('L’Armistice', 'Les armes se taisent : la garnison reprend ses droits.');
    if (this.ch.absent) { this.info('Absent : l’intermède passe sans lui.'); return; }
    const pool: DeckEntry[] = [];
    for (const c of GARRISON_CARDS) {
      if (['round-ends-card', 'end-of-round-ig'].includes(c.id)) continue;
      if (!this.cardAllowed(c)) continue;
      if (this.removed.has(c.id)) continue;
      if (c.etienneGerard && this.playedEGOnce.has(c.id)) continue;
      pool.push({ kind: 'garrison', card: c });
    }
    for (const c of IDLE_TIME_CARDS) pool.push({ kind: 'garrison', card: { ...c, name: 'Idle Time', idleTime: true } });
    const entry = pool[Math.floor(this.rng() * pool.length)];
    this.currentCard = entry;
    this.cardLog(`${entry.card.name}`, entry.card.id);
    this.resolveEntry(entry);
  }

  // ---------- position dans la séquence de jeu ----------
  /**
   * Décrit où l'on se trouve dans la séquence officielle (booklet v1.00).
   * L'étape « en cours » est celle dont les résultats viennent d'être écrits au journal.
   */
  progress(): Progress {
    const mk = (id: string, label: string, state: StepState, note?: string): PhaseStep =>
      ({ id, label, state, note });
    const seq = (labels: [string, string][], currentIdx: number, extras: Record<number, PhaseStep>): PhaseStep[] =>
      labels.map(([id, label], i) => {
        if (extras[i]) return extras[i];
        const state: StepState = currentIdx < 0 || i > currentIdx ? 'todo' : i === currentIdx ? 'current' : 'done';
        return mk(id, label, state);
      });

    const rounds: string[] = this.seasonDef().rounds;
    const code = this.stage === 'season-end' || this.over ? null : this.roundCode();
    const campaign = code ? this.isCampaignRound(code) : false;
    const base = {
      roundCode: code,
      roundNum: this.roundIdx + 1,
      roundTotal: rounds.length,
      cardNum: this.cardNumInRound,
      cardTotal: this.cardNumInRound + this.deck.length,
    };

    if (this.over) {
      return { ...base, blockKind: 'end', blockLabel: 'Partie terminée', roundCode: null, steps: [] };
    }

    if (this.stage === 'setup') {
      const steps = this.setupPlan.map((s, i) =>
        mk(s.id, s.label, i < this.sub ? 'done' : i === this.sub ? 'current' : 'todo'),
      );
      return { ...base, blockKind: 'setup', blockLabel: 'Mise en place', roundCode: null, steps };
    }

    if (this.stage === 'segment') {
      // Séquence officielle : Fair Sex, Argent & Impôt, Vieillissement, Affectation, Gloire
      const engineIdx = this.sub - 1; // 0=money 1=aging 2=assignment 3=glory
      const labels: [string, string][] = [
        ['fair-sex', 'Fair Sex'],
        ['money', 'Argent & Impôt'],
        ['aging', 'Vieillissement'],
        ['assignment', 'Affectation'],
        ['glory', 'Gloire'],
      ];
      const steps = seq(labels, engineIdx + 1, {
        0: mk('fair-sex', 'Fair Sex', 'na', 'Règle optionnelle inactive'),
      });
      return { ...base, blockKind: 'segment', blockLabel: 'Segment de saison', roundCode: null, steps };
    }

    if (this.stage === 'season-end') {
      return { ...base, blockKind: 'segment', blockLabel: 'Fin de saison', roundCode: null, steps: [] };
    }

    // Rounds : Permission, Récupération, Revenus, Soutien, Deck, Cartes
    const labels: [string, string][] = campaign
      ? [
          ['furlough', 'Retour de permission'],
          ['recovery', 'Récupération & Santé'],
          ['income', 'Revenus'],
          ['support', 'Soutien'],
          ['deck', 'Deck'],
          ['cards', 'Cartes'],
        ]
      : [
          ['furlough', 'Permission ?'],
          ['recovery', 'Récupération'],
          ['income', 'Revenus'],
          ['support', 'Soutien'],
          ['deck', 'Deck'],
          ['cards', 'Cartes'],
        ];
    // engine ROUND_START_PHASES : 0=furlough 1=recovery 2=income 3=deck → affichage 0, 1, 2, 4
    const toDisplay = [0, 1, 2, 4];
    let currentIdx: number;
    if (this.stage === 'round-start') currentIdx = this.sub === 0 ? -1 : toDisplay[this.sub - 1];
    else if (this.stage === 'draw') currentIdx = 5;
    else currentIdx = 6; // round-over : tout est résolu
    const extras: Record<number, PhaseStep> = {
      3: mk('support', 'Soutien', 'na', 'Règle optionnelle inactive'),
    };
    const steps = seq(labels, currentIdx, extras);
    return {
      ...base,
      blockKind: campaign ? 'on-campaign' : 'in-garrison',
      blockLabel: campaign ? 'Round On Campaign' : 'Round In Garrison',
      steps,
    };
  }

  // ---------- score ----------
  score(): { rank: string; G: number; loh: number; money: number; title: string | null } {
    return {
      rank: this.rankName(),
      G: this.ch.G,
      loh: this.ch.loh,
      money: this.ch.mParis + this.ch.mPurse,
      title: this.ch.title,
    };
  }
}
