/**
 * Le duel — épée et pistolet.
 *
 * Les règles vivent dans `data/cards/duel.json` ; ce fichier ne fait que les
 * appliquer. Deux principes ont guidé la découpe :
 *
 * - **Le duel ne connaît pas la partie.** Il ne sait ni blesser ni tuer : il
 *   dit qui touche, avec quelle intention, et rend la main. C'est `game.ts` qui
 *   lance la table des blessures, envoie en convalescence et compte les points.
 * - **Il ne choisit pas non plus.** À chaque instant il annonce de qui l'on
 *   attend une carte et lesquelles sont jouables ; la machine tranche dans
 *   `policy.ts`, le joueur dans l'interface. Un duel entre deux concurrents se
 *   déroule donc d'un trait, sans que rien ici ne change.
 */
import { d10, d100, RNG } from './dice';

export type SwordCardType = 'lunge' | 'riposte' | 'parry';
/** Une carte à double sens se pointe : tuer, ou seulement blesser. */
export type Aim = 'kill' | 'wound';
export type Side = 'a' | 'b';

export interface DuelData {
  swordDeck: { count: number; type: SwordCardType; dualEnd: boolean }[];
  pistolCards: { count: number; type: string; dualEnd: boolean }[];
  swordInteraction: Record<string, Record<string, string>>;
  results: {
    bothDuelists: Record<string, number>;
    winnerUnwounded: Record<string, number>;
    kill: Record<string, number>;
    swordDuel: Record<string, number>;
    cuckoldDuel: Record<string, number>;
  };
  challenges: { decline: Record<string, number> };
}

/** Un duelliste, qu'il tienne une feuille de Grognard ou sorte d'une carte. */
export interface Duelist {
  /** Index dans `Game.chars`, ou null pour un personnage de carte. */
  idx: number | null;
  name: string;
  F: number;
  H: number;
  /** La machine joue ce duelliste (concurrent ou personnage de carte). */
  auto: boolean;
  persona?: string;
}

export interface SwordSetup {
  /** `a` est celui qui a lancé l'affaire ; `b` celui qui l'a acceptée. */
  a: Duelist;
  b: Duelist;
  /** Qui pose la première carte — le défié en décide, la carte parfois l'impose. */
  first: Side;
  /** Carte d'avantage accordée d'office (personnage de carte). */
  autoCard?: Side | null;
  /**
   * La carte d'avantage de santé : comparée (défaut), tirée au sort — le
   * champion ennemi — ou supprimée, comme dans les duels contre un personnage
   * de carte qui n'a pas de santé.
   */
  healthCard?: 'compare' | 'random' | 'none';
}

/** Ce que le duel attend : une carte, et de qui. */
export interface SwordChoice {
  card: SwordCardType;
  aim?: Aim;
  label: string;
}

export interface SwordOutcome {
  /** Le duelliste touché, ou null si les deux en réchappent. */
  woundedSide: Side | null;
  winnerSide: Side | null;
  /** Intention du coup porté : « to Wound » adoucit la table des blessures. */
  aim: Aim;
  /** Nombre de mains distribuées : deux mains épuisées relancent le duel. */
  deals: number;
}

const LABEL: Record<SwordCardType, string> = {
  lunge: 'Botte',
  riposte: 'Riposte',
  parry: 'Parade',
};

const AIM_LABEL: Record<Aim, string> = { kill: 'pour tuer', wound: 'pour blesser' };

/**
 * Un assaut à l'épée, joué carte après carte.
 *
 * L'attaquant pose une carte, le défenseur y répond, et la table d'interaction
 * dit ce qu'il advient — touché, ou l'assaut continue et l'on sait qui reprend
 * la main. Deux mains épuisées sans blessure ne closent rien : on redistribue.
 */
export class SwordDuel {
  hands: Record<Side, SwordCardType[]> = { a: [], b: [] };
  /** Qui a posé la carte à laquelle on répond. */
  attacker: Side;
  /** La carte posée, en attente de réponse ; null : on attend une attaque. */
  onTable: { card: SwordCardType; aim: Aim } | null = null;
  outcome: SwordOutcome | null = null;
  deals = 0;

  constructor(
    private readonly data: DuelData,
    private readonly rng: RNG,
    readonly setup: SwordSetup,
    /** Au-delà, on considère que les deux bretteurs se sont épuisés. */
    private readonly maxDeals = 6,
  ) {
    this.attacker = setup.first;
    this.deal();
  }

  /** Cinq cartes chacun, plus une par avantage. */
  private deal() {
    const deck: SwordCardType[] = [];
    for (const d of this.data.swordDeck) for (let i = 0; i < d.count; i++) deck.push(d.type);
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const { a, b } = this.setup;
    const bonus: Record<Side, number> = { a: 0, b: 0 };
    // l'escrime supérieure vaut une carte, quel que soit l'écart
    if (a.F > b.F) bonus.a++;
    else if (b.F > a.F) bonus.b++;
    const health = this.setup.healthCard ?? 'compare';
    if (health === 'compare') {
      if (a.H - b.H >= 10) bonus.a++;
      else if (b.H - a.H >= 10) bonus.b++;
    } else if (health === 'random') {
      // le champion ennemi : la santé se tire au sort, impair au tireur
      bonus[d10(this.rng) % 2 === 1 ? 'a' : 'b']++;
    }
    if (this.setup.autoCard) bonus[this.setup.autoCard]++;
    this.hands.a = deck.splice(0, 5 + bonus.a);
    this.hands.b = deck.splice(0, 5 + bonus.b);
    this.deals++;
  }

