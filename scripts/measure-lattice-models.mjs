// CPU scene-assembly accounting, not a GPU/FPS benchmark. Run from repo root:
// node scripts/measure-lattice-models.mjs
import * as T from 'three';
import {pathToFileURL} from 'node:url';
import {ArenaView,robotModel,weaponModel,simpleWeaponModel} from '../game/view.mjs';
import {CHARACTERS,WEAPONS} from '../game/data.mjs';
import {ModelAssets} from '../game/effects-fx.mjs';
import {applyActorTeam} from '../game/team-presentation.mjs';

export function modelCost(model){
 const result={drawObjects:0,vertices:0,triangles:0,meshObjects:0};
 model.traverse(n=>{if(n.isMesh)result.meshObjects++;});
 model.traverseVisible(n=>{if(!n.isMesh)return;result.drawObjects++;result.vertices+=n.geometry.attributes.position.count;result.triangles+=(n.geometry.index?.count??n.geometry.attributes.position.count)/3;});
 return result;
}

export function selectModelLOD(model,{distance=0,detail=1}={}){
 const camera=new T.PerspectiveCamera();camera.position.copy(model.position).add(new T.Vector3(0,1,-distance));camera.updateMatrixWorld();model.updateMatrixWorld(true);
 for(const lod of model.userData.modelLOD?.levels||[])if(lod.autoUpdate)lod.update(camera);
 ArenaView.prototype._setModelDetail.call({qualitySettings:{lodDistance:46}},model,detail,distance);
}

export function measureLatticeModels(){
 const assets=new ModelAssets(),models=[],make=m=>{models.push(m);return m;};
 const operators=CHARACTERS.map(c=>{
  const m=make(robotModel(c.id,assets)),near=modelCost(m);selectModelLOD(m,{distance:50});const distantHigh=modelCost(m);selectModelLOD(m,{distance:50,detail:0});
  return {id:c.id,near,distantHigh,distantLow:modelCost(m)};
 });
 const weapons=WEAPONS.map((w,type)=>({name:w.name,type,detailed:modelCost(make(weaponModel(type,assets))),world:modelCost(make(simpleWeaponModel(type,assets)))}));
 const roster=new T.Group();
 for(let i=0;i<32;i++){const m=make(robotModel(CHARACTERS[i%CHARACTERS.length].id,assets));applyActorTeam(m,i%2);roster.add(m);}
 const scene32={near:modelCost(roster)};
 for(const m of roster.children)selectModelLOD(m,{distance:50});scene32.distantHigh=modelCost(roster);
 for(const m of roster.children)selectModelLOD(m,{distance:50,detail:0});scene32.distantLow=modelCost(roster);
 roster.children.forEach((m,i)=>selectModelLOD(m,{distance:i<8?5:50,detail:i<8?1:0}));scene32.eightNear24Far=modelCost(roster);
 const cache={geometries:assets.geometries.size,materials:assets.materials.size,bytes:[...assets.geometries.values()].reduce((sum,g)=>sum+Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(g.index?.array.byteLength??0),0)};
 const disposer={sharedResources:assets.resources};for(const m of models)ArenaView.prototype.disposeObject.call(disposer,m);assets.dispose();
 return {method:'Visible geometry submissions, no frustum/occlusion culling; neutral operators include held pulse; 32-actor roster includes team marks/outline. Flash/shield inactive. Shadow/postprocessing passes excluded.',operators,weapons,scene32,cache};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(measureLatticeModels(),null,2));
