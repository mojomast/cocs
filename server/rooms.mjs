import {Room} from './room.mjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const QUEUE_MAX = 64;
export const TEAM_SIZE = 4;

// Derive a coarse matchmaking rating from a career profile. Kept pure so the
// queue, the tests and any future ranking display agree on the same number.
export function ratingFor(profile) {
 const xp = Math.max(0, Number(profile?.xp) || 0);
 const wins = Math.max(0, Number(profile?.wins) || 0);
 const kills = Math.max(0, Number(profile?.kills) || 0);
 return Math.round(xp / 100 + wins * 8 + kills * 0.5);
}

// Deterministic team balancing. Players are seeded by rating (descending), then
// snake-drafted into two sides; a bounded swap pass then minimises the summed
// rating gap. Ties break on insertion order and peer id so two runs with the
// same queue always produce the same teams.
export function balanceTeams(players = [], {random = Math.random} = {}) {
 const list = [...players].map((player, index) => ({
  ...player,
  order: Number.isFinite(Number(player?.order)) ? Number(player.order) : index,
  rating: Number.isFinite(Number(player?.rating)) ? Number(player.rating) : 0,
 }));
 list.sort((a, b) => b.rating - a.rating || a.order - b.order || String(a.peerId).localeCompare(String(b.peerId)));
 const teams = [[], []];
 list.forEach((player, index) => {
  const round = Math.floor(index / 2), seat = index % 2;
  teams[round % 2 === 0 ? seat : 1 - seat].push(player);
 });
 const sum = team => team.reduce((total, player) => total + player.rating, 0);
 const gap = () => Math.abs(sum(teams[0]) - sum(teams[1]));
 for (let pass = 0; pass < list.length; pass++) {
  let improved = false;
  for (let i = 0; i < teams[0].length; i++) {
   for (let j = 0; j < teams[1].length; j++) {
    const before = gap();
    const left = teams[0][i], right = teams[1][j];
    teams[0][i] = right; teams[1][j] = left;
    if (gap() < before) improved = true;
    else { teams[0][i] = left; teams[1][j] = right; }
   }
  }
  if (!improved) break;
 }
 return {
  teams,
  average: list.length ? Math.round((sum(teams[0]) + sum(teams[1])) / list.length) : 0,
  difference: gap(),
 };
}

// A lightweight, deterministic matchmaking queue. Entries carry a peer id, a
// display name and a rating; `draft()` pops the oldest `teamSize * 2` entries
// and balances them into two teams. No wall-clock reads, so tests are stable.
export class Matchmaker {
 constructor(options = {}) {
  this.random = options.random ?? Math.random;
  this.teamSize = Math.max(1, Math.min(8, Number(options.teamSize) || TEAM_SIZE));
  this.minPlayers = Math.max(2, Math.min(this.teamSize * 2, Number(options.minPlayers) || 2));
  this.max = Math.max(this.minPlayers, Number(options.max) || QUEUE_MAX);
  this.entries = [];
  this.sequence = 0;
 }
 enqueue(entry = {}) {
  const peerId = entry.peerId;
  if (peerId === undefined || peerId === null) return null;
  const existing = this.entries.find(item => item.peerId === peerId);
  if (existing) return existing;
  if (this.entries.length >= this.max) return null;
  const queued = {
   peerId,
   name: String(entry.name ?? '').slice(0, 24),
   rating: Number.isFinite(Number(entry.rating)) ? Number(entry.rating) : 0,
   order: this.sequence++,
   at: Number.isFinite(Number(entry.at)) ? Number(entry.at) : 0,
  };
  this.entries.push(queued);
  return queued;
 }
 remove(peerId) {
  const index = this.entries.findIndex(item => item.peerId === peerId);
  if (index < 0) return false;
  this.entries.splice(index, 1);
  return true;
 }
 has(peerId) { return this.entries.some(item => item.peerId === peerId); }
 size() { return this.entries.length; }
 position(peerId) { return this.entries.findIndex(item => item.peerId === peerId); }
 list() { return this.entries.map(({peerId, name, rating}) => ({peerId, name, rating})); }
 // Pop a full draft when enough players are waiting. Returns null otherwise.
 draft() {
  const size = Math.min(this.teamSize * 2, this.entries.length);
  if (size < this.minPlayers) return null;
  const players = this.entries.slice(0, size);
  this.entries = this.entries.slice(size);
  return {players, ...balanceTeams(players, {random: this.random})};
 }
}

export class RoomRegistry {
 constructor(options = {}) {
  this.random = options.random ?? Math.random;
  this.graceMs = options.graceMs;
  this.history = options.history ?? null;
  this.progression = options.progression ?? null;
  this.snapshotHz = options.snapshotHz;
  this.onError = options.onError ?? null;
  this.maxRooms = Math.max(2, Math.min(4096, Number(options.maxRooms) || 64));
  this.rooms = new Map();
  this.defaultRoom = this.add(new Room('local', this.random, { name: 'Local', graceMs: this.graceMs, history: this.history, progression: this.progression, snapshotHz: this.snapshotHz }));
 }
 add(room) {
  this.rooms.set(room.id, room);
  return room;
 }
 generateCode() {
  for (let attempt = 0; attempt < 100; attempt++) {
   let code = '';
   for (let i = 0; i < 4; i++) code += CODE_ALPHABET[Math.floor(this.random() * CODE_ALPHABET.length)];
   if (!this.rooms.has(code)) return code;
  }
  throw new Error('no room codes available');
 }
 create(name = '') {
  if (this.rooms.size >= this.maxRooms) {
   const idle = [...this.rooms.values()].find(room => room !== this.defaultRoom && room.peers.size === 0);
   if (!idle) return null;
   this.rooms.delete(idle.id);
  }
  const id = this.generateCode();
  const safeName = String(name ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 32) || id;
  return this.add(new Room(id, this.random, { name: safeName, graceMs: this.graceMs, history: this.history, progression: this.progression, snapshotHz: this.snapshotHz }));
 }
 get(roomId) {
  if (this.rooms.has(roomId)) return this.rooms.get(roomId);
  // Room codes are uppercase but the default room is lowercase `local`; accept a
  // case-insensitive match so typed or linked codes always resolve.
  const lower = String(roomId ?? '').toLowerCase();
  for (const [id, room] of this.rooms) if (id.toLowerCase() === lower) return room;
  return null;
 }
 has(roomId) { return this.rooms.has(roomId); }
 list() {
  return [...this.rooms.values()].map(r => r.summary());
 }
 tickAll(dt) {
  for (const room of this.rooms.values()) {
   try { room.tick(dt); }
   catch (error) { this.lastTickError = error; this.onError?.(error, room); }
  }
 }
 expireAll(now = Date.now()) {
  for (const room of this.rooms.values()) {
   try { room.expireGrace(now); }
   catch (error) { this.lastExpireError = error; this.onError?.(error, room); }
  }
  for (const room of [...this.rooms.values()]) this.removeIfEmpty(room);
 }
 drainAll() {
  const messages = [];
  for (const room of this.rooms.values()) messages.push(...room.drain());
  return messages;
 }
 removeIfEmpty(room) {
  if (room === this.defaultRoom || room.peers.size > 0) return false;
  this.rooms.delete(room.id);
  return true;
 }
}
