# Lecture des cartes et pièges de résolution

`public/cards/slices/` contient les 186 découpes, et `data/cards/images.json`
donne l'identifiant de chacune. **Une carte marquée `verify` se tranche en la
lisant**, pas en raisonnant sur sa transcription. Elles ne sont pas versionnées
(110 Mo) mais elles sont présentes en session.

La leçon a coûté quatre erreurs sur la seule carte 52, toutes venues de sa
transcription : la carte d'avantage revient au **tireur** et non au Burger, le
choix de l'arme appartient au **Grognard qui tient le rôle** et non au tireur,
le barème N/S était résumé en « selon la blessure » quand la carte le donne en
clair, et le Burger n'est pas un personnage de carte — **c'est un duel
ordinaire entre deux Grognards**, avec les résultats communs des deux côtés et
les avantages habituels. Le E+1 et le G+3 que la carte rappelle sont ceux de la
planche : ils ne s'y ajoutent pas. Il reste 31 cartes portant `verify`.

## Une carte peut être muette sans que rien ne le signale

Deux façons de ne rien faire, toutes deux silencieuses :

- **Un champ que personne ne lit.** `choice` n'était traité que par les trois
  cartes qui avaient leur propre `case` ; *You Are a Passing Fancy* (74), qui
  n'a que lui, traversait la table sans rien produire — ni question, ni gain.
  Il existe désormais un traitement générique, et `emperor-fancies-your-lady`
  en profitera quand *The Fair Sex* arrivera.
- **Un résultat de jet écrit en prose.** `resolveRollField` applique un objet,
  mais une chaîne n'est qu'affichée : seuls `mort` et `emprisonné` y étaient
  reconnus. Le « sinon N−2 » de la carte 74 se perdait ainsi.

Pour les débusquer : instrumenter `resolveEntry`, marquer la longueur de
`trace` à l'ouverture d'une carte et la relever à la carte suivante. Une carte
souvent tirée qui ne fait jamais bouger la trace est muette. Deux réserves —
les gains d'une bataille sont portés par sa carte Combat, non par l'évènement
qui l'ouvre (Eckmühl affiche zéro et fonctionne), et une carte résolue *à
l'intérieur* de `drawCombat` voit ses gains attribués à la précédente.
