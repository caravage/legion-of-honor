# Le duel

`src/engine/duel.ts` applique `data/cards/duel.json` et ne connaît rien d'autre :
il dit qui touche et avec quelle intention, jamais ce qu'il en coûte. C'est
`game.ts` qui lance la table des blessures, et `policy.ts` qui choisit les cartes.

**Le livret fait foi** : chapitre XVIII, pages 19 à 22 du PDF des règles. Il a
démenti quatre lectures que nous tenions pour acquises — les voici, pour ne pas
les refaire.

- **Il n'y a ni attaquant ni défenseur.** « Les Grognards jouent tour à tour
  leur carte *en réponse à celle que l'adversaire vient de poser* », et toute
  issue non sanglante se conclut par « l'adversaire joue une autre carte ».
  C'est une alternance stricte : chaque carte répond à la précédente et devient
  celle à laquelle l'autre devra répondre. Notre modèle attaque/réponse faisait
  jouer deux cartes de suite au même homme, et rendait le journal illisible.
- **Qui tient les cartes n'est pas qui saigne.** Dans un duel contre un
  personnage de carte, un autre Grognard tient le rôle et « is never affected in
  any way by the results of the duel » — blessure comprise. D'où `pilot` et
  `idx` séparés sur `Duelist` : l'un décide, l'autre encaisse.
- **Les résultats communs ne s'appliquent pas à ces duels-là.** Chaque carte le
  dit : « Do not apply any other modifications … (Exception: fencing F+1) ».
  Le Burger vaut E+1, G+3, F+1 et son barème N/S — **pas** le S−3 du duel
  ordinaire.
- **Les gains d'un duel entre Grognards se cumulent**, et le texte l'écrit deux
  fois (« an additional G+3 »). Tuer son homme vaut G+9, N−3, S−3, E+1, F+1.
- **Le défié arme la rencontre** : il choisit l'épée ou le pistolet *et*
  annonce qui pose la première carte.
- **Au pistolet les deux tirent.** Le second ne renonce que s'il est tué ou
  *gravement* blessé, ou si son amorce a raté — donc les deux peuvent tomber.
  Et c'est celui qui **tient** le Burger qui ne touche que sur 1-4.

Enfin, **pointer « pour blesser » ajoute 10 au jet de blessure**, donc adoucit :
1 % de morts contre 11 %. Les concurrents pointent pour blesser, sauf le
sabreur — c'est ce qui fait que les duels n'ont pas alourdi la mortalité.

Restent à faire : le **fanatisme** (le gracié peut exiger qu'on rejoue, une fois
par duel), la magnanimité pour les concurrents (ils frappent toujours), les
griefs **multiples** — `flags.grievanceAgainst` n'en retient qu'un et les
écrase — et leur extinction à la mort de l'offenseur.

## Comment un grief s'ouvre, et pourquoi si peu de défis

`flags.grievanceAgainst` est la seule porte vers un défi : sans partie lésée,
pas de duel — c'est la règle de la planche, pas une prudence de notre part.

Deux occasions l'ouvrent, et elles ne se valent pas :

| source du grief | griefs/partie | défis/partie |
|---|---|---|
| accusation de lâcheté | 6,6 | 0,06 |
| **disgrâce du commandement** | 0,41 | 0,44 |

Mesuré à 600 parties, six Grognards. La disgrâce convertit cent fois mieux
parce qu'elle lie d'office deux Grognards du **même commandement** — l'une des
deux restrictions du défi. L'accusation de lâcheté, elle, frappe n'importe qui :
le grief est ouvert, mais presque jamais exerçable.

Le levier reste sous un défi par partie, et c'est la planche qui le veut : il
faut un acte de discrétion déshonoré pour ouvrir un grief de commandement, et
les concurrents ne se mettent à couvert qu'en dessous de leur seuil de
tempérament. Les trois autres raisons que reconnaît `duel.json` — insulte,
termes de prêt violés, cocuage — n'ont aucun support : la première n'est portée
par aucune carte, la deuxième attend les prêts, la troisième *The Fair Sex*.

L'effet sur la course est nul : joueur vainqueur 5,2 % sans le levier, 6,0 %
avec, pour une erreur type de 0,9 point. Mortalité inchangée (0,46 → 0,45 par
carrière). C'est un gain de fidélité, pas un réglage de difficulté.
