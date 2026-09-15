import test from 'node:test';
import assert from 'node:assert/strict';
import {createSteam} from './steam.mjs';

function makeBinding({ deck = false, failInit = false, throwOnCall = false } = {}) {
 const calls = { init: [], createLobby: [], joinLobby: [], setData: [], readFile: [], writeFile: [], deleteFile: [], setInt: [], store: 0, activate: [], richPresence: [], register: [] };
 const lobbyData = new Map();
 const guard = () => {
  if (throwOnCall) throw new Error('native failure');
 };
 const makeLobby = id => ({
  id,
  getData: key => {
   guard();
   return lobbyData.has(key) ? lobbyData.get(key) : null;
  },
  setData: (key, value) => {
   guard();
   calls.setData.push([id, key, value]);
   lobbyData.set(key, value);
   return true;
  },
  openInviteDialog: () => {
   guard();
   calls.openInviteDialog = (calls.openInviteDialog ?? 0) + 1;
  },
  leave: () => {
   calls.leave = (calls.leave ?? 0) + 1;
  },
 });
 const lobby = makeLobby(111n);
 const joined = makeLobby(222n);
 const client = {
  matchmaking: {
   LobbyType: { Public: 2 },
   createLobby: async (type, max) => {
    guard();
    calls.createLobby.push([type, max]);
    return lobby;
   },
   joinLobby: async id => {
    guard();
    calls.joinLobby.push(id);
    return joined;
   },
   getLobbies: async () => {
    guard();
    calls.getLobbies = (calls.getLobbies ?? 0) + 1;
    return [lobby, joined];
   },
  },
  cloud: {
   readFile: name => {
    guard();
    calls.readFile.push(name);
    return name === 'save' ? '{"a":1}' : null;
   },
   writeFile: (name, content) => {
    guard();
    calls.writeFile.push([name, content]);
    return true;
   },
   deleteFile: name => {
    guard();
    calls.deleteFile.push(name);
    return true;
   },
  },
  stats: {
   setInt: (name, value) => {
    guard();
    calls.setInt.push([name, value]);
    return true;
   },
   store: () => {
    guard();
    calls.store += 1;
    return true;
   },
  },
  achievement: {
   activate: id => {
    guard();
    calls.activate.push(id);
    return true;
   },
  },
  localplayer: {
   setRichPresence: (key, value) => {
    guard();
    calls.richPresence.push([key, value]);
   },
  },
  utils: { isSteamRunningOnSteamDeck: () => deck },
  callback: {
   SteamCallback: { GameLobbyJoinRequested: 8 },
   register: (event, handler) => {
    calls.register.push(event);
    calls.joinHandler = handler;
    return { disconnect: () => { calls.disconnected = (calls.disconnected ?? 0) + 1; } };
   },
  },
 };
 const binding = {
  SteamCallback: { GameLobbyJoinRequested: 8 },
  init: id => {
   calls.init.push(id);
   if (failInit) throw new Error('steam unavailable');
   return client;
  },
 };
 return { binding, client, calls };
}

test('no binding degrades to documented defaults without throwing', async () => {
 const steam = createSteam({ binding: null, appId: 480 });
 assert.equal(steam.available, false);
 assert.equal(await steam.init(), false);
 assert.equal(steam.available, false);
 assert.equal(await steam.createLobby({ name: 'x' }), null);
 assert.equal(await steam.joinLobby('1'), null);
 assert.deepEqual(await steam.listLobbies(), []);
 assert.equal(steam.setLobbyMetadata('1', 'k', 'v'), false);
 assert.equal(steam.getLobbyMetadata('1', 'k'), null);
 assert.equal(steam.openInviteDialog(), false);
 assert.equal(typeof steam.onJoinRequested(() => {}), 'function');
 assert.equal(steam.readCloud('k'), null);
 assert.equal(steam.writeCloud('k', 'v'), false);
 assert.equal(steam.deleteCloud('k'), false);
 assert.equal(steam.setStat('s', 1), false);
 assert.equal(steam.storeStats(), false);
 assert.equal(steam.unlockAchievement('a'), false);
 assert.equal(steam.setRichPresence('k', 'v'), false);
 assert.equal(steam.isSteamDeck(), false);
 assert.equal(steam.shutdown(), true);
});

test('binding without init and a failing init stay unavailable', async () => {
 const stub = createSteam({ binding: {}, appId: 480 });
 assert.equal(await stub.init(), false);
 assert.equal(stub.available, false);
 const { binding } = makeBinding({ failInit: true });
 const failing = createSteam({ binding, appId: 480 });
 assert.equal(await failing.init(), false);
 assert.equal(failing.available, false);
 assert.equal(failing.isSteamDeck(), false);
});

test('init forwards the app id and marks the wrapper available', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 assert.equal(steam.available, false);
 assert.equal(await steam.init(), true);
 assert.equal(steam.available, true);
 assert.deepEqual(calls.init, [480]);
 assert.equal(await steam.init(), true);
 assert.deepEqual(calls.init, [480]);
});

