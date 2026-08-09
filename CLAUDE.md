# Notes de travail

Adaptation web de *Legion of Honor* (Clash of Arms, 2014) : un Grognard mené par
le joueur, seul ou face à cinq concurrents menés par la machine. React + TS +
Vite, 100 % client, sauvegarde `localStorage`. Voir `README.md` pour les données.

## Conventions

- **Tout est en français** : commentaires, texte du journal, interface.
- **Le moteur ne connaît pas le navigateur.** `src/engine/` n'importe ni React ni
  `window` : il tourne sous Node, et c'est ce qui permet de simuler des centaines
  de carrières en quelques secondes. Ne pas l'y attacher.
- Le tirage passe toujours par la fonction `rng` du moteur, jamais par
  `Math.random` direct : les parties doivent rester reproductibles à graine fixe.

## Contrôles

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

- **Ne jamais redéduire l'ordre de pioche dans l'interface.** La pioche part à
  gauche du senior, et le senior est celui *figé* pour le round, pas le mieux
  classé de l'instant. Demander à `Game.nextDrawer()`. L'interface se trompait
  16 % du temps et offrait un bouton là où le joueur attendait un dos de carte.
- **Pas de `Math.max` sur des indices d'options** dans `policy.ts` : ça retourne
  la dernière option proposée, pas celle qu'on veut. Ce bug faisait partir les
  concurrents en permission en pleine santé.
- **Un absent n'annule pas l'évènement qu'il tire.** Il n'y prend pas part, mais
  la carte court pour les autres — `We Were There` en garnison, distribution aux
  commandements engagés en campagne. L'oublier effaçait ~1,4 bataille par partie.
- Les cartes 20, 75, 38 et 39 s'appliquent même à un absent ; la 40 est traitée
  avant le test d'absence.
- **Une question posée au joueur pendant qu'un concurrent a la main, c'est la
  machine qui y répond.** `resolveBotPending()` ne regarde que `this.ch` : si un
  concurrent tire une carte qui entraîne le joueur en duel, il faut lui passer
  `active` *et l'y laisser* jusqu'à sa réponse. Passer par `handOver()`, jamais
  par une affectation qu'on rendrait aussitôt — un `try/finally` autour d'un
  `ask()` rend la main avant que le joueur ait cliqué.
- **Les gains d'un concurrent attendent en mémoire** (`briefBuf`) d'être rendus
  en une ligne, et la ligne prend le nom du Grognard actif *au moment du
  vidage*. Écrire dans la feuille d'un rival sans vider d'abord attribue ses
  pertes à celui qui les inflige. `asActor()` et `handOver()` s'en chargent.

## Ce que les mesures ont établi

Ces faits ne se lisent pas dans le code et ont coûté cher à obtenir.

- **La permission n'est pas un repos, c'est un levier de mobilité.** Au service,
  le transfert n'est proposé que sur une carte Idle Time — 11 occasions par
  carrière. En permission, chaque carte devient une occupation choisie — 57.
- L'effet **sature vers 13 permissions par carrière** ; au-delà, le grade et la
  fortune reculent (demi-solde) sans rien gagner.
- Pour le joueur, le score de carrière ne dit rien de la permission ; **les points
  de victoire, si**.

### Pourquoi la règle de permission des concurrents est celle-là

Ils partent si la santé passe sous le seuil du tempérament **ou** si l'armée n'est
pas engagée cette saison. Mesuré à 1 200 parties, joueur toujours au service :

| règle des concurrents | permissions/carrière | vous l'emportez |
|---|---|---|
| seuil de santé seul | 1,0 | 33,0 % |
| **+ si l'armée est au repos** | 12,7 | **29,9 %** |
| toujours | 23,2 | 29,8 % |

C'est un réglage de difficulté assumé : la règle coûte 3 points au joueur. La
troisième ligne montre qu'aller plus loin ne rapporte plus rien.

