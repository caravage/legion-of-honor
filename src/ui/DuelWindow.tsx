/**
 * Le duel, en fenêtre.
 *
 * La chronique n'en verra qu'une ligne ; ici se joue le détail — la main du
 * Grognard, la carte de l'adversaire, et le compte rendu des passes. La
 * fenêtre ne décide de rien : elle lit `duelView()` et rend la main au moteur
 * par `choose()`, comme n'importe quelle question posée au joueur.
 */
import { Game } from '../engine/game';
import { duelArt, duelBack } from '../engine/data';

/** Quelle image porter, et faut-il la retourner pour montrer la bonne pointe ? */
function art(type: string, aim: 'kill' | 'wound' | undefined, seed: number) {
  const faces = duelArt(type);
  if (!faces.length) return { file: null as string | null, flip: false };
  const face = faces[seed % faces.length];
  // la carte est à double sens : montrer l'autre intention, c'est la retourner
  const flip = !!aim && !!face.natural && face.natural !== aim;
  return { file: face.file, flip };
}

function DuelCard({
  type, aim, seed, small, onClick, title,
}: {
  type: string; aim?: 'kill' | 'wound'; seed: number;
  small?: boolean; onClick?: () => void; title?: string;
}) {
  const { file, flip } = art(type, aim, seed);
  const cls = `duel-card${small ? ' small' : ''}${onClick ? ' playable' : ''}`;
  const inner = file
    ? <img src={file} alt={title ?? type} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
    : <span className="duel-card-fallback">{title ?? type}</span>;
  return onClick
    ? <button className={cls} onClick={onClick} title={title}>{inner}</button>
    : <div className={cls} title={title}>{inner}</div>;
}

function Back({ n }: { n: number }) {
  return (
    <div className="duel-backs" aria-label={`${n} cartes en main`}>
      {Array.from({ length: Math.min(n, 8) }, (_, i) => (
        <img key={i} src={duelBack()} alt="" style={{ left: `${i * 14}px` }} />
      ))}
      <span className="duel-count">{n}</span>
    </div>
  );
}

export function DuelWindow({ game, onChange }: { game: Game; onChange: () => void }) {
  const v = game.duelView();
  if (!v) return null;
  const mine = v.a.mine ? v.a : v.b.mine ? v.b : null;
  const foe = v.a.mine ? v.b : v.a;

  const play = (i: number) => {
    const p = game.pending;
    if (!p) return;
    game.choose(i);
    onChange();
  };

  return (
    <div className="modal-back duel-back-drop">
      <div className="modal duel-window">
        <div className="modal-head">
          <h3>{v.label}</h3>
          <span className="muted">{v.myTurn ? 'à vous de jouer' : 'l’adversaire joue…'}</span>
        </div>

        <div className="duel-field">
          <div className="duel-side">
            <div className="duel-name">{foe.name}</div>
            <Back n={foe.cards} />
          </div>

          <div className="duel-slots">
            {v.table ? (
              <>
                <DuelCard
                  type={v.table.card}
                  aim={v.table.aim}
                  seed={v.journal.length}
                  title={`${v.table.card} — ${v.table.aim === 'kill' ? 'pour tuer' : 'pour blesser'}`}
                />
                <div className="duel-vs">répondez</div>
              </>
            ) : (
              <div className="duel-empty">la première carte ouvre l’assaut</div>
            )}
          </div>

          <div className="duel-side">
            <div className="duel-name">
              {mine ? mine.name : 'vous'}
              <span className="duel-count-inline">{mine ? `${mine.cards} cartes` : ''}</span>
            </div>
            <div className="duel-hand">
              {v.hand.map((c, i) => (
                <DuelCard
                  key={`${c.card}-${c.aim ?? ''}-${i}`}
                  type={c.card}
                  aim={c.aim}
                  seed={i}
                  small
                  title={c.label}
                  onClick={v.myTurn ? () => play(i) : undefined}
                />
              ))}
              {!v.hand.length && <span className="muted">plus une carte en main</span>}
              {v.hand.length > 0 && (
                <p className="duel-hint">
                  Une même carte se pointe des deux côtés : chaque tuile est un coup jouable,
                  non un carton.
                </p>
              )}
            </div>
          </div>
        </div>

        <ol className="duel-journal">
          {v.journal.map((l, i) => <li key={i}>{l}</li>)}
        </ol>
      </div>
    </div>
  );
}
