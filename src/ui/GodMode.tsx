/**
 * L'atelier — de quoi essayer une mécanique sans jouer la carrière qui y mène.
 *
 * Rien ici n'appartient au jeu : ce panneau pose une situation sur la table
 * et rend la main au déroulement ordinaire, qui ne sait pas d'où elle vient.
 */
import { useState } from 'react';
import { Game } from '../engine/game';
import { SEASONS } from '../engine/data';

export function GodMode({
  game, onJump, onClose, onChange,
}: {
  game: Game | null;
  /** Créer une partie et l'amener à cette saison — l'écran d'accueil s'en charge. */
  onJump: (season: number) => void;
  onClose: () => void;
  onChange: () => void;
}) {
  const [season, setSeason] = useState(game?.season ?? 1);
  const [weapon, setWeapon] = useState<'sword' | 'pistol'>('sword');
  const [foe, setFoe] = useState<number | null>(null);
  const [escrime, setEscrime] = useState(5);

  const rivals = game ? game.chars.map((c, i) => ({ c, i })).filter((r) => r.i > 0 && !r.c.absent) : [];

  const duel = () => {
    if (!game) return;
    game.testDuel(foe, weapon, escrime);
    onChange();
    onClose();
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal god" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>⚙ Atelier</h3>
          <button className="link-btn" onClick={onClose}>✕ fermer</button>
        </div>
        <div className="modal-body">
          <p className="muted">
            De quoi éprouver une mécanique sans jouer les vingt-quatre années qui y mènent.
            Ce que l’on fait ici compte pour de bon dans la partie en cours.
          </p>

          <section className="god-block">
            <h4>Commencer à une saison donnée</h4>
            <div className="season-grid">
              {SEASONS.map((s) => (
                <button
                  key={s.num}
                  className={s.num === season ? 'chip on' : 'chip'}
                  title={`${s.name} · ${s.years}`}
                  onClick={() => setSeason(s.num)}
                >
                  {s.roman}
                </button>
              ))}
            </div>
            <p className="muted">
              {SEASONS[season - 1].name} · {SEASONS[season - 1].years}
            </p>
            <button className="primary" onClick={() => { onJump(season); onClose(); }}>
              {game ? 'Reprendre à cette saison' : 'Nouvelle carrière à cette saison'}
            </button>
          </section>

          <section className="god-block">
            <h4>Éprouver le duel</h4>
            {!game ? (
              <p className="muted">Commencez une carrière : il faut deux hommes pour un duel.</p>
            ) : (
              <>
                <div className="god-row">
                  <span>Adversaire</span>
                  <button className={foe === null ? 'chip on' : 'chip'} onClick={() => setFoe(null)}>
                    un inconnu (sans feuille)
                  </button>
                  {rivals.map((r) => (
                    <button
                      key={r.i}
                      className={foe === r.i ? 'chip on' : 'chip'}
                      onClick={() => setFoe(r.i)}
                    >
                      {r.c.name.split(' ').pop()} (escrime {r.c.F})
                    </button>
                  ))}
                </div>
                {foe === null && (
                  <div className="god-row">
                    <span>Son escrime</span>
                    {[1, 3, 5, 7, 9].map((f) => (
                      <button key={f} className={f === escrime ? 'chip on' : 'chip'} onClick={() => setEscrime(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                )}
                <div className="god-row">
                  <span>Arme</span>
                  <button className={weapon === 'sword' ? 'chip on' : 'chip'} onClick={() => setWeapon('sword')}>
                    l’épée
                  </button>
                  <button className={weapon === 'pistol' ? 'chip on' : 'chip'} onClick={() => setWeapon('pistol')}>
                    le pistolet
                  </button>
                </div>
                <p className="muted">
                  Un inconnu sans feuille ne saigne ni ne gagne rien — c’est le régime du Burger.
                  Un concurrent, lui, encaisse les résultats du duel.
                </p>
                <button className="primary" onClick={duel}>Sur le pré</button>
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
