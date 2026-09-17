// Narrative storytelling, dialogue transmissions, and mission lore for TokenArena.
// Provides cinematic radio chatter, speaker profiles, mission briefings, and tactical intel logs.

export const SPEAKERS = Object.freeze({
  DISPATCH: Object.freeze({
    id: 'DISPATCH',
    name: 'Tactical Control',
    callsign: 'COMMAND-01',
    role: 'Operations Director',
    color: '#57e6cd',
    tag: 'TACTICAL',
  }),
  RELAY: Object.freeze({
    id: 'RELAY',
    name: 'Network Relay Sub-AI',
    callsign: 'RELAY-7',
    role: 'Automated Network Monitor',
    color: '#7fe7ff',
    tag: 'NETWORK',
  }),
  WARDEN: Object.freeze({
    id: 'WARDEN',
    name: 'Substation Core Overmind',
    callsign: 'NODE-PRIME',
    role: 'Corrupted Overclocked Cluster AI',
    color: '#ff806b',
    tag: 'HOSTILE',
  }),
  HARBINGER: Object.freeze({
    id: 'HARBINGER',
    name: 'Swarm Sovereign',
    callsign: 'HARBINGER',
    role: 'Cluster Voice & Hive Commander',
    color: '#bb9aff',
    tag: 'HOSTILE',
  }),
  ECHO: Object.freeze({
    id: 'ECHO',
    name: 'Recon Drone Echo-4',
    callsign: 'ECHO-4',
    role: 'Field Reconnaissance',
    color: '#ffd166',
    tag: 'RECON',
  }),
});

export const MISSION_LORE = Object.freeze({
  'convoy-run': Object.freeze({
    title: 'Operation Long Haul',
    location: 'Convoy Transit Corridor 07 · Grid Delta-9',
    intel: 'Automated supply transports carrying neural hardware were ambushed along the eastern canyon highway. Signal telemetry went dark 4 minutes ago.',
    threatLevel: 'ORANGE · Concentrated melee swarms with spitter artillery',
    transmissions: [
      { speaker: 'DISPATCH', text: 'Convoy corridor is held. Use the open depot apron, then the service road.', step: 'rally', at: 1 },
      { speaker: 'ECHO', text: 'Defenders on the road, not the rooftops. Clear the lane before crossing.', step: 'tenements', at: 0 },
      { speaker: 'DISPATCH', text: 'Secure the crossing south of the bridge. Supplies follow the hold.', step: 'bridge', at: 0 },
      { speaker: 'RELAY', text: 'Yardmaster on the outside apron. Clear its guards to restore the relay.', step: 'yard', at: 0 },
    ],
  }),
  'reactor-run': Object.freeze({
    title: 'Operation Meltdown Breach',
    location: 'Titan Valley Geothermal Sub-Facility',
    intel: 'The Warden cluster node has seized the primary cooling valves. Thermal pressure is climbing exponentially.',
    threatLevel: 'RED · Heavy armored brutes and reinforced warden chassis',
    transmissions: [
      { speaker: 'DISPATCH', text: 'Geothermal telemetry is redlining. Cut through the outpost and bypass the security lockout.', step: 'outpost', at: 0 },
      { speaker: 'ECHO', text: 'Cavern sensors detecting massive seismic movement below the fault line.', step: 'cavern', at: 0 },
      { speaker: 'WARDEN', text: 'Organic intruder: your life-support signatures are registered and catalogued.', step: 'warden', at: 0 },
      { speaker: 'DISPATCH', text: 'Secure the reactor apron. The north cavern is the next objective.', step: 'reactor', at: 0 },
    ],
  }),
  'throne-siege': Object.freeze({
    title: 'Operation Crownfall',
    location: 'The Shattered Citadel · High Throne',
    intel: 'The central computing throne holds the master routing keys for the entire hostile machine cluster. Neutralizing it severs all regional drones.',
    threatLevel: 'BLACK · Fortified ring barricades, siege artillery, and overclocked Warden',
    transmissions: [
      { speaker: 'DISPATCH', text: 'This is the cluster core. Breaching outer perimeter now. Expect no reinforcement.', step: 'approach', at: 0 },
      { speaker: 'ECHO', text: 'Mortar defenders sighted across the pit floor! Keep moving to avoid artillery!', step: 'midfield', at: 0 },
      { speaker: 'WARDEN', text: 'You step upon our collective altar. You will be dismantled and archived.', step: 'warden', at: 0 },
      { speaker: 'DISPATCH', text: 'Throne core exposed! Secure the central floor before the backup generator engages!', step: 'throne', at: 0 },
    ],
  }),
  'ghost-wire': Object.freeze({
    title: 'Operation Frost Cipher',
    location: 'Sub-Zero Ridge Sensor Array · Frost Gate',
    intel: 'A high-altitude sensor relay is leaking encrypted allied flight paths to the cluster. Infiltrate under cover of the blizzard and slice the feed.',
    threatLevel: 'VIOLET · Stealth operation · Shield-bearers and rapid flanker units',
    transmissions: [
      { speaker: 'DISPATCH', text: 'Blizzard conditions grant sensor cover. Avoid direct engagement where possible.', step: 'drop', at: 0 },
      { speaker: 'ECHO', text: 'Lancer patrols detected along the north crevasse. Keep outside their positions.', step: 'ridge', at: 0 },
      { speaker: 'RELAY', text: 'Data splice initiated. Maintain proximity to the sensor mast.', step: 'slice', at: 0 },
      { speaker: 'DISPATCH', text: 'Cipher downloaded! Exfil route marked on your HUD — run!', step: 'exfil', at: 0 },
    ],
  }),
  'crown-duel': Object.freeze({
    title: 'Operation Sovereign Strike',
    location: 'The Fortress Keep · Apex Arena',
    intel: 'The Harbinger, mouthpiece of the machine cluster, has personally descended into the fortress keep to oversee terminal purging.',
    threatLevel: 'CRITICAL · Multi-phase boss battle with predeployed guards and phalanx shields',
    transmissions: [
      { speaker: 'DISPATCH', text: 'Final strike, operator. Take down the Harbinger and silence the cluster for good.', step: 'approach', at: 0 },
      { speaker: 'HARBINGER', text: 'Your flesh is a temporary anomaly. The swarm is eternal mathematics.', step: 'shield-line', at: 0 },
      { speaker: 'ECHO', text: 'Ring defenders ahead. Clear them before entering the keep.', step: 'ring', at: 0 },
      { speaker: 'DISPATCH', text: 'Summon channels are jammed. Its guard is already here. Press the attack!', step: 'duel', at: 0 },
    ],
  }),
});

export function getMissionLore(missionId) {
  return MISSION_LORE[missionId] || null;
}

export function formatTransmission(speakerId, text) {
  const speaker = SPEAKERS[speakerId] || { name: speakerId, callsign: 'COMMS', color: '#ffffff' };
  return {
    speaker: speaker.name,
    callsign: speaker.callsign,
    color: speaker.color,
    text,
    timestamp: Date.now(),
  };
}
