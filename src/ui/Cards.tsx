/** Ce qui montre une carte : son dos, sa photo, sa transcription, son agrandissement. */
import { useState } from 'react';
import { cardImage, cardNumber, commandName } from '../engine/data';
import type { DeckEntry } from '../engine/game';
import type { CampaignCard, CombatCard, Effects, GarrisonCard } from '../engine/cards';

/** Le dos que le joueur retourne lui-même ; un concurrent, lui, passe par un bouton. */
export function CardBack({
  deck, title, label, onDraw,
}: { deck: 'garrison' | 'campaign' | 'combat'; title: string; label: string; onDraw: () => void }) {
  return (
    <div className="draw-zone">
      <div className="draw-title">{title}</div>
      <button className="card-back" onClick={onDraw} autoFocus title={label}>
        <img src={`/cards/backs/${deck}.jpg`} alt="" />
        <span className="back-hint">{label}</span>
      </button>
    </div>
  );
}

/** Carte agrandie au survol d'une vignette du journal. */
export function CardPeek({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="peek" onMouseLeave={onClose}>
      <img src={src} alt="" />
    </div>
  );
}

export function CardView({ entry, category }: { entry: DeckEntry; category: string }) {
  const c = entry.card;
  const [showText, setShowText] = useState(false);
  const img = cardImage(c.id);
  const num = cardNumber(c.id);
  if (!img) {
    // toutes les cartes ont une image ; ce cas ne survient que si un fichier manque
    return (
      <div className="placeholder" key={c.id + c.name}>
        {c.name} — image absente
      </div>
    );
  }
  return (
    <div className="card-photo" key={c.id + c.name}>
      <img src={img} alt={c.name} />
      <div className="card-caption">
        <span>
          {c.name}
          {num ? ` · n° ${num}` : ''}
        </span>
        <button className="link" onClick={() => setShowText((v) => !v)}>
          {showText ? 'masquer le détail' : 'détail'}
        </button>
      </div>
      {showText && (
        <div className="card-transcript">
          <CardContent c={c} category={category} />
        </div>
      )}
    </div>
  );
}

/** Une carte vue de la transcription : tous les champs possibles, aucun garanti. */
type CardFace = Partial<GarrisonCard & CampaignCard & CombatCard>;

function CardContent({ c: card, category }: { c: DeckEntry['card']; category: string }) {
  // Un seul élargissement, ici : la transcription parcourt les champs sans
  // savoir de quel deck vient la carte. Le type de la prop, lui, reste strict.
  const c = card as CardFace;
  if (c.idleTime || c.actions) {
    return (
      <>
        <div>
          <b>Pick an Action :</b>
        </div>
        <ul>
          {(c.actions ?? []).map((a, i) => (
            <li key={i}>{describeEffects(a, a.label)}</li>
          ))}
        </ul>
        <div className="card-note">
          Meet a Lady · Request Transfer · Seek Office · Challenge · Corruption · Gamble
        </div>
      </>
    );
  }
  const rows: JSX.Element[] = [];
  if (c.perRank) {
    for (const cat of ['line', 'field', 'general'] as const) {
      const b = c.perRank[cat];
      if (!b) continue;
      rows.push(
        <div key={cat} className={`rank-line ${cat === category ? 'me' : ''}`}>
          <b>{{ line: 'Line', field: 'Field', general: 'General' }[cat]} :</b>{' '}
          {describeEffects(b, b.label)}
        </div>,
      );
    }
  }
  if (c.effects) rows.push(<div key="fx">{describeEffects(c.effects)}</div>);
  if (c.choice) {
    rows.push(
      <div key="choice" className="card-note">
        Choix à faire.
      </div>,
    );
  }
  if (c.roll) {
    rows.push(
      <div key="roll">
        <b>{c.roll.die ?? '1D10'} :</b>
        <ul>
          {Object.entries(c.roll.results ?? {}).map(([range, eff]) => (
            <li key={range}>
              {range} : {typeof eff === 'string' ? eff : describeEffects(eff)}
            </li>
          ))}
        </ul>
      </div>,
    );
  }
  for (const key of ['effect', 'special', 'condition', 'note'] as const) {
    if (typeof c[key] === 'string') {
      rows.push(
        <div key={key} className="card-note">
          {c[key]}
        </div>,
      );
    }
  }
  if (c.zeal) rows.push(<div key="zeal">Zeal + {c.zeal}</div>);
  if (c.commands) {
    rows.push(
      <div key="cmds" className="card-note">
        Engagés : {c.commands.map((x) => commandName(x)).join(', ')}
      </div>,
    );
  }
  if (c.subEvents) {
    rows.push(
      <div key="sub">
        {c.subEvents.map((e, i) => (
          <div key={i} className="rank-line">
            <b>{e.name}</b>
            {e.commands ? ` — ${e.commands.map((x) => commandName(x)).join(', ')}` : ''}
          </div>
        ))}
      </div>,
    );
  }
  return rows.length ? <>{rows}</> : <div className="card-note">—</div>;
}

const STAT_LABEL: Record<string, string> = {
  N: 'N', G: 'G', E: 'E', M: 'M', H: 'H', C: 'C', F: 'F', S: 'S', W: 'W', P: 'P',
};

function describeEffects(o: Effects | null | undefined, label?: string): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(o ?? {})) {
    if (k === 'label' || k === 'zeal') continue;
    if (typeof v !== 'number' && typeof v !== 'string') continue;
    const key = STAT_LABEL[k] ?? k;
    parts.push(typeof v === 'number' ? `${key}${v >= 0 ? '+' : ''}${v}` : `${key} ${v}`);
  }
  const zeal = o?.zeal;
  if (zeal) parts.push(`Zeal+${zeal}`);
  const body = parts.join(', ');
  return label ? (body ? `${label} (${body})` : label) : body;
}
