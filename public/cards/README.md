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
| `duel.jpg`               | Dueling Cards 1-18                                    |

Les planches sont des grilles régulières : l'affichage découpe la bonne case
par sprite CSS (`background-position`), sans avoir à créer 200 fichiers.

Si des scans individuels existent, les nommer par numéro de carte
(`041.jpg`, `052.jpg`, …) : ils seront utilisés en priorité.

Usage strictement personnel — images © 2014 Clash of Arms Games, ne pas publier.
