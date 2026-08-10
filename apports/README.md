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

Rien pour l'instant.

## Pourquoi ce dossier existe

Une planche déposée dans `public/cards/` en `.png` disparaissait sans un mot :
la ligne `public/cards/*.png` du `.gitignore`, écrite pour des sources de
110 Mo, l'écartait avant le commit. Ici, rien ne filtre.
