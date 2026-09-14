// Shared prop bag passed from app/page.tsx (the runtime owner) into the new
// presentational screens under app/ui/screens. The page keeps all engine state
// and handlers; screens are pure render functions of this bag.
export type UiBag = Record<string, any>;
export interface ScreenProps { ui: UiBag }
