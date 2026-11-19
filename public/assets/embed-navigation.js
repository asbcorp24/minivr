// Carry a scoped viewer embed capability through in-place tour transitions.
// Never attach it to another origin or to ordinary site/admin pages.
export function viewerTargetWithEmbed(url,origin,token){
 const target=new URL(url);
 if(token&&target.origin===origin&&target.pathname==='/viewer.php'){
  target.searchParams.set('embed',token);
 }
 return target;
}
