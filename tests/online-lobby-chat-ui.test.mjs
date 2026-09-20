// Online lobby / chat UX wave (v8.6). Focused contracts for the five shipped
// items: chat clock stamps + mention emphasis + a counted unread badge, the
// non-live connection diagnostics block, room-browser search/sort/hide with a
// refreshed-ago stamp, truthful vote/rematch feedback, and an earned invite copy
// confirmation. Pure helpers are imported from the real components; the rest is
// source-pinned in the same read-the-source style as ranked-ui.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {register} from 'node:module';
import * as React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const root = new URL('../', import.meta.url);
register('./tsx-loader.mjs', import.meta.url);
// `@/` is the app alias for the repo root (configuration.tsx uses it), and the
// hook adds the extension fallbacks the loader needs for its imports.
register(`data:text/javascript,${encodeURIComponent(`export async function resolve(specifier,context,nextResolve){
 if(specifier.startsWith('@/')){const base='${root.href}'+specifier.slice(2);for(const ext of ['.tsx','.ts','']){try{return await nextResolve(base+ext,context);}catch{}}throw new Error('unresolved alias '+specifier);}
 try{return await nextResolve(specifier,context);}catch(error){if(!specifier.startsWith('.'))throw error;for(const ext of ['.tsx','.ts']){try{return await nextResolve(specifier+ext,context);}catch{}}throw error;}
}`)}`);
register(`data:text/javascript,${encodeURIComponent(`export async function load(url,context,nextLoad){if(url.endsWith('.css'))return {format:'module',source:'export default {}',shortCircuit:true};return nextLoad(url,context);}`)}`);

const {ChatLine,GameChat,chatStamp,mentionSegments,isSelfMention,chatUnreadLabel} = await import('../app/game-ui/game-chat.tsx');
const {sortRooms,filterRooms,roomAgeSeconds,refreshedLabel,roomPingOf} = await import('../app/ui/screens/NetScreens.tsx');

const read = path => readFile(new URL(path, root), 'utf8');
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test('chat lines carry an HH:MM stamp and wordless-safe mention emphasis', () => {
  // Build the instant from local components so the expected wall clock is
  // independent of the machine timezone.
  const local = new Date(2026, 0, 2, 13, 5, 0, 0);
  assert.equal(chatStamp(local.getTime()), '13:05', 'epoch ms renders as local HH:MM');
  assert.equal(chatStamp(null), null, 'a missing stamp renders nothing');
  assert.equal(chatStamp(0), null, 'a placeholder zero is not a timestamp');

  assert.deepEqual(mentionSegments('gg @Mojo push @ana-2!'), [
    {text: 'gg '},
    {text: '@Mojo', mention: true, token: 'Mojo'},
    {text: ' push '},
    {text: '@ana-2', mention: true, token: 'ana-2'},
    {text: '!'},
  ], 'mention spans preserve the text verbatim');
  assert.deepEqual(mentionSegments('no mentions here'), [{text: 'no mentions here'}]);
  assert.equal(isSelfMention('mojo', 'Mojo'), true);
  assert.equal(isSelfMention('mojo', 'Mojo Bot'), true, 'a spaced name matches word by word');
  assert.equal(isSelfMention('moj', 'Mojo'), false);
  assert.equal(isSelfMention('mojo', ''), false, 'an unknown self name never claims a mention');

  const message = {name: 'Ana', text: '@Mojo push B', time: local.getTime()};
  const self = render(ChatLine, {message, selfName: 'Mojo'});
  assert.match(self, /<time class="chat-time"[^>]*>13:05<\/time>/, 'the stamp renders as a <time> element');
  assert.match(self, /class="chat-mention chat-mention--self"/, 'a self mention gets its own emphasis');
  assert.match(self, /\(you\)/, 'the self mention carries a word for assistive tech');
  assert.match(self, /visually-hidden/, 'the word cue is visually hidden, not spoken twice on screen');
  const other = render(ChatLine, {message, selfName: 'Someone Else'});
  assert.match(other, /class="chat-mention"/);
  assert.doesNotMatch(other, /chat-mention--self|\(you\)/, 'another player\'s mention is not labelled as mine');

  const log = render(GameChat, {hud: {net: true}, chatOpen: false, chatLog: [message], chatInputRef: null, chatDraft: '', sendChat: () => {}, setChatOpen: () => {}, setChatDraft: () => {}, selfName: 'Mojo'});
  assert.match(log, /chat-time/, 'the in-game overlay shares the stamped line');
  assert.doesNotMatch(log, /aria-live/, 'the in-game overlay adds no live region of its own');
});

