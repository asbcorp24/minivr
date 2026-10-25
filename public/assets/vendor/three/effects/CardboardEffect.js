import * as THREE from '../three.module.js';

/**
 * Mobile stereo effect adapted from the VREffect rendering architecture
 * used by blaineam/videojs-vr. It deliberately excludes the obsolete
 * navigator.getVRDisplays/WebVR presentation layer: MiniVR uses WebXR
 * separately for real headsets and this effect only handles phone Cardboard.
 */
export default class CardboardEffect {
  constructor(renderer) {
    this.renderer=renderer;
    this.cameraL=new THREE.PerspectiveCamera();
    this.cameraR=new THREE.PerspectiveCamera();
    this.cameraL.layers.enable(1);
    this.cameraR.layers.enable(2);
    this.eyeSeparation=.064;
  }
  render(scene,camera,stereo='mono') {
    const renderer=this.renderer;
    const size=renderer.getDrawingBufferSize(new THREE.Vector2());
    const half=Math.floor(size.x/2), aspect=half/size.y;
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.matrixWorld.decompose(this.cameraL.position,this.cameraL.quaternion,this.cameraL.scale);
    this.cameraR.position.copy(this.cameraL.position);
    this.cameraR.quaternion.copy(this.cameraL.quaternion);
    this.cameraR.scale.copy(this.cameraL.scale);
    const right=new THREE.Vector3(1,0,0).applyQuaternion(camera.quaternion);
    this.cameraL.position.addScaledVector(right,-this.eyeSeparation/2);
    this.cameraR.position.addScaledVector(right,this.eyeSeparation/2);
    for(const c of [this.cameraL,this.cameraR]) {
      c.fov=camera.fov;c.aspect=aspect;c.near=camera.near;c.far=camera.far;c.updateProjectionMatrix();
      c.layers.disableAll();c.layers.enable(0);
    }
    if(stereo==='mono'){this.cameraL.layers.enableAll();this.cameraR.layers.enableAll()}else{this.cameraL.layers.enable(0);this.cameraL.layers.enable(1);this.cameraR.layers.enable(0);this.cameraR.layers.enable(2)}
    renderer.setRenderTarget(null);
    renderer.setScissorTest(true);
    renderer.clear();
    renderer.setViewport(0,0,half,size.y);renderer.setScissor(0,0,half,size.y);renderer.render(scene,this.cameraL);
    renderer.setViewport(half,0,size.x-half,size.y);renderer.setScissor(half,0,size.x-half,size.y);renderer.render(scene,this.cameraR);
    renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);
  }
  centerRay(raycaster) {
    raycaster.setFromCamera(new THREE.Vector2(0,0),this.cameraL);
  }
}