test('lobby create/join/list map to plain summaries', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 const created = await steam.createLobby({ name: 'Arena', mode: 'deathmatch', map: 'exchange', capacity: 6, hostType: 'p2p' });
 assert.deepEqual(calls.createLobby, [[2, 6]]);
 assert.equal(created.id, '111');
 assert.equal(created.name, 'Arena');
 assert.equal(created.mode, 'deathmatch');
 assert.equal(created.map, 'exchange');
 assert.equal(created.hostType, 'p2p');
 const joined = await steam.joinLobby('222');
 assert.deepEqual(calls.joinLobby, [222n]);
 assert.equal(joined.id, '222');
 const lobbies = await steam.listLobbies();
 assert.equal(calls.getLobbies, 1);
 assert.equal(lobbies.length, 2);
 assert.deepEqual(lobbies.map(l => l.id), ['111', '222']);
 assert.equal(steam.openInviteDialog(), true);
 assert.equal(calls.openInviteDialog, 1);
});

test('lobby metadata round-trips and unknown keys return null', async () => {
 const { binding } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 const lobby = await steam.createLobby({ name: 'Arena', capacity: 4 });
 assert.equal(steam.getLobbyMetadata(lobby.id, 'name'), 'Arena');
 assert.equal(steam.setLobbyMetadata(lobby.id, 'mode', 'soccer'), true);
 assert.equal(steam.getLobbyMetadata(lobby.id, 'mode'), 'soccer');
 assert.equal(steam.getLobbyMetadata(lobby.id, 'missing'), null);
 assert.equal(steam.getLobbyMetadata('nope', 'name'), null);
 assert.equal(steam.setLobbyMetadata('nope', 'name', 'x'), false);
});

test('cloud read/write/delete forward and treat writes with null as delete', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 assert.equal(steam.readCloud('save'), '{"a":1}');
 assert.equal(steam.readCloud('missing'), null);
 assert.equal(steam.writeCloud('save', 'data'), true);
 assert.deepEqual(calls.writeFile, [['save', 'data']]);
 assert.equal(steam.writeCloud('save', null), true);
 assert.deepEqual(calls.deleteFile, ['save']);
 assert.equal(steam.deleteCloud('save'), true);
 assert.deepEqual(calls.readFile, ['save', 'missing']);
});

test('stats and achievements forward the right arguments', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 assert.equal(steam.setStat('kills', 7), true);
 assert.deepEqual(calls.setInt, [['kills', 7]]);
 assert.equal(steam.storeStats(), true);
 assert.equal(calls.store, 1);
 assert.equal(steam.unlockAchievement('FIRST_BLOOD'), true);
 assert.deepEqual(calls.activate, ['FIRST_BLOOD']);
});

test('rich presence and join requests forward through the binding', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 assert.equal(steam.setRichPresence('status', 'Lobby'), true);
 assert.equal(steam.setRichPresence('status', null), true);
 assert.deepEqual(calls.richPresence, [['status', 'Lobby'], ['status', null]]);
 const seen = [];
 const off = steam.onJoinRequested(id => seen.push(id));
 assert.deepEqual(calls.register, [8]);
 calls.joinHandler({ lobby_steam_id: 999n, friend_steam_id: 1n });
 assert.deepEqual(seen, ['999']);
 off();
 assert.equal(calls.disconnected, 1);
 assert.equal(typeof steam.onJoinRequested('not-a-function'), 'function');
});

test('deck detection reports the binding value', async () => {
 const on = makeBinding({ deck: true });
 const steamOn = createSteam({ binding: on.binding, appId: 480 });
 await steamOn.init();
 assert.equal(steamOn.isSteamDeck(), true);
 const off = makeBinding({ deck: false });
 const steamOff = createSteam({ binding: off.binding, appId: 480 });
 await steamOff.init();
 assert.equal(steamOff.isSteamDeck(), false);
});

test('native calls that throw are reported as safe defaults', async () => {
 const { binding } = makeBinding({ throwOnCall: true });
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 assert.equal(steam.readCloud('save'), null);
 assert.equal(steam.writeCloud('save', 'data'), false);
 assert.equal(steam.deleteCloud('save'), false);
 assert.equal(steam.setStat('kills', 1), false);
 assert.equal(steam.storeStats(), false);
 assert.equal(steam.unlockAchievement('a'), false);
 assert.equal(steam.setRichPresence('k', 'v'), false);
 assert.equal(await steam.createLobby({ name: 'x' }), null);
 assert.equal(await steam.joinLobby('1'), null);
 assert.deepEqual(await steam.listLobbies(), []);
});

test('shutdown clears availability and leaves the lobby', async () => {
 const { binding, calls } = makeBinding();
 const steam = createSteam({ binding, appId: 480 });
 await steam.init();
 await steam.createLobby({ name: 'Arena', capacity: 4 });
 assert.equal(steam.shutdown(), true);
 assert.equal(steam.available, false);
 assert.equal(calls.leave, 1);
 assert.deepEqual(await steam.listLobbies(), []);
});