test('the lobby unread badge counts messages and keeps the jump-to-latest action', async () => {
  assert.equal(chatUnreadLabel(1), '1 NEW MESSAGE · JUMP TO LATEST');
  assert.equal(chatUnreadLabel(4), '4 NEW MESSAGES · JUMP TO LATEST');
  assert.equal(chatUnreadLabel(0), '0 NEW MESSAGES · JUMP TO LATEST', 'zero is worded, never hidden nonsense');

  const [page, screens] = await Promise.all([read('app/page.tsx'), read('app/ui/screens/NetScreens.tsx')]);
  assert.match(page, /\[newMessages,setNewMessages\]=useState\(0\)/, 'unread starts as a count, not a flag');
  assert.match(page, /setNewMessages\(\(count:number\)=>count\+1\)/, 'each unseen message raises the count');
  assert.match(page, /setNewMessages\(0\)/g, 'landing at the bottom clears the count');
  assert.ok(!/setNewMessages\(true\)|setNewMessages\(false\)/.test(page), 'the boolean form is gone');
  assert.match(screens, /role="log" aria-label="Room chat"/, 'the log keeps its implicit live region');
  assert.match(screens, /newMessages>0&&/, 'the badge only renders with unseen messages');
  assert.match(screens, /chatUnreadLabel\(newMessages\)/, 'the badge uses the counted label');
  assert.match(screens, /setNewMessages\(0\)/, 'jumping to latest clears the count');
  assert.ok(!screens.includes('aria-live'), 'the lobby adds no live region');
});

