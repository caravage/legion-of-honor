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

export function Stat({ k, v, bar }: { k: string; v: ReactNode; bar?: number }) {
  return (
    <div className="stat">
      <span className="stat-k">{k}</span>
      <span className="stat-v">{v}</span>
      {bar !== undefined && (
        <span className="stat-bar">
          <i style={{ width: `${Math.max(0, Math.min(1, bar)) * 100}%` }} />
        </span>
      )}
    </div>
  );
}

export function Header({
  season, game, onOpen,
}: { season?: Season; game?: Game; onOpen?: (k: RefKind) => void }) {
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
    </div>
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
