// Original authored environments. Eligibility is stored beside each map so
// adding a destination cannot silently opt it into incompatible game modes.
import {DESTINATION_COMBAT_MAPS} from './destination-combat-maps.mjs';
import {DESTINATION_OBJECTIVE_MAPS} from './destination-objective-maps.mjs';
import {DESTINATION_LATTICE_MAPS} from './destination-lattice-maps.mjs';
import {DESTINATION_SPORTS_MAPS} from './destination-sports-maps.mjs';
import {freeze} from './map-schema.mjs';

export const DESTINATION_MAPS=freeze([
 ...DESTINATION_COMBAT_MAPS,
 ...DESTINATION_OBJECTIVE_MAPS,
 ...DESTINATION_LATTICE_MAPS,
 ...DESTINATION_SPORTS_MAPS,
]);
