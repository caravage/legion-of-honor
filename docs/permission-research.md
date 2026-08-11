# Permission : ce que les mesures ont établi

Ces faits ne se lisent pas dans le code et ont coûté cher à obtenir.

- **La permission n'est pas un repos, c'est un levier de mobilité.** Au service,
  le transfert n'est proposé que sur une carte Idle Time — 11 occasions par
  carrière. En permission, chaque carte devient une occupation choisie — 57.
- L'effet **sature vers 13 permissions par carrière** ; au-delà, le grade et la
  fortune reculent (demi-solde) sans rien gagner.
- Pour le joueur, le score de carrière ne dit rien de la permission ; **les points
  de victoire, si**.

## Pourquoi la règle de permission des concurrents est celle-là

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