**Variante écartée, ne pas la réintroduire** : « attendre le premier round de
garnison pour voir si un transfert se présente, ne partir qu'au second ». Deux
raisons — plus de la moitié des saisons n'ont qu'un seul round de garnison, donc
la clause ne se déclencherait jamais ; et surtout partir **augmente** les
occasions de transfert (1,7 par round contre 0,59), donc attendre retarde l'accès
au levier qu'on cherchait.

**Piste non essayée** : n'accorder ce calcul qu'au courtisan, au prudent et à
l'affairiste, en laissant le sabreur au quartier — il ne croit qu'au feu. Environ
trois quarts de l'effet, et un tempérament plus lisible.

**Piège des simulations** : `traitsOf` rabat un Grognard sans `persona` sur
*sabreur*. Un banc d'essai qui fait piloter le joueur par `botChoice` lui donne
donc ce tempérament-là, et ses résultats ne se transposent pas aux concurrents,
qui en ont un vrai. Deux mesures de cette sorte se sont contredites pour cette
seule raison.

## Les cartes qui visent un rival

Sept cartes exigent un autre Grognard : courir contre lui, le calomnier,
l'accuser de lâcheté, boire avec lui, l'envoyer en mission, partager un butin,
croiser le fer. Elles ne sont écartées **qu'en solo** — `cardAllowed()` interroge
`multi`, et non plus `soloPlayable` seul. Deux d'entre elles étaient déjà dans le
deck sans effet faute de cible (*Sack the Town*, *Dangerous Mission*).

Pour toucher la feuille d'un rival, passer par `asActor()` : `applyStat()` et
tout ce qui en découle travaillent sur le Grognard actif, jamais sur un index.

`flags.grievanceAgainst` est la seule porte vers un défi : sans partie lésée,
pas de duel — c'est la règle de la planche, pas une prudence de notre part.

## Le duel

`src/engine/duel.ts` applique `data/cards/duel.json` et ne connaît rien d'autre :
il dit qui touche et avec quelle intention, jamais ce qu'il en coûte. C'est
`game.ts` qui lance la table des blessures, et `policy.ts` qui choisit les cartes.

Trois choses à savoir avant d'y toucher :

- **Un duel n'est pas une pioche : c'est une suite de questions.** Le moteur
  annonce de qui il attend une carte ; `stepDuel()` joue pour la machine et
  s'arrête dès qu'un humain doit trancher. Un duel entre deux concurrents se
  déroule donc d'un trait, sans passer par l'interface.
- **La riposte inverse les rôles séance tenante** (`safe-and-counts-as-lunge`) :
  c'est pourquoi la table d'interaction a une entrée `vs-riposte`. Deux mains
  épuisées sans blessure ne closent rien — on redistribue, jusqu'à six fois.
- **Pointer « pour blesser » ajoute 10 au jet de blessure**, donc adoucit :
  1 % de morts contre 11 %. Les concurrents pointent pour blesser, sauf le
  sabreur. C'est ce qui fait que réintroduire les duels n'a pas augmenté la
  mortalité des parties témoins.

Non traités, faute de règles fournies ou d'occasion : la magnanimité n'est
offerte qu'au joueur (un concurrent frappe toujours), le fanatisme — rejouer un
duel après avoir été gracié — n'est pas implémenté, et le cocuage attend
*The Fair Sex*.

## Chantiers ouverts

- *Comrades in Arms* reste à faire : c'est le dernier bloc multijoueur.
- **Le défi d'Idle Time n'est presque jamais proposé** — 0,13 fois par partie à
  six Grognards. Deux causes : les restrictions de la planche (même commandement
  *et* même grade) et le fait qu'un concurrent n'atteint jamais la branche
  aléatoire d'Idle Time, `Demander un transfert` passant toujours avant quand
  l'armée est au repos. Le levier est câblé mais dort.
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
dans `TRAITS`, et maintenant leur conduite sur le pré — `duelChoice` pare puis
riposte sans jamais compter ses cartes, et `acceptsDuel` ne pèse pas les cinq
points de gloire d'un refus contre le risque encouru.
