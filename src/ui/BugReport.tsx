/**
 * Signaler un bug sans quitter la partie.
 *
 * Le rapport emporte l'état des Grognards, la carte sur la table et la fin du
 * journal : de quoi retrouver une situation sans avoir à la reproduire. Il n'y
 * a pas de serveur, donc il se télécharge — le fichier se joint à un message.
 */
import { useState } from 'react';
import type { Game } from '../engine/game';

export function BugReport({ game, onClose }: { game: Game; onClose: () => void }) {
  const [texte, setTexte] = useState('');
  const [fait, setFait] = useState(false);

  const enregistrer = () => {
    const rapport = game.bugReport(texte.trim() || '(sans description)');
    const blob = new Blob([JSON.stringify(rapport, null, 1)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bug-saison${rapport.ou.saison}-${rapport.ou.round ?? 'x'}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setFait(true);
  };

  const copier = async () => {
    const rapport = game.bugReport(texte.trim() || '(sans description)');
    await navigator.clipboard.writeText(JSON.stringify(rapport, null, 1));
    setFait(true);
  };

  const ou = game.bugReport('').ou;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Signaler un bug</h3>
          <button className="link-btn" onClick={onClose}>✕ fermer</button>
        </div>
        <div className="modal-body">
          <p className="muted">
            Décrivez ce qui vous a paru faux. Le rapport emporte l’état de la partie,
            la carte en cours et les 150 dernières lignes du journal.
          </p>
          <div className="bug-ou">
            Saison {ou.saison} · round {ou.round ?? '—'} · étape {ou.etape}
            {game.currentCard && <> · carte « {game.currentCard.card.name} »</>}
          </div>
          <textarea
            className="bug-texte"
            value={texte}
            autoFocus
            placeholder="Exemple : les gains de la bataille se sont écrits sous la carte Reconnaissance."
            onChange={(e) => { setTexte(e.target.value); setFait(false); }}
          />
          <div className="options">
            <button className="primary" onClick={enregistrer}>Télécharger le rapport</button>
            <button onClick={copier}>Copier dans le presse-papier</button>
          </div>
          {fait && <p className="bug-ok">Rapport prêt — joignez-le à votre message.</p>}
        </div>
      </div>
    </div>
  );
}
