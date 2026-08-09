export type RNG = () => number;
export const defaultRng: RNG = Math.random;

/** 1D10 : 1..10 */
export function d10(rng: RNG = defaultRng): number {
  return Math.floor(rng() * 10) + 1;
}

/** 1D6 : 1..6 */
export function d6(rng: RNG = defaultRng): number {
  return Math.floor(rng() * 6) + 1;
}

/** 2D10 en pourcentage : 1..100 (dé des dizaines + dé des unités) */
export function d100(rng: RNG = defaultRng): number {
  const t = d10(rng) % 10;
  const o = d10(rng) % 10;
  const v = t * 10 + o;
  return v === 0 ? 100 : v;
}

export interface RollDetail {
  text: string;
  value: number;
}

/**
 * Évalue une expression de dés du jeu : "1D10", "2D10", "+1D10x3", "-1D10x2",
 * "1D10/2up", "2D10/4down", "100-1D10", "+F x2".
 */
export function rollExpr(expr: string | number, rng: RNG = defaultRng, ctx: { F?: number } = {}): RollDetail {
  if (typeof expr === 'number') return { text: String(expr), value: expr };
  let s = expr.replace(/\s+/g, '');
  let sign = 1;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('-')) {
    sign = -1;
    s = s.slice(1);
  }
  if (/^100-1D10$/i.test(s)) {
    const r = d10(rng);
    return { text: `100−${r}`, value: 100 - r };
  }
  const fm = s.match(/^Fx(\d+)$/i);
  if (fm) {
    const v = (ctx.F ?? 0) * Number(fm[1]);
    return { text: `F×${fm[1]}=${v}`, value: sign * v };
  }
  const m = s.match(/^([12])D10(?:x(\d+))?(?:\/(\d+)(up|down))?$/i);
  if (m) {
    const n = Number(m[1]);
    const raw = n === 2 ? d100(rng) : d10(rng);
    let v = raw;
    let txt = `${n}D10=${raw}`;
    if (m[2]) {
      v = v * Number(m[2]);
      txt += `×${m[2]}=${v}`;
    }
    if (m[3]) {
      const dv = Number(m[3]);
      v = m[4].toLowerCase() === 'up' ? Math.ceil(v / dv) : Math.floor(v / dv);
      txt += `/${dv}${m[4] === 'up' ? '↑' : '↓'}=${v}`;
    }
    return { text: txt, value: sign * v };
  }
  return { text: `?(${expr})`, value: 0 };
}
