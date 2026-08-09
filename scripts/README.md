# Outils

Trois familles, à ne pas confondre.

## Contrôle — à lancer avant de committer

| Script | Commande | Rôle |
|---|---|---|
| `regress.ts` | `npm run regress` | Rejoue six parties à graine fixe et compare la **trace mécanique** (jets, variations, promotions, blessures, croix) à `tests/baseline.json`. Une refonte qui ne change pas les règles la laisse intacte. `-- --update` regénère la référence après un changement voulu. |
| `lint-cards.ts` | `npm run lint:cards` | Vérifie que les données de cartes ne contiennent aucun champ inconnu ni identifiant en double. |
| — | `npm run check` | Les deux, plus la compilation. |

## Mesure — pour répondre à une question sur l'équilibre

| Script | Commande | Rôle |
|---|---|---|
| `smoke.ts` | `npm run smoke 5` | Joue N carrières au hasard et vérifie qu'elles vont au bout. |
| `stats.ts` | `tsx scripts/stats.ts 200` | Distribution des grades, gloire, fortune, morts, selon deux façons de jouer. |
| `bots.ts` | `tsx scripts/bots.ts 3` | Une partie avec N concurrents, et son décompte de points de victoire. |
| `botprofile.ts` | `tsx scripts/botprofile.ts 40` | Comportement des concurrents : grades atteints, permissions, offices. |
| `best.ts` | `tsx scripts/best.ts 300` | Retrouve la meilleure carrière d'un lot et déroule son parcours. |
| `subst.ts` | `tsx scripts/subst.ts` | Cas limites des substitutions notice / gloire / expérience. |
| `wwt.ts` | `tsx scripts/wwt.ts` | Fréquence des déclenchements de « We Were There! ». |

## Fabrication — déjà passés, conservés pour mémoire

| Script | Rôle |
|---|---|
| `grid.mjs` | Détecte la grille d'une planche de cartes scannée. |
| `slice.mjs` | Découpe les planches en cartes individuelles. |
| `map-images.mjs` | Associe chaque carte à sa découpe et déduit sa numérotation. |

Ces trois-là ne resserviront que si les planches sources changent. Elles ne sont
pas versionnées (110 Mo) et doivent être remises dans `public/cards/`.
