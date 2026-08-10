/**
 * Comment un Grognard mené par la machine tranche ses décisions.
 *
 * Tous cherchent à gagner : la course se joue sur le grade, la gloire, la
 * Légion d'Honneur et la fortune. Mais chacun a son tempérament, caché du
 * joueur, qui infléchit ses arbitrages sans jamais le conduire à saborder sa
 * carrière.
 */
import type { SwordChoice } from './duel';
import { Character, Pending } from './types';

export type Persona = 'sabreur' | 'courtisan' | 'prudent' | 'affairiste';

export const PERSONAS: Persona[] = ['sabreur', 'courtisan', 'prudent', 'affairiste'];

export const PERSONA_LABEL: Record<Persona, string> = {
  sabreur: 'Sabreur',
  courtisan: 'Courtisan',
  prudent: 'Prudent',
  affairiste: 'Affairiste',
};

interface Traits {
  /** En dessous de cette santé, il se met en permission pour se soigner. */
  restAt: number;
  /** En dessous de cette santé, il prend l'acte de discrétion plutôt que la gloire. */
  cautionAt: number;
  /** Poids des gains dans l'arbitrage par défaut. */
  weight: { N: number; G: number; E: number; F: number; C: number; H: number; M: number };
  /** Il place son or à Paris plutôt que de le porter sur lui. */
  banks: boolean;
  /** Il tente le jeu et la corruption. */
  schemes: boolean;
}

const TRAITS: Record<Persona, Traits> = {
  // fonce au feu, se soigne le plus tard possible, méprise l'intendance
  sabreur: {
    restAt: 8, cautionAt: 0, banks: false, schemes: false,
    weight: { N: 2, G: 4, E: 2, F: 2, C: 1, H: 1, M: 1 },
  },
  // cherche l'œil de l'Empereur, les charges et les honneurs
  courtisan: {
    restAt: 10, cautionAt: 0, banks: true, schemes: false,
    weight: { N: 4, G: 3, E: 3, F: 1, C: 2, H: 1, M: 1 },
  },
  // ménage sa monture : il vise la longévité, donc les seuils de grade
  prudent: {
    restAt: 10, cautionAt: 25, banks: true, schemes: false,
    weight: { N: 2, G: 2, E: 4, F: 1, C: 1, H: 3, M: 1 },
  },
  // la gloire est une chose, la fortune en est une autre
  affairiste: {
    restAt: 10, cautionAt: 18, banks: true, schemes: true,
    weight: { N: 2, G: 2, E: 2, F: 1, C: 1, H: 1, M: 4 },
  },
};

export function traitsOf(ch: Character): Traits {
  return TRAITS[(ch.persona as Persona) ?? 'sabreur'] ?? TRAITS.sabreur;
}

export interface BotContext {
  /** Son commandement actuel est-il engagé dans une bataille cette saison ? */
  engaged?: boolean;
  /**
   * Le fer lui est-il favorable contre celui qui l'a lésé ? Calculé par le
   * moteur, qui seul connaît l'escrime de l'offenseur : la politique lit des
   * intitulés d'options, elle n'y cherche pas des chiffres.
   */
  duelFavorable?: boolean;
  /** Tirage de la partie, pour que les choix restent reproductibles. */
  rng?: () => number;
}

