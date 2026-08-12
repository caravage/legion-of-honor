/** Les feuilles de Grognard : la vôtre à demeure, celles des concurrents à la demande. */
import type { Game } from '../engine/game';
import { commandName } from '../engine/data';
import type { Character } from '../engine/types';
import { readHall } from '../engine/storage';
import { RANK_NAMES, Row, SheetGroup, Stat, absentLabel, cap } from './bits';
import { BADGE, getPortraits, portraitSrc } from './portraits';

const rankOf = (c: Character) => (c.marechal ? 'Maréchal' : RANK_NAMES[c.rankIdx]);

/** Une case de la grille de badges : l'image, un nom court, le chiffre en grand. */
function BadgeTile({ art, name, value }: { art: string; name: string; value: React.ReactNode }) {
  return (
    <div className="badge-tile">
      <img src={art} alt="" />
      <span className="txt">
        <span className="name">{name}</span>
        <span className="num">{value}</span>
      </span>
    </div>
  );
}

/**
 * Une feuille de Grognard, la vôtre ou celle d'un concurrent : même identité,
 * mêmes trois groupes. Qualités et Fortune passent en badges — Honneurs
 * reste en texte, faute d'image pour LoH, Titre et Office. Ne diffèrent que
 * ce qui touche à l'avenir — le grade visé, que vous seul poursuivez, glissé
 * en `aim` — et le chapeau de Napoléon, qui dispense les généraux de standing.
 */
function Sheet({
  ch, portrait, aim, standing,
}: { ch: Character; portrait: number; aim?: React.ReactNode; standing?: string }) {
  return (
    <>
      <div className="badge-head">
        <img className="card-tile" src={portraitSrc(portrait)} alt="" width={104} height={104} />
        <div>
          <div className="sheet-name">{ch.name}</div>
          <div className="sheet-rank">
            {rankOf(ch)}
            {ch.title ? ` · ${cap(ch.title)}` : ''}
          </div>
          <div className="sheet-cmd">{commandName(ch.assignment) || '—'}</div>
        </div>
      </div>
      {ch.absent && <div className="absent">Absent — {absentLabel(ch.absent.type)}</div>}
      {aim}

      <div className="health-strip">
        <span className="name">Santé</span>
        <span className="track"><i style={{ width: `${Math.max(0, Math.min(1, ch.H / 99)) * 100}%` }} /></span>
        <span className="num">{ch.H}</span>
      </div>

      <div className="b-group-title">Qualités</div>
      <div className="badge-grid">
        <BadgeTile art={BADGE.N} name="Notice" value={ch.N} />
        <BadgeTile art={BADGE.G} name="Gloire" value={ch.G} />
        <BadgeTile art={BADGE.E} name={'Expé­rience'} value={ch.E} />
        <BadgeTile art={BADGE.C} name="Cha." value={ch.C} />
        <BadgeTile art={BADGE.F} name="Esc." value={ch.F} />
        <BadgeTile
          art={BADGE.S}
          name="Sta."
          value={standing ?? (ch.standing >= 0 ? `+${ch.standing}` : ch.standing)}
        />
      </div>

      <div className="b-group-title">Fortune</div>
      <div className="badge-grid fortune">
        <BadgeTile art={BADGE.mParis} name="Argent Paris" value={`${ch.mParis} F`} />
        <BadgeTile art={BADGE.mPurse} name="Argent Bourse" value={`${ch.mPurse} F`} />
      </div>

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
  // GrognardSheet ne sert que la vôtre : toujours l'index 0, même en relecture
  // où `ch` est un instantané et ne partage plus l'identité de `game.chars[0]`.
  const portrait = getPortraits(game)[0];
  return (
    <Sheet ch={ch} portrait={portrait} aim={aim} standing={game.isGeneralOfficer() ? '🎩' : undefined} />
  );
}

/* ---------------- Concurrents ---------------- */

export function Rivals({
  game, all, onOpen,
}: { game: Game; all: Character[]; onOpen: (i: number | null) => void }) {
  // dans l'ordre du tour, de gauche à droite
  const order = game.turnOrder();
  const portraits = getPortraits(game);
  return (
    <div className="rivals-bar">
      {order.map((i) => {
        const c = all[i] ?? game.chars[i];
        return (
          <button
            key={i}
            className={`rival${i === 0 ? ' is-player' : ''}${i === game.turnHolder ? ' acting' : ''}`}
            onClick={() => onOpen(i)}
            title="Voir la feuille"
          >
            <img className="rival-portrait" src={portraitSrc(portraits[i])} alt="" />
            <div className="rival-text">
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
              <div className="rival-cmd">
                {commandName(c.assignment) || '—'}
                <span className="rival-standing">
                  {c.marechal || rankOf(c).startsWith('Général')
                    ? '🎩'
                    : `S ${c.standing >= 0 ? '+' : ''}${c.standing}`}
                </span>
              </div>
              <div className="rival-health">
                <i style={{ width: `${Math.max(0, Math.min(100, c.H))}%` }} />
                <span>{c.H}</span>
              </div>
              {c.absent && <div className="rival-absent">{absentLabel(c.absent.type)}</div>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Feuille complète d'un concurrent, en survol de fenêtre. */
export function RivalSheet({
  game, idx, ch, onClose,
}: { game: Game; idx: number; ch: Character; onClose: () => void }) {
  const portrait = getPortraits(game)[idx];
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head solo">
          <button className="link-btn" onClick={onClose}>✕ fermer</button>
        </div>
        <div className="modal-body">
          <div className="sheet">
            <Sheet ch={ch} portrait={portrait} />
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
