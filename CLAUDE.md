# Notes de travail

Adaptation web de *Legion of Honor* (Clash of Arms, 2014) : un Grognard mené par
le joueur, seul ou face à cinq concurrents menés par la machine. React + TS +
Vite, 100 % client, sauvegarde `localStorage`. Voir `README.md` pour les données.

**Documentation étendue** (à lire seulement si la tâche touche le sujet) :
- `docs/duel.md` — mécanique du duel, lecture du livret, griefs/défis.
- `docs/permission-research.md` — mesures sur la règle de permission des concurrents.
- `docs/card-reading-lessons.md` — lecture des cartes `verify`, cartes muettes.

## Conventions

- **Tout est en français** : commentaires, texte du journal, interface.
- **Le moteur ne connaît pas le navigateur.** `src/engine/` n'importe ni React ni
  `window` : il tourne sous Node, et c'est ce qui permet de simuler des centaines
  de carrières en quelques secondes. Ne pas l'y attacher.
- Le tirage passe toujours par la fonction `rng` du moteur, jamais par
  `Math.random` direct : les parties doivent rester reproductibles à graine fixe.

## Contrôles

⚠️ **Avant de lancer l'une des commandes de test/simulation ci-dessous, demander validation d'abord** — elles consomment des ressources importantes (output volumineux, tokens, temps). Exception : `npm run dev`.

| Commande | Rôle |
|---|---|
| `npm run check` | compilation + régression + données |
| `npm run regress` | rejoue 10 parties à graine fixe |
| `npm run lint:cards` | champs inconnus, doublons, fourchettes trouées |
| `npm run smoke 5` | N carrières au hasard, vérifie qu'elles vont au bout |
| `npm run dev` | serveur de développement |

**Le filet de régression compare la mécanique, pas la prose** : nombre de tirages,
empreinte du flux de dés, chaque variation de caractéristique, état final. Reformuler
un message ne le fait pas broncher ; changer une règle, si. Après un changement
*voulu* : `npm run regress -- --update`.

Signature utile : un correctif qui ne touche que le multijoueur laisse passer les
trois parties solo et fait diverger les sept autres.

`tsx` est une dépendance de développement : sans lui, aucune de ces commandes ne
tourne sur un dépôt fraîchement cloné.

## Pièges déjà rencontrés

- **Ne jamais redéduire l'ordre de pioche dans l'interface.** Demander à
  `Game.nextDrawer()` — la pioche part à gauche du senior *figé* pour le round,
  pas du mieux classé de l'instant.
- **Pas de `Math.max` sur des indices d'options** dans `policy.ts` : ça retourne
  la dernière option proposée, pas celle qu'on veut.
- **Un absent n'annule pas l'évènement qu'il tire** — il n'y prend pas part, mais
  la carte court pour les autres (`We Were There` en garnison, distribution aux
  commandements engagés en campagne). Les cartes 20, 75, 38 et 39 s'appliquent
  même à un absent ; la 40 est traitée avant le test d'absence.
- **Une question posée au joueur pendant qu'un concurrent a la main, c'est la
  machine qui y répond.** `resolveBotPending()` ne regarde que `this.ch` : si un
  concurrent tire une carte qui entraîne le joueur en duel, passer `active` à ce
  concurrent *et l'y laisser* jusqu'à sa réponse, via `handOver()` — jamais par
  une affectation qu'on rendrait aussitôt (un `try/finally` autour d'un `ask()`
  rend la main avant que le joueur ait cliqué).
- **Les gains d'un concurrent attendent en mémoire** (`briefBuf`) d'être rendus
  en une ligne, qui prend le nom du Grognard actif *au moment du vidage*. Passer
  par `asActor()` et `handOver()`, sinon les pertes d'un rival s'attribuent à
  celui qui les inflige.

## Les cartes qui visent un rival

Sept cartes exigent un autre Grognard : courir contre lui, le calomnier,
l'accuser de lâcheté, boire avec lui, l'envoyer en mission, partager un butin,
croiser le fer. Elles ne sont écartées **qu'en solo** — `cardAllowed()` interroge
`multi`, et non plus `soloPlayable` seul.

S'y ajoutent deux actions d'Idle Time qui ne vivaient que dans les données :
`challenge` et le pari `againstGrognard` de `gambleRules`. La liste
`cardsTargetingOtherPlayers` de `misc-rules.json` sert de feuille de contrôle —
tout y est traité sauf les prêts.

Pour toucher la feuille d'un rival, passer par `asActor()` : `applyStat()` et
tout ce qui en découle travaillent sur le Grognard actif, jamais sur un index.

`flags.grievanceAgainst` est la seule porte vers un défi : sans partie lésée,
pas de duel. Détails et mesures dans `docs/duel.md`.

## Chantiers ouverts

- *Comrades in Arms* reste à faire : dernier bloc multijoueur.
- *The Terror* porte `commands: ["all"]` mais ne frappe que son piocheur.
- Le maréchalat n'est couvert par aucune partie témoin.
- 4 `any` subsistent dans `src/ui/Reference.tsx`.
- L'interface ne montre pas les cartes d'un duel autrement que par des boutons :
  ni main, ni carte adverse sur la table.
- Le README interdit encore de publier le contenu ; l'auteur a indiqué que cette
  restriction ne s'applique plus.

### Direction demandée

Que les concurrents jouent le mieux possible. Leviers non encore mesurés : leur
règle de transfert (ils ne demandent qu'au repos ou si standing ≤ −2), leur
arbitrage entre acte de gloire et acte de discrétion, les poids de tempérament
dans `TRAITS`, et leur conduite sur le pré — `duelChoice` pare puis riposte sans
jamais compter ses cartes, et `acceptsDuel` ne pèse pas les cinq points de
gloire d'un refus contre le risque encouru.