export function botChoice(p: Pending, ch: Character, ctx: BotContext = {}): number {
  const t = traitsOf(ch);
  const find = (re: RegExp) => p.options.findIndex((o) => re.test(o.label));
  const pick = (...res: RegExp[]) => {
    for (const re of res) {
      const i = find(re);
      if (i >= 0) return i;
    }
    return -1;
  };

  // Au feu. La gloire se gagne là ; seul un homme déjà entamé se met à couvert.
  const glory = find(/Acte de gloire/);
  const discretion = find(/Acte de discrétion/);
  if (glory >= 0) return ch.H <= t.cautionAt && discretion >= 0 ? discretion : glory;

  // Les Cent-Jours : nul ne refuse l'Empereur revenu.
  let i = pick(/Bonapartiste/, /Marcher sur Paris|Oui \(N\+5/);
  if (i >= 0) return i;

  // La Garde Impériale ne se refuse pas non plus.
  i = find(/Demander la Garde/);
  if (i >= 0) return i;

  /**
   * Permission. Deux raisons de quitter le service, et deux seulement :
   * se remettre debout, ou fuir une armée qui ne verra pas le feu — car en
   * permission chaque carte devient une occupation choisie, donc trois fois
   * plus d'occasions de demander sa mutation vers un commandement engagé.
   * Au-delà, partir ne rapporte plus rien et coûte standing et demi-solde.
   */
  const goFurlough = pick(/Partir en permission/, /Poursuivre la permission/);
  const stay = pick(/Rester au service/, /Reprendre le service/);
  if (goFurlough >= 0 || stay >= 0) {
    if (goFurlough >= 0 && (ch.H <= t.restAt || ctx.engaged === false)) return goFurlough;
    return stay >= 0 ? stay : goFurlough;
  }

  // Occupations : se soigner tant qu'on est en permission, sinon avancer.
  if (ch.H <= t.restAt + 12) {
    i = find(/Prendre une cure/);
    if (i >= 0) return i;
  }
  // Une charge se garde ; on la brigue dès qu'on le peut.
  i = find(/Briguer un office/);
  if (i >= 0) return i;

  /**
   * Demander réparation. L'occasion ne revient pas : le défi ne se porte que
   * sur une carte Idle Time ou en permission, et un affront ravalé le reste.
   * Elle passe donc avant la mutation — mais seulement quand le fer nous est
   * favorable, car trois points de standing et une blessure valent plus cher
   * que l'honneur d'un sous-lieutenant.
   */
  i = find(/Demander réparation/);
  if (i >= 0 && ctx.duelFavorable) return i;

  // On ne demande sa mutation que si l'on croupit loin du feu, ou si son
  // standing est si bas qu'il vaut la peine de le rejouer.
  i = find(/Demander un transfert/);
  if (i >= 0 && (!ctx.engaged || ch.standing <= -2)) return i;
  if (t.schemes) {
    i = pick(/Pratiquer la corruption/, /Empocher/, /Jouer contre la maison/, /Miser/);
    if (i >= 0) return i;
  }

  // Sur une carte Idle Time, faute de charge à briguer ou de mutation à demander,
  // il occupe son temps au hasard plutôt que de toujours courir à la même chose.
  if (/Idle Time/.test(p.title)) {
    const rand = ctx.rng ?? Math.random;
    const usable = p.options
      .map((o, k) => ({ o, k }))
      .filter(({ o }) => !/Ne rien faire/i.test(o.label));
    if (usable.length) return usable[Math.floor(rand() * usable.length)].k;
  }

  // Le zèle paie mieux que la routine.
  i = find(/zèle/i);
  if (i >= 0) return i;

  // À défaut : le gain le plus conforme à son tempérament.
  /** Espérance d'un gain écrit « 4 », « 1D10x3 » ou « 1D10÷2 ». */
  const expected = (expr: string): number => {
    const m = expr.match(/^([12])D10(?:x(\d+))?(?:[÷/](\d+))?/i);
    if (!m) return Number(expr) || 0;
    let v = m[1] === '2' ? 50.5 : 5.5;
    if (m[2]) v *= Number(m[2]);
    if (m[3]) v /= Number(m[3]);
    return v;
  };

  const score = (label: string) => {
    let s = 0;
    // « F+1 », « E+2 », « M+1D10x3 » : chaque gain pèse selon le tempérament
    for (const m of label.matchAll(/\b([NGEFCHM])\s*\+\s*([12]D10(?:x\d+)?(?:[÷/]\d+)?|\d+)/gi)) {
      const key = m[1].toUpperCase() as keyof Traits['weight'];
      // dix francs pèsent à peu près comme un point de qualité
      const scale = key === 'M' ? 0.1 : 1;
      s += expected(m[2]) * scale * (t.weight[key] ?? 1);
    }
    // une dépense pèse contre celui qui tient à sa bourse
    const spend = label.match(/Dépenser (\d+) F|M\s*-\s*(\d+)/);
    if (spend) s -= Number(spend[1] ?? spend[2]) * 0.05 * t.weight.M;
    if (/perdu|Ne rien faire|Renoncer|Décliner|Quitter|S’abstenir/i.test(label)) s -= 3;
    return s;
  };
  let best = 0;
  let bestScore = -Infinity;
  p.options.forEach((o, idx) => {
    const s = score(o.label);
    if (s > bestScore) { bestScore = s; best = idx; }
  });
  return best;
}

// ---------- choisir un rival ----------

/**
 * Contre qui l'on se retourne. La course se gagne aux points de victoire, donc
 * nuire au mieux placé rapporte plus que nuire au premier venu : on classe les
 * rivaux comme le décompte final, grade puis gloire, et l'on frappe en tête.
 * Un service à rendre — porter une mission dangereuse à sa place — se lit à
 * l'envers : c'est le plus menaçant qu'on y envoie.
 */
export function botTarget(
  cands: { idx: number; ch: Character }[],
  kind: 'harm' | 'help' = 'harm',
): number {
  if (!cands.length) return -1;
  const worth = (c: Character) => (c.marechal ? 100 : c.rankIdx) * 1000 + c.G + c.loh * 50;
  const sorted = [...cands].sort((x, y) => worth(y.ch) - worth(x.ch));
  return (kind === 'help' ? sorted[sorted.length - 1] : sorted[0]).idx;
}

// ---------- le duel ----------

/**
 * Quelle carte poser. En défense, la parade sauve et la riposte renvoie le
 * coup ; poser une botte pour répondre à une botte, c'est se faire embrocher.
 * En attaque, on porte l'estoc — et l'on ne pointe « pour tuer » que si l'on a
 * l'estomac de perdre la notice que coûte un mort sur le pré.
 */
export function duelChoice(choices: SwordChoice[], self: Character | null, defending: boolean): number {
  if (!choices.length) return -1;
  const order: SwordChoice['card'][] = defending
    ? ['parry', 'riposte', 'lunge']
    : ['lunge', 'riposte', 'parry'];
  // le sabreur cherche le mort ; les autres se contentent du sang
  const wants: 'kill' | 'wound' = self?.persona === 'sabreur' ? 'kill' : 'wound';
  for (const card of order) {
    const exact = choices.findIndex((c) => c.card === card && (!c.aim || c.aim === wants));
    if (exact >= 0) return exact;
    const any = choices.findIndex((c) => c.card === card);
    if (any >= 0) return any;
  }
  return 0;
}

/**
 * Quelle arme choisir quand on tient le rôle du Burger. Le duel à l'épée
 * récompense l'escrime — et le tireur y reçoit d'office une carte de plus.
 * Contre une bonne lame, le pistolet remet les deux hommes à égalité devant
 * le hasard : c'est là qu'un bourgeois a ses chances.
 */
export function burgerWeapon(drawer: Character): 'sword' | 'pistol' {
  return drawer.F >= 4 ? 'pistol' : 'sword';
}

/**
 * Accepter le fer, ou l'affront. Décliner coûte cinq points de gloire ; se
 * battre en coûte trois de standing et peut coûter la vie. On accepte donc
 * tant qu'on n'est pas nettement le moins bon des deux — et le sabreur
 * accepte toujours.
 */
export function acceptsDuel(self: Character, opponent: { F: number; H: number }): boolean {
  if (self.persona === 'sabreur') return true;
  if (self.H <= traitsOf(self).restAt) return false;
  return self.F + 2 >= opponent.F;
}

/** Part de la bourse qu'il souhaite mettre à l'abri de l'impôt et du pillage. */
export function botMoneyTransfer(ch: Character): number {
  const t = traitsOf(ch);
  if (!t.banks) return 0;
  // on garde de quoi vivre en campagne, le reste dort à Paris
  const keep = 40;
  const spare = ch.mPurse - keep;
  return spare > 20 ? spare : 0;
}
