// Tour scene changes stay in the same document so camera/device modes, the
// fullscreen element and any live WebXR session are not lost on navigation.
export function shouldSwitchSceneInPlace(target,origin,tourId,scenes,mode){
 if(target.origin!==origin||target.pathname!=='/viewer.php')return false;
 if(mode==='cardboard'||mode==='webxr')return true;
 if(!tourId||Number(target.searchParams.get('tour'))!==tourId)return false;
 const sceneId=Number(target.searchParams.get('scene'));
 const panoramaId=Number(target.searchParams.get('id'));
 return sceneId>0&&panoramaId>0&&scenes.some(scene=>
  Number(scene.id)===sceneId&&Number(scene.panorama_id)===panoramaId);
}
