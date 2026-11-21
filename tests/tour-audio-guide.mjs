import assert from 'node:assert/strict';
import { createTourAudioGuide, isTourAudioUrl } from '../public/assets/tour-audio-guide.js';

class FakeAudio extends EventTarget {
  constructor(src) { super(); this.src = src; this.paused = true; this.ended = false; }
  play() { this.paused = false; this.dispatchEvent(new Event('play')); return Promise.resolve(); }
  pause() { if (this.paused) return; this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() {}
  finish() { this.paused = true; this.ended = true; this.dispatchEvent(new Event('ended')); }
}

assert.equal(isTourAudioUrl('/uploads/guided-audio/a.mp3'), true);
assert.equal(isTourAudioUrl('https://example.org/music.mp3'), false);
assert.equal(isTourAudioUrl('/uploads/audio.mp3?x=1'), false);

const audios = [];
const duck = [];
let completed = 0;
const guide = createTourAudioGuide({
  createAudio(url) { const audio = new FakeAudio(url); audios.push(audio); return audio; },
  onVoiceChange(active) { duck.push(active); },
  onSceneEnded() { completed++; }
});

assert.equal(guide.setScene('/uploads/guided-audio/main.mp3'), true);
const main = audios[0];
assert.equal(main.paused, false);
assert.equal(guide.sceneFinished(), false);

let pointEnded = 0;
assert.equal(guide.playPoint('/uploads/guided-audio/point.ogg', () => pointEnded++), true);
const point = audios[1];
assert.equal(main.paused, true, 'scene narrator must pause for point voice');
assert.equal(point.paused, false);
point.finish();
assert.equal(pointEnded, 1);
assert.equal(main.paused, false, 'main narration resumes after point ends');

guide.setPaused(true);
assert.equal(main.paused, true, 'tour pause stops speech');
guide.setPaused(false);
assert.equal(main.paused, false, 'tour resume restores speech');

// Skipping a point stops its sound, even if the previous audio ends later.
let skippedPointEnded = 0;
guide.playPoint('/uploads/guided-audio/skip.mp3', () => skippedPointEnded++);
const skipped = audios[2];
guide.finishPoint();
assert.equal(skipped.paused, true);
assert.equal(main.paused, false);
skipped.finish();
assert.equal(skippedPointEnded, 0);

// Moving to a new scene disposes the old audio and ignores stale completion.
guide.setScene('/uploads/guided-audio/new.wav');
assert.equal(main.src, '');
assert.equal(main.paused, true);
main.finish();
assert.equal(completed, 0);
assert.equal(audios[3].paused, false);
audios[3].finish();
assert.equal(completed, 1);
assert.equal(guide.sceneFinished(), true);

guide.stop();
assert.equal(audios[3].src, '');
assert.equal(duck.at(-1), false, 'music unducks when speech stops');

console.log('Scene narration pauses for guided points, resumes, and stops between scenes');
