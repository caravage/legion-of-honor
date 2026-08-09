/** Les feuilles de Grognard : la vôtre à demeure, celles des concurrents à la demande. */
import type { Game } from '../engine/game';
import { commandName } from '../engine/data';
import type { Character } from '../engine/types';
import { readHall } from '../engine/storage';
import { RANK_NAMES, Row, SheetGroup, Stat, absentLabel, cap } from './bits';

const rankOf = (c: Character) => (c.marechal ? 'Maréchal' : RANK_NAMES[c.rankIdx]);

/**
 * Une feuille de Grognard, la vôtre ou celle d'un concurrent : même identité,
 * mêmes trois groupes chiffrés. Ne diffèrent que ce qui touche à l'avenir — le
 * grade visé, que vous seul poursuivez, glissé en `aim` — et le chapeau de
 * Napoléon, qui dispense les généraux de standing.
 */
function Sheet({
  ch, aim, standing,
}: { ch: Character; aim?: React.ReactNode; standing?: string }) {
  return (
    <>
      <div className="sheet-rank">
        {rankOf(ch)}
        {ch.title ? ` · ${cap(ch.title)}` : ''}
      </div>
      <div className="sheet-cmd">{commandName(ch.assignment) || '—'}</div>
      {ch.absent && <div className="absent">Absent — {absentLabel(ch.absent.type)}</div>}
      {aim}

      <SheetGroup title="Qualités">
        <Stat k="Notice" v={ch.N} />
        <Stat k="Gloire" v={ch.G} />
        <Stat k="Expérience" v={ch.E} />
        <Stat k="Charme" v={ch.C} />
        <Stat k="Escrime" v={ch.F} />
        <Stat k="Santé" v={ch.H} bar={ch.H / 99} />
        <Stat k="Standing" v={standing ?? (ch.standing >= 0 ? `+${ch.standing}` : ch.standing)} />
      </SheetGroup>

      <SheetGroup title="Fortune">
        <Stat k="Paris" v={`${ch.mParis} F`} />
        <Stat k="Bourse" v={`${ch.mPurse} F`} />
      </SheetGroup>

      <SheetGroup title="Honneurs">
        <Stat
          k={ch.armsOfHonor ? 'Arms of Honor' : 'Légion d’Honneur'}
          v={ch.loh > 0 ? `niveau ${ch.loh}` : '—'}
        />
        <Stat k="Titre" v={ch.title ? cap(ch.title) : '—'} />
        <Stat k="Office" v={ch.office ? 'oui' : '—'} />
      </SheetGroup>
    </>
  );
}

export function GrognardSheet({ game, ch }: { game: Game; ch: Character }) {
  const next = game.nextRank();
  const aim = next && (
    <div className="next-rank">
      <span className="nr-label">Vers {next.name}</span>
      {next.ready ? (
        <span className="nr-ready">seuils atteints</span>
      ) : (
        <span className="nr-need">
          {next.requiresN && next.need.N > 0 && <b>N&nbsp;{next.need.N}</b>}
          {next.need.G > 0 && <b>G&nbsp;{next.need.G}</b>}
          {next.need.E > 0 && <b>E&nbsp;{next.need.E}</b>}
        </span>
      )}
    </div>
  );
  return <Sheet ch={ch} aim={aim} standing={game.isGeneralOfficer() ? '🎩' : undefined} />;
}

/* ---------------- Concurrents ---------------- */

export function Rivals({
  game, all, onOpen,
}: { game: Game; all: Character[]; onOpen: (i: number | null) => void }) {
  // dans l'ordre du tour, de gauche à droite
  const order = game.turnOrder();
  return (
    <div className="rivals-bar">
      {order.map((i) => {
        const c = all[i] ?? game.chars[i];
        return (
          <button
            key={i}
            className={`rival${i === 0 ? ' is-player' : ''}${i === game.active ? ' acting' : ''}`}
            onClick={() => onOpen(i)}
            title="Voir la feuille"
          >
            <div className="rival-name">
              {i === game.senior && (
                <span className="senior-star" title="Senior Grognard : il ouvre le tour">⭐</span>
              )}
              {c.name}
              {i === 0 && <span className="tag-you">vous</span>}
            </div>
            <div className="rival-line">
              {rankOf(c)}
              {c.title ? ` · ${cap(c.title)}` : ''}
            </div>
            <div className="rival-cmd">{commandName(c.assignment) || '—'}</div>
            <div className="rival-health">
              <i style={{ width: `${Math.max(0, Math.min(100, c.H))}%` }} />
              <span>{c.H}</span>
            </div>
            <div className="rival-stats">
              <span>G {c.G}</span>
              <span>LoH {c.loh}</span>
              <span>{c.mParis + c.mPurse} F</span>
            </div>
            {c.absent && <div className="rival-absent">{absentLabel(c.absent.type)}</div>}
          </button>
        );
      })}
    </div>
  );
}

/** Feuille complète d'un concurrent, en survol de fenêtre. */
export function RivalSheet({
  idx, ch, onClose,
}: { idx: number; ch: Character; onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{ch.name}</h3>
          <button className="link-btn" onClick={onClose}>✕ fermer</button>
        </div>
        <div className="modal-body">
          <div className="sheet">
            <Sheet ch={ch} />
            {idx > 0 && <p className="muted">Son tempérament reste son secret.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Mise en place guidée ---------------- */

export function SetupSheet({ game, revealedRolls }: { game: Game; revealedRolls: number }) {
  return (
    <table className="setup-table">
      <tbody>
        {game.setupSteps().map((s, i) => {
          // n'affiche la valeur qu'une fois le jet validé par le joueur
          const shown = i < revealedRolls ? s.text : undefined;
          return (
            <tr key={s.id} className={shown ? '' : 'pendingrow'}>
              <td>{s.label}</td>
              <td>{shown ? shown.split('→').pop()!.trim() : s.expr}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/* ---------------- Fin de carrière ---------------- */

export function ScoreView({ game }: { game: Game }) {
  const s = game.score();
  const f = game.finalScore();
  return (
    <>
      {game.victory && <div className="victory-banner">🇫🇷 Victoire à Mont St. Jean — l’immortalité !</div>}
      <table className="score">
        <tbody>
          <Row k="Grade final" v={s.rank} />
          <Row k="Titre" v={s.title ? cap(s.title) : '—'} />
          <Row k="Gloire" v={`${s.G} (+${f.glory} pts)`} />
          <Row k="Légion d’Honneur" v={s.loh > 0 ? `niveau ${s.loh} (+${f.loh} pts)` : '—'} />
          <Row k="Fortune" v={`${s.money} F (+${f.fortune} pts)`} />
          <Row k="Points de grade" v={`+${f.rank}`} />
          {f.titles > 0 && <Row k="Points de titre" v={`+${f.titles}`} />}
          {f.victory > 0 && <Row k="Mont St. Jean" v={`+${f.victory}`} />}
          <Row k="Score de carrière" v={<b>{f.total}</b>} />
        </tbody>
      </table>
      <HallOfFame />
    </>
  );
}

function HallOfFame() {
  const list = readHall().slice(0, 10);
  if (!list.length) return null;
  return (
    <div className="hall">
      <div className="group-title">Panthéon des Grognards</div>
      <table className="score">
        <tbody>
          {list.map((e, i) => (
            <tr key={i}>
              <td>
                {e.victory ? '🇫🇷 ' : ''}
                {e.name} — {e.rank}
                {e.title ? ` · ${cap(e.title)}` : ''}
              </td>
              <td>{e.total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
