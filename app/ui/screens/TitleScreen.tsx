'use client';
import type {ScreenProps} from '../contract';
import {Btn,Chip} from '../primitives';

export function TitleScreen({ui}:ScreenProps){
 const {enterMenu,selectableMaps=[],CHARACTERS=[],HARNESSES=[],GAME_MODES=[],BRAND}=ui;
 return <div className="title-stage">
  <p className="eyebrow"><i/>SLOP PROTOCOL ONLINE</p>
  <h1 className="title-wordmark" aria-label={BRAND?.name||'COCS'}>COCS<span>.</span></h1>
  <p className="lede" style={{maxWidth:'48ch',margin:'0 auto'}}>{BRAND?.tagline}</p>
  <Btn variant="primary" size="lg" onClick={enterMenu} aria-label="Enter the arena">PRESS ANY KEY <small>or click to enter</small></Btn>
  <div className="row" style={{justifyContent:'center'}}>
   <Chip>{selectableMaps.length} ARENAS</Chip>
   <Chip>{CHARACTERS.length} OPERATORS</Chip>
   <Chip>{HARNESSES.length} HARNESSES</Chip>
   <Chip>{GAME_MODES.length} MODES</Chip>
  </div>
 </div>;
}
