/** Le journal de campagne : sections antéchronologiques, groupées par Grognard. */
import { useEffect, useRef } from 'react';
import { cardImage } from '../engine/data';
import type { LogEntry } from '../engine/types';

/** Regroupe le journal en sections : chaque titre, phase ou carte ouvre un bloc. */
interface Section {
  head: LogEntry;
  headIdx: number;
  body: { e: LogEntry; i: number }[];
}

/**
 * Le journal se lit comme un compte rendu : la saison et le round donnent le
 * cadre, la phase ouvre un bloc, et chaque Grognard y tient sa colonne. Rien
 * n'est plus encadré de tirets — la hiérarchie est portée par la mise en page.
 */
function sectionize(entries: LogEntry[]): Section[] {
  const out: Section[] = [];
  entries.forEach((e, i) => {
    // Une décision (« ▸ … ») n'ouvre pas de bloc : elle appartient à la carte
    // qui l'a provoquée. Sans quoi, les sections étant antéchronologiques, le
    // choix et ses effets flottaient *au-dessus* de leur propre carte.
    const opens = e.cls === 'title' || e.cls === 'phase' || (e.cls === 'card' && !!e.cardId);
    if (opens || out.length === 0) out.push({ head: e, headIdx: i, body: [] });
    else out[out.length - 1].body.push({ e, i });
  });
  return out;
}

/** Saison et round méritent un traitement à part : ils marquent le temps. */
function titleKind(t: string): 'season' | 'round' | 'event' {
  if (/^Saison /.test(t)) return 'season';
  if (/^Round |^Fin du round|^Fin de la saison/.test(t)) return 'round';
  return 'event';
}

function LogLine({
  e, fresh, who, moi,
}: { e: LogEntry; fresh: boolean; who?: string | null; moi?: boolean }) {
  // une décision garde son allure, même logée dans le corps de sa carte
  const kind = e.cls === 'card' ? 'choice' : e.cls;
  const cls = `line line-${kind}${who ? ' line-solo' : ''}${fresh ? ' fresh' : ''}`;
  const badge = who ? <span className={`who${moi ? ' who-me' : ''}`}>{who}</span> : null;
  // un calcul se replie derrière son résultat : on le déroule si on le veut
  if (e.detail) {
    return (
      <details className={`${cls} line-fold`}>
        <summary className="line-text">{badge}{e.t}</summary>
        <span className="line-detail">{e.detail}</span>
      </details>
    );
  }
  return (
    <div className={cls}>
      {badge}
      <span className="line-text">{e.t}</span>
    </div>
  );
}

/**
 * Tant qu'un même Grognard parle, ses lignes restent ensemble : le nom n'est
 * porté qu'une fois, en tête du groupe, et seulement s'il y a matière à confusion.
 */
function runsByActor(body: { e: LogEntry; i: number }[]) {
  const runs: { actor: number | undefined; lines: { e: LogEntry; i: number }[] }[] = [];
  for (const item of body) {
    const last = runs[runs.length - 1];
    if (last && last.actor === item.e.actor) last.lines.push(item);
    else runs.push({ actor: item.e.actor, lines: [item] });
  }
  return runs;
}

export function LogView({
  log, revealed, onPeek, names,
}: {
  log: LogEntry[];
  revealed: number;
  onPeek: (src: string | null) => void;
  names: string[];
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = 0;
  }, [revealed]);
  const sections = sectionize(log.slice(0, revealed)).reverse();

  return (
    <div className="chronicle" ref={boxRef}>
      {sections.map((sec) => {
        const h = sec.head;
        const fresh = sec.headIdx === revealed - 1;
        const thumb = h.cls === 'card' && h.cardId ? cardImage(h.cardId) : null;
        // une décision emprunte le canal des cartes mais n'en est pas une
        const kind = h.cls === 'title' ? titleKind(h.t)
          : h.cls === 'card' && !h.cardId ? 'choice'
            : h.cls;
        const who = names.length > 1 && h.actor !== undefined ? names[h.actor] : null;
        const runs = runsByActor(sec.body);

        return (
          <section key={sec.headIdx} className={`blk blk-${kind}`}>
            {kind === 'season' || kind === 'round' ? (
              <h4 className={`stamp stamp-${kind}${fresh ? ' fresh' : ''}`}>
                {h.t}
                {h.detail && <em className="stamp-sub">{h.detail}</em>}
              </h4>
            ) : kind === 'phase' ? (
              <div className={`phase-head${fresh ? ' fresh' : ''}`}>
                {h.t}
                {h.detail && <span className="phase-sub">{h.detail}</span>}
              </div>
            ) : kind === 'choice' ? (
              <div className={`decision${fresh ? ' fresh' : ''}`}>
                {who && <span className={`who${h.actor === 0 ? ' who-me' : ''}`}>{who}</span>}
                {h.t}
              </div>
            ) : kind === 'card' ? (
              <div className={`card-head-log${fresh ? ' fresh' : ''}`}>
                {thumb && (
                  <img
                    className="thumb"
                    src={thumb}
                    alt=""
                    onMouseEnter={() => onPeek(thumb)}
                    onMouseLeave={() => onPeek(null)}
                  />
                )}
                <span className="card-head-txt">
                  {who && <span className={`who${h.actor === 0 ? ' who-me' : ''}`}>{who}</span>}
                  {h.t}
                </span>
              </div>
            ) : (
              <div className={`milestone${fresh ? ' fresh' : ''}`}>
                {who && <span className={`who${h.actor === 0 ? ' who-me' : ''}`}>{who}</span>}
                {h.t}
                {h.detail && <span className="line-detail">{h.detail}</span>}
              </div>
            )}

            {sec.body.length > 0 && (
              <div className="blk-body">
                {runs.map((run, k) => {
                  // un seul intervenant, déjà nommé par l'en-tête : pas de pastille
                  const label =
                    names.length > 1 && run.actor !== undefined && names[run.actor]
                      && (runs.length > 1 || run.actor !== h.actor)
                      ? names[run.actor]
                      : null;
                  // Un Grognard, une ligne : nom et fait sur le même rang, sans
                  // filet ni retrait. C'est le cas de toutes les phases où
                  // chacun ne dit qu'une chose — permission, revenus, gloire.
                  if (run.lines.length === 1) {
                    const { e, i } = run.lines[0];
                    return (
                      <LogLine
                        key={k}
                        e={e}
                        fresh={i === revealed - 1}
                        who={label}
                        moi={run.actor === 0}
                      />
                    );
                  }
                  return (
                    <div key={k} className={`run${label ? ' run-named' : ''}`}>
                      {label && (
                        <span className={`who${run.actor === 0 ? ' who-me' : ''}`}>{label}</span>
                      )}
                      <div className="run-lines">
                        {run.lines.map(({ e, i }) => (
                          <LogLine key={i} e={e} fresh={i === revealed - 1} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
