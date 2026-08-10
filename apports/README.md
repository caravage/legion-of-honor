# Apports

Déposez ici tout ce que vous voulez me transmettre : planches à découper,
scans de cartes, pages de règles, captures. **Rien dans ce dossier n'est
ignoré par git** — c'est sa raison d'être.

Aucune convention de nom n'est nécessaire : je regarde ce qui est arrivé et
je vous dis ce que j'en tire. Un mot dans le message d'origine aide (« la
planche des duels », « la carte 74 »), mais le fichier suffit.

Une fois traité, le contenu part à sa place définitive — `public/cards/` pour
une planche, `data/` pour une règle transcrite — et je vide le dossier dans
le même commit. Ce qui reste ici est donc ce qui attend encore.

## En attente

- **La planche des 18 cartes de duel** — 7 Botte, 2 Riposte, 7 Parade, 2 Feu,
  plus le dos. Elle est le dernier obstacle au mini-jeu de duel.

  Les cartes sont à double sens : Botte, Riposte et Feu portent « to Kill » à
  une extrémité et « to Wound » à l'autre. La découpe doit donc garder la
  carte **entière**, sans recadrer sur une moitié.

## Pourquoi ce dossier existe

Une planche déposée dans `public/cards/` en `.png` disparaissait sans un mot :
la ligne `public/cards/*.png` du `.gitignore`, écrite pour des sources de
110 Mo, l'écartait avant le commit. Ici, rien ne filtre.
