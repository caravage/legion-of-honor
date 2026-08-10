# Images des cartes

Déposer ici les planches de cartes (ou les scans individuels).

Vite sert ce dossier à la racine : `public/cards/in-garrison.jpg` → `/cards/in-garrison.jpg`.

## Noms attendus pour les planches

| Fichier                  | Contenu                                              |
|--------------------------|------------------------------------------------------|
| `in-garrison.jpg`        | Idle Time, cartes de garnison, End of Round?          |
| `in-garrison-events.jpg` | In Garrison Event Cards + cartes de garnison courantes |
| `on-campaign.jpg`        | On Campaign Cards + End of Round?                     |
| `on-campaign-events.jpg` | On Campaign Event Cards (batailles)                   |
| `combat.jpg`             | Combat Cards 180-200                                  |
| `duel.jpg`               | Dueling Cards 1-18 (7 Botte, 2 Riposte, 7 Parade, 2 Feu) |

La planche des duels est la seule dont le `.png` échappe au `.gitignore`
(`duel.png` ou `duels.png`) : elle est légère et le mini-jeu de duel en dépend.
Une fois déposée, `node scripts/slice.mjs` produit `duel-00.jpg` … `duel-18.jpg`.
Les cartes sont à double sens — Botte, Riposte et Feu portent « to Kill » à une
extrémité et « to Wound » à l'autre — donc la découpe doit garder la carte
entière, sans recadrer sur une moitié.

Les planches sont des grilles régulières : l'affichage découpe la bonne case
par sprite CSS (`background-position`), sans avoir à créer 200 fichiers.

Si des scans individuels existent, les nommer par numéro de carte
(`041.jpg`, `052.jpg`, …) : ils seront utilisés en priorité.

Usage strictement personnel — images © 2014 Clash of Arms Games, ne pas publier.
