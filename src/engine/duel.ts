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
/**
 * Un duelliste — et la distinction qui compte : **qui tient les cartes** n'est
 * pas forcément **qui saigne**. Un Grognard désigné pour jouer le Burger décide
 * de ses coups mais « is never affected in any way by the results of the duel »
 * (XVIII.E) : sa feuille reste intacte, blessure comprise.
 */
export interface Duelist {
  /** Feuille touchée par le duel ; null pour un personnage de carte. */
  idx: number | null;
  /** Qui choisit les cartes ; null : la machine. */
  pilot: number | null;
  name: string;
  F: number;
  H: number;
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
 * Un assaut à l'épée.
 *
 * Le texte (XVIII.C, étape 3) ne connaît ni attaquant ni défenseur : « les
 * Grognards jouent tour à tour leur carte **en réponse à celle que l'adversaire
 * vient de poser** ». Chaque carte répond donc à la précédente et devient
 * aussitôt celle à laquelle l'autre devra répondre. Toute issue non sanglante
 * se conclut par « l'adversaire joue une autre carte » : l'alternance ne
 * s'interrompt jamais.
 *
 * Celui qui n'a plus de carte ne rend pas les armes pour autant : l'autre
 * continue de poser les siennes, sans réponse — ce qui vaut blessure face à
 * une botte ou une riposte, et rien face à une parade.
 */
export class SwordDuel {
  hands: Record<Side, SwordCardType[]> = { a: [], b: [] };
  /** La dernière carte posée, à laquelle il faut répondre. */
  table: { card: SwordCardType; aim: Aim; side: Side } | null = null;
  /** De qui l'on attend une carte. */
  toPlay: Side;
  outcome: SwordOutcome | null = null;
  deals = 0;

  constructor(
    private readonly data: DuelData,
    private readonly rng: RNG,
    readonly setup: SwordSetup,
    /** Garde-fou : deux bretteurs ne s'épuisent pas indéfiniment. */
    private readonly maxDeals = 12,
  ) {
    this.toPlay = setup.first;
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
      // le champion ennemi : la carte de santé se tire au dé, impair au tireur
      bonus[d10(this.rng) % 2 === 1 ? 'a' : 'b']++;
    }
    if (this.setup.autoCard) bonus[this.setup.autoCard]++;
    this.hands.a = deck.splice(0, 5 + bonus.a);
    this.hands.b = deck.splice(0, 5 + bonus.b);
    this.table = null;
    this.toPlay = this.setup.first;
    this.deals++;
  }

  get done(): boolean { return this.outcome !== null; }

  /** De qui attend-on une carte ? */
  get turn(): Side | null { return this.done ? null : this.toPlay; }

  get duelist(): Duelist { return this.toPlay === 'a' ? this.setup.a : this.setup.b; }

  /** Vrai si la carte attendue répond à une autre — la première ne répond à rien. */
  get answering(): boolean { return this.table !== null; }

  /**
   * Les cartes jouables par celui dont c'est le tour. Une main vide ne rend
   * rien : `play(-1)` la traduit en « pas de carte ».
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
        out.push({ card, aim, label: aim ? `${LABEL[card]} ${AIM_LABEL[aim]}` : LABEL[card] });
      }
    }
    return out;
  }

  /** Joue le choix d'indice `i` — ou, à −1, l'aveu qu'on n'a plus de carte. */
  play(i: number) {
    const pick = this.choices()[i];
    return this.playCard(pick ? pick.card : 'no-card', pick?.aim ?? 'wound');
  }

  /**
   * Pose une carte de la main, pointée comme on l'entend. La parade n'a pas de
   * pointe ; la botte, la riposte et le feu se retournent à volonté, et c'est
   * au joueur d'en décider à chaque fois.
   */
  playCard(card: SwordCardType | 'no-card', aim: Aim = 'wound'):
  { card: SwordCardType | 'no-card'; aim: Aim; side: Side; wounded: boolean } | null {
    const side = this.turn;
    if (!side) return null;
    if (card !== 'no-card') {
      const k = this.hands[side].indexOf(card);
      if (k < 0) return null;
      this.hands[side].splice(k, 1);
    }

    let wounded = false;
    // la riposte pare puis se substitue : l'adversaire répond au type qu'elle
    // « compte comme » (botte ou parade), jamais à la riposte elle-même
    let effective: SwordCardType | 'no-card' = card;
    if (this.table) {
      const row = this.data.swordInteraction[`vs-${this.table.card}`] ?? {};
      const result = row[card] ?? 'safe';
      if (result.includes('wounded')) {
        // le coup porte, avec l'intention que lui donnait la carte reçue
        this.outcome = {
          woundedSide: side, winnerSide: other(side), aim: this.table.aim, deals: this.deals,
        };
        return { card, aim, side, wounded: true };
      }
      if (result.includes('counts-as-lunge')) effective = 'lunge';
      else if (result.includes('counts-as-parry')) effective = 'parry';
    }

    // la carte posée (ou ce qu'elle compte comme) devient celle à laquelle
    // l'adversaire doit répondre
    this.table = effective === 'no-card' ? null : { card: effective, aim, side };
    this.toPlay = other(side);

    // personne n'a plus rien à poser : on redistribue, le duel continue
    if (!this.hands.a.length && !this.hands.b.length) {
      if (this.deals >= this.maxDeals) {
        this.outcome = { woundedSide: null, winnerSide: null, aim: 'wound', deals: this.deals };
      } else this.deal();
    }
    return { card, aim, side, wounded };
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
  /** Les 2D10 d'amorce. */
  rolls: Record<Side, number>;
  /** Les 1D10 de priorité, quand les deux armes ont pris feu. */
  priority: Record<Side, number> | null;
  first: Side | null;
  bothMisfired: boolean;
} {
  const ma = d100(rng);
  const mb = d100(rng);
  const misfire: Record<Side, boolean> = { a: ma <= 5, b: mb <= 5 };
  const rolls: Record<Side, number> = { a: ma, b: mb };
  if (misfire.a && misfire.b) return { misfire, rolls, priority: null, first: null, bothMisfired: true };
  if (misfire.a) return { misfire, rolls, priority: null, first: 'b', bothMisfired: false };
  if (misfire.b) return { misfire, rolls, priority: null, first: 'a', bothMisfired: false };
  let ra = 0;
  let rb = 0;
  do { ra = d10(rng); rb = d10(rng); } while (ra === rb);
  return { misfire, rolls, priority: { a: ra, b: rb }, first: ra > rb ? 'a' : 'b', bothMisfired: false };
}

export const SWORD_LABEL = LABEL;
export const SWORD_AIM_LABEL = AIM_LABEL;
