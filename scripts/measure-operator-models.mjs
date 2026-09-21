// CPU geometry accounting only. No renderer, browser or benchmark load.
import {pathToFileURL} from 'node:url';
import {robotModel,ArenaView} from '../game/view.mjs';
import {CHARACTERS} from '../game/data.mjs';
import {ModelAssets} from '../game/effects-fx.mjs';
import {OPERATOR_MODEL_BUDGETS} from '../game/models.mjs';
import {modelCost,selectModelLOD} from './measure-lattice-models.mjs';

export function measureOperatorModels(){
 const assets=new ModelAssets(),models=[];
 const operators=CHARACTERS.map(({id})=>{
  const model=robotModel(id,assets),software=robotModel(id,assets,true);models.push(model,software);
  const near=modelCost(model);selectModelLOD(model,{distance:50,detail:0});
  return {id,design:model.userData.operatorIdentity.design,near,far:modelCost(model),software:modelCost(software)};
 });
 const cacheBytes=[...assets.geometries.values()].reduce((sum,g)=>sum+Object.values(g.attributes).reduce((s,a)=>s+a.array.byteLength,0)+(g.index?.array.byteLength??0),0);
 for(const model of models)ArenaView.prototype.disposeObject.call({sharedResources:assets.resources},model);
 assets.dispose();
 return {method:'CPU submissions without culling; neutral operators with pulse weapon, no shield/flash. Far: 50m with detail=0. Software: native LOD pinned low, detail fully enabled. Shadow passes excluded.',budgets:OPERATOR_MODEL_BUDGETS,operators,cacheBytes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)console.log(JSON.stringify(measureOperatorModels(),null,2));
