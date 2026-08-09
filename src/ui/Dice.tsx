/** Le plateau de dés : un d10 qui roule, puis se fige sur sa face. */
import { useEffect, useState } from 'react';
import type { LogEntry } from '../engine/types';

const REDUCED_MOTION =
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Silhouette d'un d10 : pentagone extérieur, face en cerf-volant au centre. */
function D10Shape({ rolling }: { rolling: boolean }) {
  return (
    <svg className={`d10${rolling ? ' tumbling' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
      <polygon className="body" points="50,3 97,38 78,93 22,93 3,38" />
      <polygon className="facet" points="50,3 72,52 50,68 28,52" />
      <g className="edges">
        <path d="M28,52 L3,38 M72,52 L97,38 M28,52 L22,93 M72,52 L78,93 M50,68 L50,93" />
      </g>
    </svg>
  );
}

/**
 * Un dé qui roule avant de se figer : les faces défilent ~700 ms,
 * puis la valeur finale tombe avec un rebond.
 */
function Die({
  face, tag, delay = 0, seq, onSettled,
}: {
  face: number | string;
  tag?: string;
  delay?: number;
  seq: number;
  onSettled?: () => void;
}) {
  const numeric = typeof face === 'number';
  const [rolling, setRolling] = useState(numeric && !REDUCED_MOTION);
  const [shown, setShown] = useState<number | string>(numeric && !REDUCED_MOTION ? 0 : face);

  useEffect(() => {
    if (!numeric || REDUCED_MOTION) {
      setRolling(false);
      setShown(face);
      onSettled?.();
      return;
    }
    setRolling(true);
    let tumble: ReturnType<typeof setInterval> | undefined;
    const startAt = setTimeout(() => {
      tumble = setInterval(() => setShown(Math.floor(Math.random() * 10)), 65);
    }, delay);
    const stopAt = setTimeout(() => {
      if (tumble) clearInterval(tumble);
      setShown(face);
      setRolling(false);
      onSettled?.();
    }, delay + 700);
    return () => {
      clearTimeout(startAt);
      clearTimeout(stopAt);
      if (tumble) clearInterval(tumble);
    };
    // un nouveau jet = une nouvelle animation
  }, [seq, face]);

  return (
    <div className={`die${rolling ? ' rolling' : ' settled'}`}>
      <D10Shape rolling={rolling} />
      <span className="die-value">{shown}</span>
      {tag && <span className="die-expr">{tag}</span>}
    </div>
  );
}

export function DiceTray({
  entry, announce, seq, who,
}: { entry: LogEntry | null; announce: LogEntry | null; seq: number; who?: string | null }) {
  const [settled, setSettled] = useState(0);
  useEffect(() => setSettled(0), [seq]);
  const bump = () => setSettled((n) => n + 1);
  const byline = who ? <div className="dice-who">{who}</div> : null;

  if (announce) {
    return (
      <div className="dice-tray waiting">
        <div className="dice-set">
          <div className="die waiting"><D10Shape rolling={false} /><span className="die-value">?</span></div>
        </div>
        <div className="dice-text in">{byline}{announce.t}</div>
      </div>
    );
  }
  if (!entry) {
    return (
      <div className="dice-tray idle">
        <span>Aucun jet en attente</span>
      </div>
    );
  }
  const m = entry.t.match(/([12])D10\s*=\s*(\d+)/);
  const d6 = entry.t.match(/1d6\+1d6\s*=\s*(\d)-(\d)/i);
  let dice: React.ReactNode;
  let needed = 1;
  let total: number | null = null;

  if (d6) {
    needed = 2;
    dice = (
      <>
        <Die face={Number(d6[1])} tag="d6" seq={seq} onSettled={bump} />
        <Die face={Number(d6[2])} tag="d6" delay={160} seq={seq} onSettled={bump} />
      </>
    );
  } else if (m && m[1] === '2') {
    // le pourcentage se lit sur deux dés : dizaines et unités
    const v = Number(m[2]);
    needed = 2;
    total = v;
    dice = (
      <>
        <Die face={Math.floor(v / 10) % 10} tag="×10" seq={seq} onSettled={bump} />
        <Die face={v % 10} tag="×1" delay={220} seq={seq} onSettled={bump} />
      </>
    );
  } else if (m) {
    dice = <Die face={Number(m[2])} seq={seq} onSettled={bump} />;
  } else {
    needed = 0;
    dice = <div className="die settled"><D10Shape rolling={false} /><span className="die-value">?</span></div>;
  }

  const done = settled >= needed;
  return (
    <div className="dice-tray active">
      <div className="dice-set">
        {dice}
        {total !== null && <span className={`dice-total${done ? ' in' : ''}`}>= {total}</span>}
      </div>
      <div className={`dice-text${done ? ' in' : ''}`}>{byline}{entry.t}</div>
    </div>
  );
}
