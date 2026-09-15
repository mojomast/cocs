const DEFAULT_CAPACITY = 8;

export function createSteam(options = {}) {
 const injected = Object.prototype.hasOwnProperty.call(options, 'binding');
 const appId = options.appId;
 const state = {
  available: false,
  binding: injected ? options.binding ?? null : undefined,
  client: null,
  currentLobby: null,
  lobbies: new Map(),
  handles: [],
 };

 function remember(lobby) {
  if (lobby && lobby.id != null) state.lobbies.set(String(lobby.id), lobby);
  return lobby;
 }

 function resolveLobby(lobbyId) {
  if (lobbyId == null) return state.currentLobby;
  return state.lobbies.get(String(lobbyId)) ?? null;
 }

 function summarize(lobby) {
  if (!lobby) return null;
  const get = key => {
   try {
    const value = typeof lobby.getData === 'function' ? lobby.getData(key) : null;
    return value == null ? '' : String(value);
   } catch {
    return '';
   }
  };
  return { id: String(lobby.id), name: get('name'), mode: get('mode'), map: get('map'), hostType: get('hostType') };
 }

 async function init() {
  if (state.available) return true;
  if (state.binding === undefined) {
   try {
    const mod = await import('steamworks.js');
    state.binding = mod?.init ? mod : mod?.default ?? mod ?? null;
   } catch {
    state.binding = null;
   }
  }
  const binding = state.binding;
  if (!binding || typeof binding.init !== 'function') {
   state.binding = null;
   return false;
  }
  let client = null;
  try {
   client = await binding.init(Number.isFinite(appId) ? appId : undefined);
  } catch {
   client = null;
  }
  if (!client) return false;
  state.client = client;
  state.available = true;
  return true;
 }

 function shutdown() {
  for (const handle of state.handles) {
   try {
    handle?.disconnect?.();
   } catch {}
  }
  state.handles = [];
  try {
   state.currentLobby?.leave?.();
  } catch {}
  state.currentLobby = null;
  state.lobbies.clear();
  state.client = null;
  state.available = false;
  if (!injected) state.binding = undefined;
  return true;
 }

 async function createLobby(opts = {}) {
  const client = state.client;
  if (!client?.matchmaking?.createLobby) return null;
  const capacity = Number.isFinite(Number(opts.capacity)) ? Number(opts.capacity) : DEFAULT_CAPACITY;
  const lobbyType = opts.lobbyType ?? client.matchmaking.LobbyType?.Public ?? 2;
  let lobby = null;
  try {
   lobby = await client.matchmaking.createLobby(lobbyType, capacity);
  } catch {
   return null;
  }
  if (!lobby) return null;
  remember(lobby);
  state.currentLobby = lobby;
  const metadata = { name: opts.name, mode: opts.mode, map: opts.map, hostType: opts.hostType ?? 'p2p', capacity: String(capacity) };
  for (const [key, value] of Object.entries(metadata)) {
   if (value == null || typeof lobby.setData !== 'function') continue;
   try {
    lobby.setData(key, String(value));
   } catch {}
  }
  return summarize(lobby);
 }

 async function joinLobby(lobbyId) {
  const client = state.client;
  if (!client?.matchmaking?.joinLobby || lobbyId == null) return null;
  let lobby = null;
  try {
   lobby = await client.matchmaking.joinLobby(BigInt(lobbyId));
  } catch {
   return null;
  }
  if (!lobby) return null;
  remember(lobby);
  state.currentLobby = lobby;
  return summarize(lobby);
 }

 async function listLobbies() {
  const client = state.client;
  if (!client?.matchmaking?.getLobbies) return [];
  let lobbies = null;
  try {
   lobbies = await client.matchmaking.getLobbies();
  } catch {
   return [];
  }
  if (!Array.isArray(lobbies)) return [];
  return lobbies.filter(Boolean).map(lobby => summarize(remember(lobby)));
 }

 function setLobbyMetadata(lobbyId, key, value) {
  const lobby = resolveLobby(lobbyId);
  if (!state.client || !lobby || typeof lobby.setData !== 'function' || key == null) return false;
  try {
   return !!lobby.setData(String(key), value == null ? '' : String(value));
  } catch {
   return false;
  }
 }

 function getLobbyMetadata(lobbyId, key) {
  const lobby = resolveLobby(lobbyId);
  if (!state.client || !lobby || typeof lobby.getData !== 'function' || key == null) return null;
  try {
   const value = lobby.getData(String(key));
   return value == null ? null : String(value);
  } catch {
   return null;
  }
 }

 function openInviteDialog() {
  const lobby = state.currentLobby;
  if (!state.client || !lobby || typeof lobby.openInviteDialog !== 'function') return false;
  try {
   lobby.openInviteDialog();
   return true;
  } catch {
   return false;
  }
 }

 function onJoinRequested(cb) {
  const client = state.client;
  if (typeof cb !== 'function') return () => {};
  const register = client?.callback?.register;
  if (typeof register !== 'function') return () => {};
  const event = client?.callback?.SteamCallback?.GameLobbyJoinRequested ?? state.binding?.SteamCallback?.GameLobbyJoinRequested ?? 8;
  let handle = null;
  try {
   handle = register(event, value => {
    try {
     cb(String(value?.lobby_steam_id ?? ''));
    } catch {}
   });
  } catch {
   return () => {};
  }
  state.handles.push(handle);
  return () => {
   try {
    handle?.disconnect?.();
   } catch {}
  };
 }

 function readCloud(key) {
  const client = state.client;
  if (!client?.cloud?.readFile || key == null) return null;
  try {
   const value = client.cloud.readFile(String(key));
   return value == null ? null : String(value);
  } catch {
   return null;
  }
 }

 function writeCloud(key, value) {
  const client = state.client;
  if (!client?.cloud || key == null) return false;
  if (value == null) return deleteCloud(key);
  if (typeof client.cloud.writeFile !== 'function') return false;
  try {
   return !!client.cloud.writeFile(String(key), String(value));
  } catch {
   return false;
  }
 }

 function deleteCloud(key) {
  const client = state.client;
  if (!client?.cloud?.deleteFile || key == null) return false;
  try {
   return !!client.cloud.deleteFile(String(key));
  } catch {
   return false;
  }
 }

 function setStat(name, value) {
  const client = state.client;
  if (!client?.stats?.setInt || name == null) return false;
  try {
   return !!client.stats.setInt(String(name), Number(value));
  } catch {
   return false;
  }
 }

 function storeStats() {
  const client = state.client;
  if (!client?.stats?.store) return false;
  try {
   return !!client.stats.store();
  } catch {
   return false;
  }
 }

 function unlockAchievement(id) {
  const client = state.client;
  if (!client?.achievement?.activate || id == null) return false;
  try {
   return !!client.achievement.activate(String(id));
  } catch {
   return false;
  }
 }

 function setRichPresence(key, value) {
  const client = state.client;
  if (!client?.localplayer?.setRichPresence || key == null) return false;
  try {
   client.localplayer.setRichPresence(String(key), value == null ? null : String(value));
   return true;
  } catch {
   return false;
  }
 }

 function isSteamDeck() {
  const client = state.client;
  if (!client?.utils?.isSteamRunningOnSteamDeck) return false;
  try {
   return !!client.utils.isSteamRunningOnSteamDeck();
  } catch {
   return false;
  }
 }

 return {
  get available() {
   return state.available;
  },
  init,
  shutdown,
  createLobby,
  joinLobby,
  listLobbies,
  setLobbyMetadata,
  getLobbyMetadata,
  openInviteDialog,
  onJoinRequested,
  readCloud,
  writeCloud,
  deleteCloud,
  setStat,
  storeStats,
  unlockAchievement,
  setRichPresence,
  isSteamDeck,
 };
}
