import {CAMERA_RIGS} from './director.mjs';

export const CAMERA_MODES=['auto',...CAMERA_RIGS,'free'];

export const CAMERA_MODE_LABELS={
 auto:'Auto Cut',
 free:'Free Cam',
 orbit:'Orbit',
 chase:'Chase',
 dolly:'Dolly',
 crane:'Crane',
 tripod:'Tripod',
 follow:'Follow',
 firstperson:'First Person',
 flyover:'Flyover',
};

export function cycleCameraMode(current,dir=1){
 const n=CAMERA_MODES.length;
 const step=Math.round(Number.isFinite(dir)?dir:1)||1;
 const i=CAMERA_MODES.indexOf(current);
 const base=i<0?0:i;
 return CAMERA_MODES[((base+step)%n+n)%n];
}

export function cameraModeRig(mode){
 return CAMERA_RIGS.includes(mode)?mode:null;
}
