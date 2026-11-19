import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {viewerTargetWithEmbed} from '../public/assets/embed-navigation.js';
import {shouldSwitchSceneInPlace} from '../public/assets/tour-navigation.js';

const origin='https://vr.example.test';
const token='deadbeef'.repeat(6);
const target=viewerTargetWithEmbed(new URL('/viewer.php?id=12&tour=7&scene=23',origin),origin,token);
assert.equal(target.searchParams.get('embed'),token);
assert.equal(target.searchParams.get('scene'),'23');
assert.equal(shouldSwitchSceneInPlace(target,origin,7,[{id:23,panorama_id:12}],'desktop'),true);
assert.equal(shouldSwitchSceneInPlace(target,origin,7,[{id:23,panorama_id:12}],'cardboard'),true);
assert.equal(shouldSwitchSceneInPlace(target,origin,7,[{id:23,panorama_id:12}],'webxr'),true);

const other=viewerTargetWithEmbed(new URL('https://another.test/viewer.php?id=12'),origin,token);
assert.equal(other.searchParams.has('embed'),false);
const home=viewerTargetWithEmbed(new URL('/',origin),origin,token);
assert.equal(home.searchParams.has('embed'),false);
assert.equal(viewerTargetWithEmbed(new URL('/viewer.php?id=12',origin),origin,'').searchParams.has('embed'),false);

const viewer=readFileSync(new URL('../public/assets/viewer.js',import.meta.url),'utf8');
assert.match(viewer,/viewerTargetWithEmbed\(new URL\(url,location\.href\),location\.origin,embedToken\)/,'All viewer navigation should preserve the embed token');
const page=readFileSync(new URL('../public/viewer.php',import.meta.url),'utf8');
assert.match(page,/embedAllowsScene\(/,'Every embedded scene request must check token scope');
assert.match(page,/frame-ancestors \*/,'Only embedded viewer should send framing permission');

console.log('Embeddable panorama and tour navigation tests passed');
