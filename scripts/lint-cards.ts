/** Contrôle des données : champs inconnus, doublons, fourchettes trouées. */
import {
  GARRISON_CARDS, GARRISON_EVENTS, IDLE_TIME_CARDS,
  CAMPAIGN_CARDS, CAMPAIGN_EVENTS, COMBAT_CARDS,
  RANKS, LOH_LEVELS, WOUND_TABLE, SEASONS, ASSIGNMENTS,
} from '../src/engine/data';
import { validateCards } from '../src/engine/cards';
import { validateTables } from '../src/engine/tables';

const problems = [
  ...validateCards({
    garrison: GARRISON_CARDS,
    garrisonEvents: GARRISON_EVENTS,
    idleTime: IDLE_TIME_CARDS,
    campaign: CAMPAIGN_CARDS,
    campaignEvents: CAMPAIGN_EVENTS,
    combat: COMBAT_CARDS,
  }),
  ...validateTables({
    ranks: RANKS,
    lohLevels: LOH_LEVELS,
    wounds: WOUND_TABLE,
    seasons: SEASONS,
    assignments: ASSIGNMENTS,
  }),
];

if (!problems.length) {
  console.log('Cartes et tables : rien à signaler.');
  process.exit(0);
}
console.log(`${problems.length} anomalie(s) :`);
for (const p of problems) console.log('  ' + p);
process.exit(1);