  get done(): boolean { return this.outcome !== null; }

  /** De qui attend-on une carte ? */
  get turn(): Side | null {
    if (this.done) return null;
    return this.onTable ? other(this.attacker) : this.attacker;
  }

  get duelist(): Duelist { return this.turn === 'a' ? this.setup.a : this.setup.b; }

  /**
   * Les cartes jouables par celui dont c'est le tour. Une main vide ne rend
   * rien : `play(-1)` la traduit en « pas de carte », qui est un coup reçu
   * quand on répondait à une botte.
   */
  choices(): SwordChoice[] {
    const side = this.turn;
    if (!side) return [];
    const seen = new Set<string>();
    const out: SwordChoice[] = [];
    for (const card of this.hands[side]) {
      const dual = card !== 'parry';
      for (const aim of dual ? (['kill', 'wound'] as Aim[]) : [undefined]) {
        const key = `${card}/${aim ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          card,
          aim,
          label: aim ? `${LABEL[card]} ${AIM_LABEL[aim]}` : LABEL[card],
        });
      }
    }
    return out;
  }

  /** Joue le choix d'indice `i` — ou, à −1, l'aveu qu'on n'a plus de carte. */
  play(i: number): { card: SwordCardType | 'no-card'; aim: Aim; side: Side; verdict: string } | null {
    const side = this.turn;
    if (!side) return null;
    const list = this.choices();
    const pick = list[i];
    const card: SwordCardType | 'no-card' = pick ? pick.card : 'no-card';
    const aim: Aim = pick?.aim ?? 'wound';
    if (pick) {
      const k = this.hands[side].indexOf(pick.card);
      if (k >= 0) this.hands[side].splice(k, 1);
    }

    // une attaque se pose sur la table ; c'est la réponse qui tranche
    if (!this.onTable) {
      if (card === 'no-card') { this.redealOrEnd(); return { card, aim, side, verdict: 'sans carte' }; }
      this.onTable = { card, aim };
      return { card, aim, side, verdict: 'en attente de réponse' };
    }

    const table = this.data.swordInteraction[`vs-${this.onTable.card}`] ?? {};
    const verdict = table[card] ?? 'safe';
    const attackAim = this.onTable.aim;
    this.onTable = null;

    if (verdict.includes('wounded')) {
      // le défenseur encaisse la botte, avec l'intention qu'elle portait
      this.finish(side, attackAim);
      return { card, aim, side, verdict };
    }
    if (verdict.includes('counts-as-lunge')) {
      // la riposte devient une botte : les rôles s'inversent séance tenante
      this.attacker = side;
      this.onTable = { card: 'riposte', aim };
      return { card, aim, side, verdict };
    }
    if (!verdict.includes('A-plays-next')) this.attacker = side;
    if (!this.hands.a.length && !this.hands.b.length) this.redealOrEnd();
    return { card, aim, side, verdict };
  }

  private redealOrEnd() {
    if (this.deals >= this.maxDeals) {
      this.outcome = { woundedSide: null, winnerSide: null, aim: 'wound', deals: this.deals };
      return;
    }
    this.deal();
  }

  private finish(woundedSide: Side, aim: Aim) {
    this.outcome = { woundedSide, winnerSide: other(woundedSide), aim, deals: this.deals };
  }
}

export function other(s: Side): Side { return s === 'a' ? 'b' : 'a'; }

/** Un coup de pistolet : le tireur touche sur 1-5 (1-4 contre le Burger). */
export function pistolHits(rng: RNG, cap = 5): { roll: number; hit: boolean } {
  const roll = d10(rng);
  return { roll, hit: roll <= cap };
}

/**
 * Qui tire le premier. Chacun vérifie d'abord son amorce : un raté prive du
 * coup et donne la main à l'autre. Deux ratés terminent l'affaire — les
 * témoins déclarent l'honneur satisfait.
 */
export function pistolOrder(rng: RNG): {
  misfire: Record<Side, boolean>;
  rolls: Record<Side, number>;
  first: Side | null;
  bothMisfired: boolean;
} {
  const ma = d100(rng);
  const mb = d100(rng);
  const misfire: Record<Side, boolean> = { a: ma <= 5, b: mb <= 5 };
  const rolls: Record<Side, number> = { a: ma, b: mb };
  if (misfire.a && misfire.b) return { misfire, rolls, first: null, bothMisfired: true };
  if (misfire.a) return { misfire, rolls, first: 'b', bothMisfired: false };
  if (misfire.b) return { misfire, rolls, first: 'a', bothMisfired: false };
  let ra = 0;
  let rb = 0;
  do { ra = d10(rng); rb = d10(rng); } while (ra === rb);
  return { misfire, rolls: { a: ra, b: rb }, first: ra > rb ? 'a' : 'b', bothMisfired: false };
}

export const SWORD_LABEL = LABEL;
export const SWORD_AIM_LABEL = AIM_LABEL;
