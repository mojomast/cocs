// Shareable multiplayer invite links. A link is the current page URL with a
// `?room=CODE` query parameter; opening it auto-connects and joins that room.
// Pure string/URL helpers so the parsing is unit-tested apart from the DOM.
export function normaliseRoomCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(code) ? code : null;
}

export function inviteLink(href, roomId) {
  const room = normaliseRoomCode(roomId);
  if (!room) return null;
  try {
    const url = new URL(String(href));
    url.searchParams.set('room', room);
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export function roomFromLocation(search) {
  const params = new URLSearchParams(String(search ?? ''));
  return normaliseRoomCode(params.get('room') || params.get('join') || '');
}
