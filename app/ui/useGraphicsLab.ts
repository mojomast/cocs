'use client';
import {useEffect,useState,type RefObject} from 'react';
import {GRAPHICS_LAB_KEY,defaultGraphicsLab,normalizeGraphicsLab,serializeGraphicsLab} from '../../game/graphics-lab.mjs';

export type GraphicsLabSettings=ReturnType<typeof normalizeGraphicsLab>;
type GraphicsRuntime={view?:{setGraphicsLab:(value:GraphicsLabSettings)=>void;renderer?:{isSoftware?:boolean;isWebGLRenderer?:boolean}}}|null;
// A saved recipe always wins, including an all-off RESET ALL / OFF. An absent,
// empty or unreadable save hydrates to the shipped default look instead; a
// literal "null" save is treated as empty rather than as an all-off recipe.
function hydrateGraphicsLab(stored:string|null){
 try{
  const parsed=stored===null?null:JSON.parse(stored);
  return parsed===null||parsed===undefined?defaultGraphicsLab():normalizeGraphicsLab(parsed);
 }catch{return defaultGraphicsLab();}
}
// Hydrate browser storage after SSR, and report external renderer/storage status.
/* eslint-disable react-hooks/set-state-in-effect */
export function useGraphicsLab(runtime:RefObject<GraphicsRuntime>,ready:boolean){
 const [value,setValue]=useState(()=>defaultGraphicsLab());
 const [loaded,setLoaded]=useState(false);
 const [supported,setSupported]=useState<boolean|null>(null);
 const [storageNotice,setStorageNotice]=useState('');
 useEffect(()=>{
  let stored:string|null=null;
  try{stored=localStorage.getItem(GRAPHICS_LAB_KEY);}catch{}
  setValue(hydrateGraphicsLab(stored));
  setLoaded(true);
 },[]);
 useEffect(()=>{
  if(!loaded)return;
  runtime.current?.view?.setGraphicsLab(value);
   if(ready)setSupported(runtime.current?.view?.renderer?.isWebGLRenderer===true);
  try{localStorage.setItem(GRAPHICS_LAB_KEY,serializeGraphicsLab(value));setStorageNotice('');}
  catch{setStorageNotice('Browser storage unavailable; this mix lasts for this visit.');}
 },[value,ready,loaded,runtime]);
  const update=(next:GraphicsLabSettings|((current:GraphicsLabSettings)=>GraphicsLabSettings))=>setValue(current=>normalizeGraphicsLab(typeof next==='function'?next(current):next));
 return {value,update,supported,storageNotice};
}
/* eslint-enable react-hooks/set-state-in-effect */
