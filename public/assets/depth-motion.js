// The depth-window effect runs in the normal viewer. With GYRO enabled it is
// opt-in: only an active phone 3D sensor may translate the camera.
export function canTranslateDepthCamera(mode, gyroActive, phone3DActive, viewDragging=false){
 // Rotating a 360° panorama must not translate the viewpoint at the same time.
 // Keep normal pointer/phone 3D motion as soon as the rotation drag ends.
 return mode==='desktop'&&!viewDragging&&(!gyroActive||phone3DActive);
}

// Preserve the original yaw-only desktop translation. GYRO supplies a full
// camera quaternion, so phone-relative left/up/forward follow its view.
export function depthOffsetInWorld(local, gyroActive, cameraQuaternion, yaw, target){
 if(gyroActive)return target.copy(local).applyQuaternion(cameraQuaternion);
 const cos=Math.cos(yaw),sin=Math.sin(yaw);
 return target.set(local.x*cos-local.z*sin,local.y,local.x*sin+local.z*cos);
}
