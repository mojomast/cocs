// Shared prop bag passed from app/page.tsx (the runtime owner) into the new
// presentational screens under app/ui/screens. The page keeps all engine state
// and handlers; screens are pure render functions of this bag.
export type UiBag = Record<string, any>;
export interface ScreenProps { ui: UiBag }

// ---------------------------------------------------------------------------
// Ranked V2 online ladder shapes. The server attaches a `ranked` projection to
// every existing `lobby` message (no new wire type): the queue mode, the live
// match id, the last settlement and each seated peer's public ladder row.
// Ratings are server-authoritative; the client only renders them.
// ---------------------------------------------------------------------------
export interface RankedPlayerRow {
 rating: number;
 matches: number;
 peak: number;
 provisional: boolean;
}

export interface RankedSettlementEntry {
 peerId: number | string | null;
 playerId: string;
 name: string;
 team: number;
 win: boolean;
 placement: boolean;
 before: number;
 delta: number;
 rating: number;
}

export interface RankedSettlement {
 matchId: string;
 mode: string | null;
 entries: RankedSettlementEntry[];
}

export interface RankedLobby {
 queue: 'ranked' | 'unranked';
 active: boolean;
 matchId: string | null;
 settled: number;
 skipped: number;
 last?: RankedSettlement;
 players: Record<string, RankedPlayerRow>;
}
