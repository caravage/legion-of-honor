import { useEffect, useRef, useState } from 'react';
import { Game } from '../engine/game';
import type { SetupMode } from '../engine/game';
import { generateName } from '../engine/names';
import { pushHall } from '../engine/storage';
import { Reference, RefKind } from './Reference';
import { Header, ProgressBar } from './bits';
import { CardBack, CardPeek, CardView } from './Cards';
import { DiceTray } from './Dice';
import { LogView } from './Chronicle';
import { GrognardSheet, Rivals, RivalSheet, ScoreView, SetupSheet } from './Sheets';

export default function App() {
  const gameRef = useRef<Game | null>(null);
  const [, setTick] = useState(0);
  const [revealed, setRevealed] = useState(0);
  const [name, setName] = useState('');
  const [rolledName, setRolledName] = useState<string[] | null>(null);
  const [peek, setPeek] = useState<string | null>(null);
  const [modal, setModal] = useState<RefKind | null>(null);
  const [bots, setBots] = useState(0);
  const [sheetOf, setSheetOf] = useState<number | null>(null);
  const archivedRef = useRef(false);
  const refresh = () => setTick((t) => t + 1);

  const game = gameRef.current;

  // en fin de partie : inscription au palmarès et effacement de la sauvegarde
  useEffect(() => {
    const g = gameRef.current;
    if (g?.over && !archivedRef.current) {
      archivedRef.current = true;
      Game.clearSave();
      pushHall({
        name: g.me.name,
        rank: g.rankName(),
        title: g.me.title,
        G: g.me.G,
        loh: g.me.loh,
        money: g.me.mParis + g.me.mPurse,
        victory: g.victory,
        total: g.finalScore().total,
        date: new Date().toISOString().slice(0, 10),
      });
    }
  });

  const start = (mode: SetupMode) => {
    gameRef.current = new Game(name.trim(), Math.random, mode, bots);
    archivedRef.current = false;
    setRevealed(0);
    refresh();
  };

  const resume = () => {
    const g = Game.load();
    if (!g) return;
    gameRef.current = g;
    archivedRef.current = g.over;
    setRevealed(g.log.length);
    refresh();
  };

  if (!game) {
    return (
      <>
        <Header />
        <div className="panel newgame">
          <h2>Une nouvelle carrière dans la Grande Armée</h2>
          <p>Nommez votre Grognard, sergent ou sous-lieutenant en 1792 :</p>
          <div className="nameline">
            <input
              value={name}
              placeholder="laissez vide pour tirer le nom aux dés"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && start('guided')}
            />
            <button
              onClick={() => {
                const n = generateName();
                setName(n.full);
                setRolledName(n.steps);
              }}
            >
              🎲 Tirer un nom
            </button>
          </div>
          {rolledName && (
            <ul className="nameroll">
              {rolledName.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
          <div className="bots-pick">
            <span>Concurrents menés par la machine :</span>
            {[0, 1, 2, 3, 5].map((n) => (
              <button
                key={n}
                className={n === bots ? 'chip on' : 'chip'}
                onClick={() => setBots(n)}
              >
                {n === 0 ? 'aucun' : n}
              </button>
            ))}
          </div>
          {Game.hasSave() && (
            <div style={{ marginTop: 16 }}>
              <button className="primary big" onClick={resume}>
                ▶ Reprendre la carrière en cours
              </button>
            </div>
          )}
          <div className="modes">
            <button className="mode-card" onClick={() => start('quick')}>
              <h3>Mise en place rapide</h3>
              <p>
                Tous les jets de création sont effectués d’un coup. Vous entrez directement en
                campagne, la feuille de Grognard déjà remplie.
              </p>
            </button>
            <button className="mode-card" onClick={() => start('guided')}>
              <h3>Mise en place normale</h3>
              <p>
                Vous lancez les dés caractéristique par caractéristique — affectation, grade, notice,
                gloire, expérience, argent, santé, charme, escrime — comme au Setup du livret.
              </p>
            </button>
          </div>
        </div>
      </>
    );
  }

  const prog = game.progress();
  const replaying = revealed < game.log.length;
  const lastRevealed = revealed > 0 ? game.log[revealed - 1] : null;
  const activeRoll = lastRevealed?.cls === 'roll' ? lastRevealed : null;
  const pendingRoll = lastRevealed?.cls === 'ask' ? lastRevealed : null;
  // un concurrent lance aussi ses dés sur le plateau : il faut dire lesquels
  const roller = activeRoll ?? pendingRoll;
  const rollerName = roller && roller.actor ? game.chars[roller.actor]?.name ?? null : null;
  // la feuille ne montre que ce que le joueur a déjà découvert
  // la feuille de gauche reste celle du joueur, quel que soit le Grognard actif
  const ch = replaying ? game.snapshotAt(revealed) : game.me;

  /** Révèle le journal jusqu'à la prochaine annonce ou au prochain jet, inclus. */
  const revealNext = () => {
    const log = game.log;
    let i = revealed;
    while (i < log.length) {
      const cls = log[i].cls;
      i++;
      if (cls === 'roll' || cls === 'ask') break;
    }
    setRevealed(i);
  };

  const doAdvance = () => { game.advance(); refresh(); };
  const doChoose = (i: number) => { game.choose(i); refresh(); };

  const tone =
    prog.blockKind === 'in-garrison' ? 'garrison'
      : prog.blockKind === 'on-campaign' ? 'campaign'
        : 'neutral';

  const drawing = !replaying && !game.over && !game.pending && prog.blockKind !== 'setup'
    && prog.steps.some((s) => s.id === 'cards' && s.state === 'current');
  // au joueur de retourner sa carte ; pour un concurrent, on avance normalement
  const nextDrawer = game.nextDrawer();
  const myDraw = drawing && nextDrawer === 0;
  const combatDraw = !replaying && game.pending?.kind === 'draw-combat' && game.active === 0;

  return (
    <div className={`tone-${tone}`}>
      <Header season={game.seasonDef()} game={game} onOpen={setModal} />
      <ProgressBar prog={prog} />
      {game.chars.length > 1 && (
        <Rivals
          game={game}
          all={replaying ? game.snapshotAll(revealed) : game.chars}
          onOpen={setSheetOf}
        />
      )}
      <div className="layout">
        <aside className="panel sheet">
          <div className="sheet-name">{ch.name}</div>
          {prog.blockKind === 'setup' ? (
            <SetupSheet
              game={game}
              revealedRolls={game.log.slice(0, revealed).filter((e) => e.cls === 'roll').length}
            />
          ) : (
            <GrognardSheet game={game} ch={ch} />
          )}
        </aside>

        <aside className="panel chronicle-panel">
          <h3 className="panel-title">Chronique</h3>
          <LogView
            log={game.log}
            revealed={revealed}
            onPeek={setPeek}
            names={game.chars.map((c) => (c.bot ? c.name.split(' ').pop()! : 'Vous'))}
          />
        </aside>

        <main className="stage">
          <div className="stage-card">
            {myDraw ? (
              <CardBack
                deck={prog.blockKind === 'on-campaign' ? 'campaign' : 'garrison'}
                title={`Carte ${prog.cardNum + 1} sur ${prog.cardTotal}`}
                label="Piocher"
                onDraw={doAdvance}
              />
            ) : combatDraw ? (
              <>
                {game.currentCard && <CardView entry={game.currentCard} category={game.category()} />}
                <div className="combat-slot">
                  <CardBack deck="combat" title="" label="Tirer une carte Combat" onDraw={() => doChoose(0)} />
                </div>
              </>
            ) : game.currentCard ? (
              <CardView entry={game.currentCard} category={game.category()} />
            ) : (
              <div className="placeholder">Aucune carte en jeu</div>
            )}
            {/* toutes les cartes Combat de l'évènement restent sur la table,
                chacune sous le nom de celui qui l'a tirée */}
            {game.battleCards.map((b, k) => (
              <div className="combat-slot" key={k}>
                <CardView entry={b.card} category={game.category()} />
                {game.chars.length > 1 && (
                  <div className="combat-porteur">
                    {b.who === 0 ? 'Vous' : game.chars[b.who].name}
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="stage-action">
            <DiceTray
              entry={activeRoll}
              announce={pendingRoll}
              seq={revealed}
              who={rollerName}
            />

            {replaying ? (
              <div className="controls">
                <button className="primary big" onClick={revealNext} autoFocus>
                  {pendingRoll ? '🎲 Lancer les dés' : activeRoll ? 'Prendre acte ▸' : 'Continuer ▸'}
                </button>
                <button onClick={() => setRevealed(game.log.length)}>⏩ Tout révéler</button>
              </div>
            ) : game.over ? (
              <div className="gameover">
                <h3>Carrière achevée</h3>
                <ScoreView game={game} />
                <button
                  className="primary"
                  onClick={() => { gameRef.current = null; setRevealed(0); refresh(); }}
                >
                  Nouvelle carrière
                </button>
              </div>
            ) : game.pending?.kind === 'money' ? (
              <MoneyPanel game={game} onDone={refresh} />
            ) : game.pending ? (
              <div className="pending">
                <h3>{game.pending.title}</h3>
                <div className="options">
                  {game.pending.options.map((o, i) => (
                    <button key={i} onClick={() => doChoose(i)}>{o.label}</button>
                  ))}
                </div>
              </div>
            ) : myDraw || combatDraw ? (
              <div className="draw-note">
                {combatDraw ? 'Retournez la carte Combat.' : 'À vous de retourner une carte.'}
              </div>
            ) : (
              <div className="controls">
                <button className="primary big" onClick={doAdvance} autoFocus>
                  {drawing && game.chars.length > 1
                    ? `▶ Au tour de ${game.chars[nextDrawer]?.name ?? '…'}`
                    : '▶ Étape suivante'}
                </button>
              </div>
            )}
          </div>
        </main>
      </div>

      {sheetOf !== null && (
        <RivalSheet
          idx={sheetOf}
          ch={(replaying ? game.snapshotAll(revealed) : game.chars)[sheetOf]}
          onClose={() => setSheetOf(null)}
        />
      )}
      {peek && <CardPeek src={peek} onClose={() => setPeek(null)} />}
      {modal && <Reference which={modal} game={game} onClose={() => setModal(null)} />}
    </div>
  );
}
/* ---------------- Transfert d'argent ---------------- */

function MoneyPanel({ game, onDone }: { game: Game; onDone: () => void }) {
  const p = game.pending!;
  const paris = p.data?.paris ?? 0;
  const purse = p.data?.purse ?? 0;
  const [amount, setAmount] = useState(0); // >0 : vers Paris ; <0 : vers la bourse
  const newParis = paris + amount;
  const newPurse = purse - amount;
  const tax = Math.floor(newParis * 0.1);
  return (
    <div className="pending money">
      <h3>{p.title}</h3>
      <div className="money-cols">
        <div>
          <div className="money-label">Paris</div>
          <div className="money-val">{newParis} F</div>
          <div className="money-tax">− {tax} F d’impôt</div>
        </div>
        <div>
          <div className="money-label">Bourse</div>
          <div className="money-val">{newPurse} F</div>
          <div className="money-tax">exposée au pillage</div>
        </div>
      </div>
      <input
        type="range"
        min={-paris}
        max={purse}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
      />
      <div className="money-legend">
        <span>← retirer de Paris</span>
        <span>{amount === 0 ? 'aucun transfert' : amount > 0 ? `${amount} F vers Paris` : `${-amount} F vers la bourse`}</span>
        <span>déposer à Paris →</span>
      </div>
      <div className="options">
        <button className="primary" onClick={() => { game.applyMoney(amount); onDone(); }}>
          Valider — il restera {newParis - tax} F à Paris et {newPurse} F en bourse
        </button>
        {p.options.slice(1).map((o, i) => (
          <button key={i} onClick={() => { game.choose(i + 1); onDone(); }}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

