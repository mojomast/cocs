// Shareable multiplayer invite links. A link is the current page URL with a
// `?room=CODE` query parameter; opening it auto-connects and joins that room.
// Pure string/URL helpers so the parsing is unit-tested apart from the DOM.
export function normaliseRoomCode(value) {
  const raw = String(value ?? '').trim();
  if (!/^[A-Za-z0-9]{2,8}$/.test(raw)) return null;
  // The default room is lowercase `local` on the server; codes are uppercase.
  return raw.toLowerCase() === 'local' ? 'local' : raw.toUpperCase();
}

export function inviteLink(href, roomId, {spectate = false} = {}) {
  const room = normaliseRoomCode(roomId);
  if (!room) return null;
  try {
    const url = new URL(String(href));
    url.searchParams.set('room', room);
    if (spectate) url.searchParams.set('spectate', '1');
    else url.searchParams.delete('spectate');
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function spectateFromLocation(search) {
  const params = new URLSearchParams(String(search ?? ''));
  return params.get('spectate') === '1' || params.get('watch') === '1';
}

export function roomFromLocation(search) {
  const params = new URLSearchParams(String(search ?? ''));
  return normaliseRoomCode(params.get('room') || params.get('join') || '');
}
