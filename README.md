# Legion of Honor — Web App Solo

Adaptation web (usage personnel) du jeu **Legion of Honor** (Clash of Arms Games, 2014) en mode solo :
un seul Grognard, l'application joue le rôle de maître du jeu (dés, decks, tables, résolution).

> Le jeu original est © 2014 Clash of Arms Games. Ce projet transcrit les données fonctionnelles
> (valeurs, tables, effets) pour un usage strictement personnel. Ne pas publier le contenu.

## Structure

- `data/cards/` — les ~200 cartes en JSON (effets structurés)
  - `duel.json` (cartes 1–18), `in-garrison-events.json` (19–40), `in-garrison.json` (41–92),
    `on-campaign-events.json` (93–127), `on-campaign.json` (128–179), `combat.json` (180–200)
- `data/tables/` — tables et feuilles : blessures, grades/promotions, saisons, affectations,
  commandement de bataille, Fair Sex, persécution des Bourbons, camarades d'armes…
- `engine/` (à venir) — moteur de règles pur, testable, sans UI
- `ui/` (à venir) — React + TypeScript + Vite, 100 % client, sauvegarde localStorage

## Conventions des données

- Abréviations du jeu : `N` notice de Napoléon, `G` gloire, `E` expérience, `M` argent (francs),
  `H` santé, `C` charme, `F` escrime, `S` standing, `W` % blessure, `P` % prisonnier.
- Jets : `"1D10/2up"` = 1D10 divisé par 2 arrondi sup ; `"2D10"` = pourcentage 1–100.
- Cartes par catégorie de grade : `line` (sergent→capitaine), `field` (chef de bataillon→général de brigade),
  `general` (général de division→maréchal).
- `"verify": true` sur une entrée = lecture incertaine depuis les photos, à revérifier sur le matériel.

## Lancer

```bash
npm install
npm run dev      # le jeu, sur http://localhost:5173
npm run check    # contrôle complet : données de cartes, types, non-régression
```

## Organisation

| Fichier | Rôle |
|---|---|
| `src/engine/game.ts` | Le moteur : phases, rounds, cartes, batailles, concurrents |
| `src/engine/cards.ts` | Forme des données de cartes et leur contrôle |
| `src/engine/policy.ts` | Comment un concurrent tranche ses décisions |
| `src/engine/chronicle.ts` | Rédaction du récit de fin de saison |
| `src/engine/storage.ts` | Sauvegarde, reprise, panthéon |
| `src/ui/` | React : plateau, feuille, chronique, fenêtres de consultation |
| `data/` | Les 200 cartes et les tables du jeu, en JSON |
| `scripts/` | Outils de contrôle et de mesure — voir `scripts/README.md` |

Le moteur ne dépend ni de React ni du navigateur : il tourne sous Node, ce qui
permet de simuler des centaines de carrières pour mesurer l'équilibre.

## Étapes

1. ✅ Transcription des données (cartes + tables)
2. ✅ Moteur : personnage, saisons/rounds/phases, decks, cartes In Garrison
3. Batailles, cartes Combat, blessures/mort/prison, promotions/titres/Légion d'Honneur
4. Duels, offices/corruption, absences, Cent-Jours, fin de partie
5. Règles optionnelles : Fair Sex, Espagne, Battle Command
6. Habillage période + journal narratif de carrière
