/** Pièces communes : libellés, lignes de tableau, bandeau, fil des étapes. */
import type { ReactNode } from 'react';
import type { Game } from '../engine/game';
import { RANKS } from '../engine/data';
import type { PhaseStep } from '../engine/types';
import type { Season } from '../engine/tables';
import type { RefKind } from './Reference';

export const RANK_NAMES: string[] = RANKS.map((r) => r.name);

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function absentLabel(t: string): string {
  const m: Record<string, string> = {
    furlough: 'en permission',
    convalescence: 'en convalescence',
    retirement: 'en retraite',
    death: 'mort (retour à la prochaine saison)',
    prisoner: 'prisonnier de guerre',
    'bonapartist-wait': 'attend le retour de l’Empereur',
    'royalist-retired': 'retiré (royaliste)',
  };
  return m[t] ?? t;
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <tr>
      <td>{k}</td>
      <td>{v}</td>
    </tr>
  );
}

export function SheetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sheet-group">
      <div className="group-title">{title}</div>
      {children}
    </div>
  );
}

export function Stat({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-k">{k}</span>
      <span className="stat-v">{v}</span>
    </div>
  );
}

export function Header({
  season, game, onOpen, onGod,
}: { season?: Season; game?: Game; onOpen?: (k: RefKind) => void; onGod?: () => void }) {
  return (
    <div className="app-header">
      <h1>
        Legion of <b>Honor</b>
      </h1>
      <span className="sub">
        {season
          ? `Saison ${season.roman} · ${season.name} · ${season.years}`
          : 'La gloire dans l’armée de Napoléon'}
      </span>
      {game && onOpen && (
        <nav className="header-nav">
          <button className="link-btn" onClick={() => onOpen('chronicles')}>
            Chroniques{game.chronicles.length ? ' (' + game.chronicles.length + ')' : ''}
          </button>
          <button className="link-btn" onClick={() => onOpen('cards')}>Cartes du round</button>
          <button className="link-btn" onClick={() => onOpen('ranks')}>Grades</button>
          <button className="link-btn" onClick={() => onOpen('opportunity')}>Opportunites</button>
          <button className="link-btn bug" onClick={() => onOpen('bug')}>🐞 Signaler un bug</button>
        </nav>
      )}
      {onGod && (
        <button className="gear" title="Atelier — éprouver une mécanique" onClick={onGod}>
          <GearIcon />
          <span>Atelier</span>
        </button>
      )}
    </div>
  );
}

/**
 * La roue dentée, dessinée plutôt qu'écrite : le caractère ⚙ tombe dans une
 * police d'emoji qui impose sa propre couleur, et se perdait sur le bandeau
 * sombre. Un tracé suit `currentColor`.
 */
function GearIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 5.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Zm0 1.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Z"
      />
      <path
        fill="currentColor"
        d="m6.9 0.6-.3 1.6a5.9 5.9 0 0 0-1.3.8L3.8 2.4 2 5.6l1.2 1.1a6 6 0 0 0 0 1.6L2 9.4l1.8 3.2 1.5-.6c.4.3.8.6 1.3.8l.3 1.6h3.2l.3-1.6c.5-.2.9-.5 1.3-.8l1.5.6 1.8-3.2-1.2-1.1a6 6 0 0 0 0-1.6L14 5.6l-1.8-3.2-1.5.6a5.9 5.9 0 0 0-1.3-.8L9.1.6H6.9Zm1.2 1.4h1l.2 1.4.5.2c.5.2.9.4 1.3.8l.4.3 1.3-.5.5.9-1 .9.1.5a4.6 4.6 0 0 1 0 1.4l-.1.5 1 .9-.5.9-1.3-.5-.4.3c-.4.4-.8.6-1.3.8l-.5.2-.2 1.4h-1l-.2-1.4-.5-.2a4.5 4.5 0 0 1-1.3-.8l-.4-.3-1.3.5-.5-.9 1-.9-.1-.5a4.6 4.6 0 0 1 0-1.4l.1-.5-1-.9.5-.9 1.3.5.4-.3c.4-.4.8-.6 1.3-.8l.5-.2.2-1.4Z"
      />
    </svg>
  );
}

/* ---------------- Fil des étapes ---------------- */

export function ProgressBar({ prog }: { prog: ReturnType<Game['progress']> }) {
  if (prog.blockKind === 'end') {
    return (
      <div className="progress">
        <div className="progress-head">Partie terminée</div>
      </div>
    );
  }
  return (
    <div className="progress">
      <div className="progress-head">
        <span className="block-label">{prog.blockLabel}</span>
        {prog.roundCode && (
          <>
            <span className="round-code">{prog.roundCode}</span>
            <span className="counter">
              round {prog.roundNum}/{prog.roundTotal}
            </span>
          </>
        )}
        {prog.cardTotal > 0 && prog.blockKind !== 'segment' && (
          <span className="counter">
            carte {prog.cardNum}/{prog.cardTotal}
          </span>
        )}
      </div>
      <ol className="steps">
        {prog.steps.map((s) => (
          <Step key={s.id} s={s} />
        ))}
      </ol>
    </div>
  );
}

function Step({ s }: { s: PhaseStep }) {
  return (
    <li className={`step step-${s.state}`} title={s.note ?? ''}>
      <span className="dot" />
      <span className="step-label">{s.label}</span>
      {s.state === 'na' && <span className="tag">n/a</span>}
      {s.state === 'missing' && <span className="tag tag-missing">à faire</span>}
    </li>
  );
}
