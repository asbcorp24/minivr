// Only explicitly saved geographic coordinates may become real map markers.
export function tourScenePoint(scene){
 if(scene?.geo_lat===null||scene?.geo_lat===undefined||scene?.geo_lat===''||scene?.geo_lng===null||scene?.geo_lng===undefined||scene?.geo_lng==='')return null;
 const lat=Number(scene.geo_lat),lng=Number(scene.geo_lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat< -90||lat>90||lng< -180||lng>180)return null;
 return {lat,lng};
}

// Official OSM export iframe: interactive real-world map, with one selected marker.
export function tourMapEmbedUrl(point){
 const {lat,lng}=point;
 const bounds=[Math.max(-180,lng-.012),Math.max(-90,lat-.006),Math.min(180,lng+.012),Math.min(90,lat+.006)];
 const query=new URLSearchParams({bbox:bounds.join(','),layer:'mapnik',marker:lat+','+lng});
 return 'https://www.openstreetmap.org/export/embed.html?'+query;
}

export function tourMapExternalUrl(point){
 const {lat,lng}=point;
 return 'https://www.openstreetmap.org/?'+new URLSearchParams({mlat:String(lat),mlon:String(lng)})+'#map=16/'+lat+'/'+lng;
}