test('the lobby diagnostics are worded, non-live and read the live client', async () => {
  const src = await read('app/ui/screens/NetScreens.tsx');
  assert.match(src, /aria-label="Connection diagnostics"/, 'the block is a named group');
  assert.match(src, /import \{connectionQuality\} from '\.\.\/\.\.\/\.\.\/game\/hud\.mjs'/, 'quality comes from the existing pure estimator');
  for (const label of ['RTT · <b>', 'ROUND TRIP', 'J · <b>', 'JITTER', 'L · <b>', 'LOSS']) {
    assert.ok(src.includes(label), `the diagnostics label ${label}`);
  }
  assert.match(src, /NO SNAPSHOTS YET/, 'jitter/loss admit the stream has not started');
  assert.match(src, /const diagState=connected\?'CONNECTED':holdLeft!==null\?'RECONNECTING':'OFFLINE'/, 'the connection state is worded');
  assert.match(src, /SEAT HOLD · <b>\{holdLeft>0\?`~\$\{holdLeft\}s LEFT`:'WINDOW PASSED'\}/, 'the seat-hold time stays worded');
  assert.match(src, /\{\(netRoomId\|\|connected\)&&/, 'the block renders in the lobby and while disconnected');
});

test('room filters search, hide and sort truthfully, with a refreshed-ago stamp', async () => {
  const rooms = [
    {roomId: 'AAAA', name: 'Alpha', players: 3, started: false, mapId: 'forge', config: {mode: 'deathmatch'}, ping: 40},
    {roomId: 'BBBB', name: 'Bravo', players: 1, started: true, mapId: 'exchange', config: {mode: 'ctf'}},
    {roomId: 'CCCC', name: 'Charlie', players: 2, started: false, mapId: 'forge', config: {mode: 'ctf'}},
  ];
  assert.equal(roomPingOf(rooms[0]), 40);
  assert.equal(roomPingOf(rooms[1]), null, 'a server without ping reports nothing');

  assert.deepEqual(sortRooms(rooms, 'players', false).map(r => r.roomId), ['AAAA', 'CCCC', 'BBBB'], 'players sort is a count, largest first');
  assert.deepEqual(sortRooms(rooms, 'name', false).map(r => r.roomId), ['AAAA', 'BBBB', 'CCCC'], 'name sort is alphabetical');
  assert.deepEqual(sortRooms(rooms, 'ping', false).map(r => r.roomId), ['AAAA', 'BBBB', 'CCCC'], 'unreported ping falls back to name order');
  assert.deepEqual(sortRooms(rooms, 'ping', true).map(r => r.roomId), ['AAAA', 'BBBB', 'CCCC'], 'reported ping orders ascending');
  assert.deepEqual(sortRooms(rooms, 'ping', true).map(r => r.ping ?? null), [40, null, null], 'unknown pings sort last');

  assert.deepEqual(filterRooms(rooms, {hideStarted: true}).map(r => r.roomId), ['AAAA', 'CCCC'], 'hide in-progress drops started rooms');
  assert.deepEqual(filterRooms(rooms, {query: 'ctf'}).map(r => r.roomId), ['BBBB', 'CCCC'], 'search covers name, code, map and mode');
  assert.deepEqual(filterRooms(rooms, {query: 'forge'}).map(r => r.roomId), ['AAAA', 'CCCC']);
  assert.deepEqual(filterRooms(rooms, {size: 'medium'}).map(r => r.roomId), ['AAAA'], 'size buckets keep working alongside search');
  assert.deepEqual(filterRooms(rooms, {size: 'small'}).map(r => r.roomId), ['BBBB', 'CCCC'], 'small is 1-2 players');

  assert.equal(roomAgeSeconds(0, 5000), null, 'no refresh stamp yet');
  assert.equal(roomAgeSeconds(1000, 4500), 4, 'seconds since the list arrived');
  assert.equal(refreshedLabel(null), 'LIST NOT REFRESHED YET');
  assert.equal(refreshedLabel(0), 'REFRESHED JUST NOW');
  assert.equal(refreshedLabel(4), 'REFRESHED 4s AGO');

  const src = await read('app/ui/screens/NetScreens.tsx');
  assert.match(src, /role="group" aria-label="Room filters"/, 'the filter group keeps its label');
  assert.match(src, /aria-label="Search rooms"/, 'the search box is labelled');
  assert.match(src, /aria-label="Sort rooms"/, 'the sort select is labelled');
  assert.match(src, /aria-pressed=\{hideStarted\}/, 'the hide toggle exposes a pressed state');
  assert.match(src, /HIDE IN-PROGRESS/, 'the toggle is worded both ways');
  assert.match(src, /refreshedLabel\(/, 'the refreshed stamp uses the worded helper');
  assert.match(src, /localeCompare/, 'sorting is stable and locale-aware');
  const css = await read('app/styles/ui.css');
  assert.match(css, /\.theater-filters select\{min-height:44px/, 'filter selects keep the 44 px target');
});

test('vote rows carry counts and bars, the countdown is server-gated and REMATCH NOW needs the gate', async () => {
  const src = await read('app/ui/screens/NetScreens.tsx');
  assert.match(src, /voteMax=voteRows\.reduce/, 'proportional bars need the leading vote count');
  assert.match(src, /<Meter ratio=\{voteMax>0\?row\.votes\/voteMax:0\}\/>/, 'each map row shows a proportional bar');
  assert.match(src, /VOTE\{row\.votes===1\?'':'S'\}/, 'the count is worded, singular or plural');
  assert.match(src, /' · LEADING'/, 'the leading map is named in words');
  assert.match(src, /const voteClose=voteCloseRaw===null\|\|voteCloseRaw===undefined\|\|voteCloseRaw===''\?null:\(Number\.isFinite\(Number\(voteCloseRaw\)\)\?Math\.max\(0,Math\.ceil\(Number\(voteCloseRaw\)\)\):null\)/, 'the countdown only exists when the server sends a finite value');
  assert.match(src, /voteClose!==null\s*\?\s*<p className="field-note">MAP VOTES CLOSE IN \{voteClose\}s/, 'the countdown renders only on that gate');
  assert.match(src, /VOTES STAY OPEN UNTIL CHANGED/, 'without a server timer the panel states the rule instead of inventing one');
  assert.match(src, /net\.isHost&&!net\.spectate&&lifecycle\.rematchReady===true&&<Btn variant="primary" onClick=\{hostAndStart\} disabled=\{!connected\}>REMATCH NOW · GATE MET<\/Btn>/, 'REMATCH NOW is gated on the server-ready rematch flag and host seat');
  assert.match(src, /aria-pressed=\{myRematchVote\}/, 'the vote toggle keeps its pressed state');
});

test('the invite toolbar surfaces the room code and join state, and only claims a real copy', async () => {
  const src = await read('app/ui/screens/NetScreens.tsx');
  assert.match(src, /import \{inviteLink,normaliseRoomCode\} from '\.\.\/\.\.\/\.\.\/game\/invite\.mjs'/, 'the code is normalised by the shared helper');
  assert.match(src, /ROOM CODE <b className="room-code">\{roomCode\}<\/b>/, 'the short room code is visible');
  assert.match(src, /<Chip tone=\{connected\?'default':'danger'\}>\{joinState\}<\/Chip>/, 'join state is worded next to the code');
  assert.match(src, /const joinState=!connected\?'DISCONNECTED':net\.spectate\?'SPECTATING':net\.isHost\?'HOSTING':'WAITING ON HOST'/, 'the join state covers offline, spectator, host and guest');
  assert.match(src, /const ok=await copyText\(invite\);setCopyState\(ok\?'copied':'failed'\)/, 'success is only claimed when the copy resolved true');
  assert.match(src, /COPY FAILED · THE LINK FIELD IS SELECTED, COPY IT MANUALLY\./, 'a failed copy says so and points at the field');
  assert.match(src, /copyState==='failed'\?'COPY FAILED':'COPY LINK'/, 'the button never says copied after a failure');
  assert.match(src, /disabled=\{!invite\}/, 'a missing link cannot be advertised as copyable');
  assert.match(src, /inviteLink\(window\.location\.href,netRoomId,\{spectate:net\.spectate===true\}\)/, 'the existing invite link flow is untouched');
});
