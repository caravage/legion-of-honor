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
    const opens = e.cls === 'title' || e.cls === 'phase' || e.cls === 'card';
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

function LogLine({ e, fresh }: { e: LogEntry; fresh: boolean }) {
  return (
    <div className={`line line-${e.cls}${fresh ? ' fresh' : ''}`}>
      <span className="line-text">{e.t}</span>
      {e.detail && <span className="line-detail">{e.detail}</span>}
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
