import * as THREE from '/assets/vendor/three/three.module.js';

function parseSTL(buffer){
 const view=new DataView(buffer),isBinary=buffer.byteLength>=84&&84+view.getUint32(80,true)*50===buffer.byteLength;
 const positions=[];
 if(isBinary){const n=view.getUint32(80,true);let o=84;for(let i=0;i<n;i++){o+=12;for(let j=0;j<3;j++){positions.push(view.getFloat32(o,true),view.getFloat32(o+4,true),view.getFloat32(o+8,true));o+=12;}o+=2;}}
 else{const text=new TextDecoder().decode(buffer);const re=/vertex\s+([-+\deE.]+)\s+([-+\deE.]+)\s+([-+\deE.]+)/gi;let m;while((m=re.exec(text)))positions.push(+m[1],+m[2],+m[3]);}
 if(!positions.length||positions.length%9)throw new Error('Некорректный STL');
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.computeVertexNormals();g.computeBoundingSphere();return g;
}
function parseGLB(buffer){
 const v=new DataView(buffer);if(v.getUint32(0,true)!==0x46546c67)throw new Error('Не GLB');let offset=12,json=null,bin=null;
 while(offset+8<=buffer.byteLength){const len=v.getUint32(offset,true),type=v.getUint32(offset+4,true);offset+=8;const chunk=buffer.slice(offset,offset+len);if(type===0x4e4f534a)json=JSON.parse(new TextDecoder().decode(chunk).replace(/\0+$/,' ').trim());else if(type===0x004e4942)bin=chunk;offset+=len;}
 if(!json||!bin)throw new Error('GLB без JSON/BIN');
 const component={5120:Int8Array,5121:Uint8Array,5122:Int16Array,5123:Uint16Array,5125:Uint32Array,5126:Float32Array},bytes={5120:1,5121:1,5122:2,5123:2,5125:4,5126:4},width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
 function accessor(i){const a=json.accessors[i],b=json.bufferViews[a.bufferView],Type=component[a.componentType],count=a.count*width[a.type],start=(b.byteOffset||0)+(a.byteOffset||0);return new Type(bin.slice(start,start+count*bytes[a.componentType]));}
 const materials=(json.materials||[]).map(m=>{const p=m.pbrMetallicRoughness||{},c=p.baseColorFactor||[.72,.78,.9,1];return new THREE.MeshStandardMaterial({color:new THREE.Color(c[0],c[1],c[2]),opacity:c[3],transparent:c[3]<1,metalness:p.metallicFactor??.15,roughness:p.roughnessFactor??.65,side:THREE.DoubleSide});});
 const root=new THREE.Group();
 for(const node of json.nodes||[]){if(node.mesh===undefined)continue;const meshDef=json.meshes[node.mesh];for(const prim of meshDef.primitives||[]){if(prim.attributes?.POSITION===undefined)continue;const g=new THREE.BufferGeometry();const pos=accessor(prim.attributes.POSITION);g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));if(prim.attributes.NORMAL!==undefined)g.setAttribute('normal',new THREE.BufferAttribute(new Float32Array(accessor(prim.attributes.NORMAL)),3));else g.computeVertexNormals();if(prim.attributes.TEXCOORD_0!==undefined)g.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(accessor(prim.attributes.TEXCOORD_0)),2));if(prim.indices!==undefined){const a=json.accessors[prim.indices],idx=accessor(prim.indices);g.setIndex(new THREE.BufferAttribute(new (component[a.componentType])(idx),1));}g.computeBoundingSphere();const mat=materials[prim.material]||new THREE.MeshStandardMaterial({color:0xb8c6df,metalness:.1,roughness:.7,side:THREE.DoubleSide});const mesh=new THREE.Mesh(g,mat);if(node.translation)mesh.position.fromArray(node.translation);if(node.rotation)mesh.quaternion.fromArray(node.rotation);if(node.scale)mesh.scale.fromArray(node.scale);root.add(mesh);}}
 if(!root.children.length)throw new Error('В GLB не найдены поддерживаемые mesh-примитивы');return root;
}
function styleModel(root,style){
 root.traverse(o=>{if(!o.isMesh)return;const old=o.material;const color=old.color?.clone()||new THREE.Color(0x9bdcff);let m;
 if(style==='wire')m=new THREE.MeshBasicMaterial({color,wireframe:true,transparent:true,opacity:.9});
 else if(style==='hologram')m=new THREE.MeshPhongMaterial({color:0x54dfff,emissive:0x087ba0,emissiveIntensity:1.2,transparent:true,opacity:.72,wireframe:false,side:THREE.DoubleSide});
 else if(style==='glass')m=new THREE.MeshPhysicalMaterial({color,metalness:.05,roughness:.08,transmission:.75,transparent:true,opacity:.72,thickness:.5,side:THREE.DoubleSide});
 else if(style==='glow')m=new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:1.5,metalness:.25,roughness:.35,side:THREE.DoubleSide});
 else m=new THREE.MeshStandardMaterial({color,metalness:.85,roughness:.22,side:THREE.DoubleSide});
 o.material=m;if(old!==m)old.dispose?.();
 });
}
export async function createPanorama3DObjects(scene,camera,items=[]){
 const anchor=new THREE.Group();anchor.name='MiniVR panorama 3D objects';anchor.layers.enableAll();scene.add(anchor);const entries=[];
 for(const item of items){try{const response=await fetch(item.url,{credentials:'same-origin'});if(!response.ok)throw new Error('HTTP '+response.status);const buffer=await response.arrayBuffer();const ext=(item.format||item.url.split('.').pop()).toLowerCase();const root=ext==='stl'?new THREE.Mesh(parseSTL(buffer),new THREE.MeshStandardMaterial({color:0xb9c8dc,metalness:.25,roughness:.55})):parseGLB(buffer);styleModel(root,item.style||'standard');const holder=new THREE.Group();holder.add(root);const box=new THREE.Box3().setFromObject(root),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());root.position.sub(center);const max=Math.max(size.x,size.y,size.z)||1;const scale=THREE.MathUtils.clamp(Number(item.scale)||1,.001,100)/max;holder.scale.setScalar(scale);holder.position.set(Number(item.x)||0,Number(item.y)||0,-Math.max(1,Number(item.distance)||24));holder.rotation.set(THREE.MathUtils.degToRad(Number(item.rotX)||0),THREE.MathUtils.degToRad(Number(item.rotY)||0),THREE.MathUtils.degToRad(Number(item.rotZ)||0));holder.visible=item.visible!==false;anchor.add(holder);entries.push({holder,item});}catch(error){console.warn('MiniVR 3D object load failed',item.name,error);}}
 let last=0;return {update(time){camera.getWorldPosition(anchor.position);camera.getWorldQuaternion(anchor.quaternion);const dt=last?Math.min(.05,(time-last)/1000):0;last=time;for(const e of entries){const i=e.item;if(i.spin){e.holder.rotation.x+=dt*(Number(i.spinX)||0);e.holder.rotation.y+=dt*(Number(i.spinY)||.35);e.holder.rotation.z+=dt*(Number(i.spinZ)||0);}}},dispose(){scene.remove(anchor);anchor.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material])){m.map?.dispose?.();m.dispose?.();}}});}};
}
