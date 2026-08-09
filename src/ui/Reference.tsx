import { Game } from '../engine/game';
import { RANKS, SEASONS, CAMPAIGN_EVENTS, cardImage, commandName } from '../engine/data';

export type RefKind = 'chronicles' | 'ranks' | 'opportunity' | 'cards';

const TITLES: Record<RefKind, string> = {
  chronicles: 'Chroniques du Grognard',
  ranks: 'Grades, seuils et soldes',
  opportunity: 'Fiche d’opportunité — qui se bat, et quand',
  cards: 'Cartes tirées dans ce round',
};

export function Reference({
  which, game, onClose,
}: { which: RefKind; game: Game; onClose: () => void }) {
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{TITLES[which]}</h3>
          <button className="link-btn" onClick={onClose}>✕ fermer</button>
        </div>
        <div className="modal-body">
          {which === 'chronicles' && <Chronicles game={game} />}
          {which === 'ranks' && <RanksTable game={game} />}
          {which === 'opportunity' && <Opportunity game={game} />}
          {which === 'cards' && <RoundCards game={game} />}
        </div>
      </div>
    </div>
  );
}

function Chronicles({ game }: { game: Game }) {
  if (!game.chronicles.length) {
    return <p className="muted">La première saison n’est pas encore achevée.</p>;
  }
  return (
    <>
      {[...game.chronicles].reverse().map((c) => (
        <article className="chron" key={c.season}>
          <h4>
            Saison {c.roman} — {c.name} <span className="years">{c.years}</span>
          </h4>
          <p>{c.text}</p>
        </article>
      ))}
    </>
  );
}

function RanksTable({ game }: { game: Game }) {
  const cur = game.ch.rankIdx;
  const cat = (c: string) =>
    c === 'line' ? 'officier de ligne' : c === 'field' ? 'officier supérieur' : 'officier général';
  return (
    <table className="ref-table">
      <thead>
        <tr>
          <th>Grade</th><th>Catégorie</th><th>Notice</th><th>Gloire</th><th>Expér.</th><th>Solde</th>
        </tr>
      </thead>
      <tbody>
        {RANKS.map((r: any, i: number) => (
          <tr key={r.id} className={i === cur && !game.ch.marechal ? 'here' : ''}>
            <td>{r.name}</td>
            <td className="muted">{cat(r.category)}</td>
            <td>{r.promotion ? r.promotion.N || '—' : '—'}</td>
            <td>{r.promotion ? r.promotion.G : '—'}</td>
            <td>{r.promotion ? r.promotion.E : '—'}</td>
            <td>{r.income} F</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={6} className="muted">
            La notice n’est exigée qu’à partir de la saison VI. Le surplus de notice peut tenir lieu
            de gloire, un pour un ; deux points de gloire en trop valent un point d’expérience.
            Le bâton de maréchal ne s’obtient que par une carte Combat marquée « Title? », après la
            Création du Maréchalat.
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

function Opportunity({ game }: { game: Game }) {
  return (
    <>
      <p className="muted">
        Quels commandements sont engagés à chaque bataille. Le vôtre est en surbrillance : c’est lui
        qui décide si vous verrez le feu. Choisir son armée, c’est choisir ses occasions de gloire.
      </p>
      {SEASONS.map((s: any) => {
        const rows = (Object.entries(s.events) as [string, string[]][])
          .flatMap(([round, ids]) =>
            ids
              .map((id) => {
                const ev: any = CAMPAIGN_EVENTS.find((e: any) => e.id === id);
                if (!ev) return null;
                const cmds: string[] =
                  ev.commands ?? (ev.subEvents ?? []).flatMap((x: any) => x.commands ?? []);
                if (!cmds.length) return null;
                return { round, name: ev.name, cmds: [...new Set(cmds)] };
              })
              .filter(Boolean) as { round: string; name: string; cmds: string[] }[],
          );
        if (!rows.length) return null;
        return (
          <div key={s.num} className={`opp-season${s.num === game.season ? ' now' : ''}`}>
            <h4>
              Saison {s.roman} — {s.name} <span className="years">{s.years}</span>
            </h4>
            <table className="ref-table">
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="opp-round">{r.round}</td>
                    <td>{r.name}</td>
                    <td>
                      {r.cmds.map((c) => (
                        <span key={c} className={`cmd-chip${c === game.ch.assignment ? ' mine' : ''}`}>
                          {c === 'all' || c === 'all-not-spain' ? 'tous' : commandName(c)}
                        </span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

function RoundCards({ game }: { game: Game }) {
  const seen = game.roundCards();
  if (!seen.length) return <p className="muted">Aucune carte tirée dans ce round pour l’instant.</p>;
  return (
    <div className="card-grid">
      {seen.map((c, i) => {
        const img = cardImage(c.id);
        return (
          <figure key={i}>
            {img ? <img src={img} alt={c.name} /> : <div className="nocard">{c.name}</div>}
            <figcaption>{c.name}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}
