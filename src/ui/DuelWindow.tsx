/**
 * Le duel, en fenêtre : main adverse en haut, table au centre, main du
 * Grognard en bas. La chronique n'en verra qu'une ligne.
 */
import { useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game';
import { duelArt, duelBack } from '../engine/data';
import type { Aim } from '../engine/duel';

const NOM: Record<string, string> = {
  lunge: 'Botte', riposte: 'Riposte', parry: 'Parade', fire: 'Feu',
};

/** Quelle vignette porter, et faut-il la retourner pour montrer la bonne pointe ? */
function art(type: string, aim: Aim | undefined, seed: number) {
  const faces = duelArt(type);
  if (!faces.length) return { file: null as string | null, flip: false };
  const face = faces[seed % faces.length];
  const flip = !!aim && !!face.natural && face.natural !== aim;
  return { file: face.file, flip };
}

function Carte({
  type, aim, seed, taille = 'grande', onClick, titre, actif,
}: {
  type: string; aim?: Aim; seed: number;
  taille?: 'grande' | 'moyenne';
  onClick?: () => void; titre?: string; actif?: boolean;
}) {
  const { file, flip } = art(type, aim, seed);
  const cls = `duel-card ${taille}${onClick ? ' playable' : ''}${actif ? ' choisie' : ''}`;
  const img = file
    ? <img src={file} alt={titre ?? type} style={flip ? { transform: 'rotate(180deg)' } : undefined} />
    : <span className="duel-card-fallback">{NOM[type] ?? type}</span>;
  return onClick
    ? <button className={cls} onClick={onClick} title={titre}>{img}</button>
    : <div className={cls} title={titre}>{img}</div>;
}

/** Un d10 figé sur sa face, ou qui roule le temps d'un instant. */
function De({ face, roule }: { face: number; roule: boolean }) {
  const [v, setV] = useState(roule ? 0 : face);
  useEffect(() => {
    if (!roule) { setV(face); return; }
    const t = setInterval(() => setV(Math.floor(Math.random() * 10)), 70);
    const stop = setTimeout(() => { clearInterval(t); setV(face); }, 620);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [face, roule]);
  return (
    <span className={`duel-de${roule ? ' roule' : ''}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <polygon points="50,3 97,38 78,93 22,93 3,38" />
      </svg>
      <b>{v}</b>
    </span>
  );
}

export function DuelWindow({ game, onChange }: { game: Game; onChange: () => void }) {
  const v = game.duelView();
  const [choisie, setChoisie] = useState<number | null>(null);
  const finJournal = useRef<HTMLLIElement | null>(null);

  useEffect(() => { finJournal.current?.scrollIntoView({ block: 'nearest' }); });
  useEffect(() => { setChoisie(null); }, [v?.journal.length]);

  if (!v) return null;

  const jouer = (i: number, aim: Aim) => { game.playDuelCard2(i, aim); setChoisie(null); onChange(); };
  const repondre = (i: number) => { game.choose(i); onChange(); };
  const lancer = () => { game.duelRollWound(); onChange(); };
  const fermer = () => { game.duelDismiss(); onChange(); };

  return (
    <div className="modal-back duel-back-drop">
      <div className="modal duel-window">
        <div className="modal-head">
          <h3>{v.label}</h3>
          {!v.done && v.turnName && (
            <span className={`duel-turn${v.myTurn ? ' mine' : ''}`}>
              {v.myTurn ? 'À vous de jouer' : `Au tour de ${v.turnName}`}
            </span>
          )}
        </div>

        <div className="duel-table">
          {!v.done && <div className="duel-row foe">
            <span className="duel-name">{v.foe.name}</span>
            <span className="duel-backs">
              {Array.from({ length: Math.min(v.foe.cards, 10) }, (_, i) => (
                <img key={i} src={duelBack()} alt="" />
              ))}
            </span>
            <span className="duel-count">{v.foe.cards}</span>
          </div>}

          <div className={`duel-row slots${v.done ? ' fini' : ''}`}>
            {v.table ? (
              <Carte
                type={v.table.card}
                aim={v.table.aim}
                seed={v.journal.length}
                titre={`${NOM[v.table.card] ?? v.table.card} — ${v.table.aim === 'kill' ? 'pour tuer' : 'pour blesser'}`}
              />
            ) : (
              <div className="duel-empty">
                {v.done ? '' : 'la première carte ouvre l’assaut'}
              </div>
            )}
            {v.roll && (
              <div className="duel-roll">
                <De face={v.roll.faces[0]} roule />
                <De face={v.roll.faces[1]} roule />
                <span className="duel-roll-txt">
                  {v.roll.bonus ? `+${v.roll.bonus} → ${v.roll.total}` : `→ ${v.roll.total}`}
                  <b>{v.roll.result}</b>
                </span>
              </div>
            )}
          </div>

          {!v.done && <div className="duel-row mine">
            <span className="duel-name">
              {v.mine ? v.mine.name : ''}
              {v.mine ? <i>{v.mine.cards} cartes</i> : null}
            </span>
            <div className="duel-hand">
              {v.hand.map((c, i) => (
                <span className="duel-slot" key={i}>
                  <Carte
                    type={c.card}
                    aim={choisie === i ? undefined : 'wound'}
                    seed={i}
                    taille="moyenne"
                    titre={NOM[c.card] ?? c.card}
                    actif={choisie === i}
                    onClick={() => (c.aims.length ? setChoisie(choisie === i ? null : i) : jouer(i, 'wound'))}
                  />
                  {choisie === i && c.aims.length > 0 && (
                    <span className="duel-aims">
                      <button onClick={() => jouer(i, 'kill')}>pour tuer</button>
                      <button onClick={() => jouer(i, 'wound')}>pour blesser</button>
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>}
        </div>

        <div className="duel-foot">
          <ol className="duel-journal">
            {v.journal.map((l, i) => (
              <li key={i} ref={i === v.journal.length - 1 ? finJournal : undefined}>{l}</li>
            ))}
          </ol>

          <div className="duel-actions">
            {v.ask && (
              <>
                <p className="duel-ask">{v.ask.title}</p>
                {v.ask.options.map((o, i) => (
                  <button key={i} className="primary" onClick={() => repondre(i)}>{o}</button>
                ))}
              </>
            )}
            {v.awaitingRoll && (
              <button className="primary big" onClick={lancer}>🎲 Lancer la blessure</button>
            )}
            {v.done && (
              <button className="primary big" onClick={fermer}>Quitter le pré ▸</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
