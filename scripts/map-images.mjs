/**
 * Associe chaque carte à sa découpe.
 * Les planches suivent l'ordre des numéros de cartes (lisibles sur l'écusson) :
 *   garnison evenement = 19-60, garnison generique = 61-92,
 *   campagne evenement = 93-145, campagne generique = 146-179, combat = 180-200.
 * Écrit data/cards/images.json et complète les numéros manquants des données.
 */
import fs from 'fs';

const idle = (n) => Array.from({ length: n }, (_, i) => `idle-time-${i + 1}`);
const rep = (id, n) => Array.from({ length: n }, () => id);

const PLATES = [
  { prefix: 'ige', start: 19, ids: [
    'louis-xvi-arrested', 'you-are-denounced', 'louis-xvi-guillotined', 'coup-9-thermidor',
    'coup-13-vendemiaire', 'marriage-josephine', 'wurmser-mantua', 'coup-18-fructidor',
    'coup-18-brumaire', 'infernal-machine', 'fall-moreau-pichegru', 'execution-enghien',
    'grand-review-boulogne', 'crowning-of-napoleon', 'christmas-warsaw', 'peace-of-tilsit',
    'revolt-of-may-2nd', 'marriage-marie-louise', 'birth-king-of-rome', 'the-abdication',
    'the-emperor-returns', 'round-ends-card', 'assigned-to-spain', 'you-please-your-commander',
    'you-displease-your-commander', 'you-contract-the-pox', 'meet-a-lady', 'administrative-work',
    'assigned-to-staff', 'training', 'inspect', 'undergo-inspection', 'dispatches-garrison',
    'burger-insults-napoleon', 'dine-with-senior-commander', 'dine-with-magistrate',
    'civil-occupation-duties', 'illegal-activity', 'contract-dysentery', 'commit-faux-pas',
    'contretemps', 'duty-officer',
  ] },
  { prefix: 'ig', start: 61, ids: [
    ...idle(10),
    'napoleon-speaks-to-you', 'army-auditors', 'emperor-fancies-your-lady',
    'you-are-a-passing-fancy', 'you-are-accused', 'challenge-to-horse-race', 'spread-rumors',
    'celebratory-drinking-bout', 'second-to-dhubert', 'eg-dartmoor', 'eg-corsican-brothers',
    'eg-study-dueling', 'eg-foxhunt', 'eg-napoleons-papers', 'eg-soiree',
    ...rep('end-of-round-ig', 7),
  ] },
  { prefix: 'oce', start: 93, ids: [
    'battle-of-valmy', 'battle-of-jemappes', 'neerwinden-traitor', 'rebellion-vendee',
    'siege-of-toulon', 'the-terror', 'battle-of-fleurus', 'lodi-castiglione', 'arcola-rivoli',
    'battle-of-the-pyramids', 'first-zurich-trebbia', 'victories-and-defeat', 'st-bernard-marengo',
    'battle-of-hohenlinden', 'elchingen-danube', 'battle-of-austerlitz', 'jena-auerstadt',
    'battle-of-eylau', 'danzig-friedland', 'battle-of-eckmuhl', 'vienna-aspern-essling',
    'battle-of-wagram', 'march-into-russia', 'battle-of-borodino', 'moscow-berezina',
    'lutzen-bautzen-armistice', 'dresden-katzbach', 'battle-of-leipzig', 'battle-of-la-rothiere',
    'six-days-of-glory', 'battle-of-ligny', 'battle-of-quatre-bras', 'battle-of-wavre',
    'battle-of-waterloo', 'battle-in-spain',
    'bivouac-1', 'halt-march', 'on-the-march-easy', 'on-the-march-normal', 'on-the-march-hard',
    'forced-march',
    'bivouac-1', 'halt-march', 'on-the-march-easy', 'on-the-march-normal', 'on-the-march-hard',
    'forced-march',
    'dispatches-campaign', 'batmen-pilfer-your-baggage', 'fall-from-your-horse',
    'civilian-requisitions', 'contract-lung-fever', 'seize-horses-for-the-army',
  ] },
  { prefix: 'oc', start: 146, ids: [
    'guard-depot', 'find-a-wine-cellar', 'convoy-duty', 'success-against-enemy', 'reconnaissance',
    'surprise-enemy-convoy', 'conduct-river-crossing', 'parley-with-enemy', 'partisan-ambush',
    'repulsed-by-the-enemy', 'minor-action', 'affaire-de-postes', 'skirmish', 'probe-enemy',
    'repulse-enemy-probe', 'fight-off-marauders', 'coup-de-main', 'sack-the-town',
    'dangerous-mission', 'spread-rumors-of-cowardice', 'challenged-by-enemy-champion',
    'eg-carry-dispatches', 'eg-brigand-deserters', 'eg-diplomatic-communique', 'eg-rough-justice',
    'eg-hussars-honor', 'eg-remounts',
    ...rep('end-of-round-oc', 7),
  ] },
  { prefix: 'cbt', start: 180, ids: [
    'victory-mont-st-jean', 'carry-the-day-1', 'carry-the-day-2', 'lead-counterattack-1',
    'lead-counterattack-2', 'telling-maneuver-1', 'telling-maneuver-2', 'lead-attack-1',
    'lead-attack-2', 'defend-the-position-1', 'defend-the-position-2', 'unit-flanked-1',
    'unit-flanked-2', 'unit-surprised-1', 'unit-surprised-2', 'unit-overrun-1', 'unit-overrun-2',
    'unit-decimated-1', 'unit-decimated-2', 'held-in-reserve-1', 'held-in-reserve-2',
  ] },
];

const manifest = JSON.parse(fs.readFileSync('public/cards/slices/manifest.json', 'utf8'));

// ids connus des données
const known = new Set();
for (const f of ['in-garrison', 'in-garrison-events', 'on-campaign', 'on-campaign-events', 'combat']) {
  const j = JSON.parse(fs.readFileSync(`data/cards/${f}.json`, 'utf8'));
  for (const c of j.cards ?? []) known.add(c.id);
  for (const c of j.idleTime ?? []) known.add(c.id);
}

const images = {};
const numbers = {};
let missing = [];
for (const { prefix, start, ids } of PLATES) {
  const cells = manifest[prefix]?.cells ?? [];
  ids.forEach((id, i) => {
    const cell = cells[i];
    if (!cell) { console.log(`!! case absente ${prefix}[${i}] pour ${id}`); return; }
    if (!known.has(id)) missing.push(id);
    if (!(id in images)) { images[id] = cell.file; numbers[id] = start + i; }
  });
  const extra = cells.length - ids.length;
  console.log(`${prefix.padEnd(4)} ${ids.length} cartes (${start}-${start + ids.length - 1})` +
    (extra > 0 ? `  +${extra} dos` : ''));
}

if (missing.length) console.log('\n!! ids inconnus des données :', [...new Set(missing)].join(', '));

const unmapped = [...known].filter((id) => !(id in images));
if (unmapped.length) console.log('\n!! cartes sans image :', unmapped.join(', '));

fs.writeFileSync('data/cards/images.json', JSON.stringify({
  comment: 'Carte -> découpe de planche. Numéros lus sur l’écusson des cartes.',
  numbers, images,
}, null, 2));
console.log(`\n${Object.keys(images).length} cartes associées à une image.`);
