'use client';
import type {ScreenProps} from '../contract';
import {Btn,Chip} from '../primitives';

const LOGO=[{letter:'C',word:'COLOSSEUM'},{letter:'O',word:'OF'},{letter:'C',word:'COMPETITIVE'},{letter:'S',word:'SLOP'}];

export function TitleScreen({ui}:ScreenProps){
 const {enterMenu,selectableMaps=[],CHARACTERS=[],HARNESSES=[],GAME_MODES=[],BRAND}=ui;
 return <div className="title-stage">
  <p className="eyebrow title-eyebrow"><i/>SLOP PROTOCOL ONLINE</p>
  <h1 className="logo" aria-label={BRAND?.name||'COCS'}>
   {LOGO.map((part,index)=><span key={`${part.letter}-${index}`} className="logo-letter" style={{'--i':index} as any}>
    <span className="logo-glyph">{part.letter}<span className="logo-dot">.</span></span>
    <span className="logo-word">{part.word}</span>
   </span>)}
  </h1>
  <p className="lede title-tagline">{BRAND?.tagline}</p>
  <Btn variant="primary" size="lg" onClick={enterMenu} aria-label="Enter the arena">PRESS ANY KEY <small>or click to enter</small></Btn>
  <div className="row" style={{justifyContent:'center'}}>
   <Chip>{selectableMaps.length} ARENAS</Chip>
   <Chip>{CHARACTERS.length} OPERATORS</Chip>
   <Chip>{HARNESSES.length} HARNESSES</Chip>
   <Chip>{GAME_MODES.length} MODES</Chip>
  </div>
 </div>;
}
