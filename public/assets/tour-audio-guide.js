/** One scene narration and one guided-point voice, never played simultaneously. */
export function isTourAudioUrl(url) {
  return typeof url === 'string' && /^\/uploads\/[a-zA-Z0-9_./-]+\.(?:mp3|ogg|wav)$/i.test(url);
}

export function createTourAudioGuide({
  createAudio = url => new Audio(url),
  onVoiceChange = () => {},
  onSceneEnded = () => {},
  onAutoplayBlocked = () => {}
} = {}) {
  let scene = null;
  let point = null;
  let sceneEnded = true;
  let paused = false;
  let lastVoiceState = false;

  const playing = audio => !!audio && !audio.paused && !audio.ended;
  const syncVoice = () => {
    const active = playing(scene) || playing(point);
    if (active !== lastVoiceState) {
      lastVoiceState = active;
      onVoiceChange(active);
    }
  };
  const discard = audio => {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  };
  const attachState = audio => {
    for (const event of ['play', 'pause', 'ended', 'error']) audio.addEventListener(event, syncVoice);
  };
  const start = (audio, role) => {
    if (!audio || paused) return;
    try {
      const promise = audio.play();
      promise?.catch?.(() => {
        if ((role === 'scene' && audio === scene) || (role === 'point' && audio === point)) {
          onAutoplayBlocked(role);
          syncVoice();
        }
      });
    } catch (_) {
      onAutoplayBlocked(role);
    }
  };

  function stop() {
    const previousScene = scene;
    const previousPoint = point;
    scene = null;
    point = null;
    sceneEnded = true;
    discard(previousPoint);
    discard(previousScene);
    syncVoice();
  }

  function setScene(url) {
    stop();
    if (!isTourAudioUrl(url)) return false;
    sceneEnded = false;
    scene = createAudio(url);
    scene.preload = 'metadata';
    const current = scene;
    attachState(current);
    current.addEventListener('ended', () => {
      if (scene !== current) return;
      sceneEnded = true;
      onSceneEnded();
    });
    current.addEventListener('error', () => {
      if (scene !== current) return;
      sceneEnded = true;
      onSceneEnded();
    });
    start(current, 'scene');
    return true;
  }

  function finishPoint({ resumeScene = true } = {}) {
    const previous = point;
    point = null;
    discard(previous);
    if (resumeScene && scene && !sceneEnded && !paused) start(scene, 'scene');
    syncVoice();
  }

  function playPoint(url, onEnded = () => {}) {
    finishPoint({ resumeScene: false });
    if (!isTourAudioUrl(url)) {
      if (scene && !sceneEnded && !paused) start(scene, 'scene');
      return false;
    }
    if (scene && !sceneEnded) scene.pause();
    point = createAudio(url);
    point.preload = 'auto';
    const current = point;
    attachState(current);
    const complete = () => {
      if (point !== current) return;
      finishPoint();
      onEnded();
    };
    current.addEventListener('ended', complete, { once: true });
    current.addEventListener('error', complete, { once: true });
    start(current, 'point');
    return true;
  }

  function setPaused(value) {
    paused = !!value;
    if (paused) {
      point?.pause();
      scene?.pause();
    } else {
      if (point) start(point, 'point');
      else if (scene && !sceneEnded) start(scene, 'scene');
    }
    syncVoice();
  }

  function retryCurrent() {
    if (paused) return;
    if (point) start(point, 'point');
    else if (scene && !sceneEnded) start(scene, 'scene');
  }

  function toggleScene() {
    if (!scene || sceneEnded || point || paused) return false;
    if (playing(scene)) scene.pause();
    else start(scene, 'scene');
    return true;
  }

  return {
    stop, setScene, playPoint, finishPoint, setPaused, retryCurrent, toggleScene,
    hasScene: () => !!scene,
    sceneFinished: () => sceneEnded,
    pointActive: () => !!point,
    scenePlaying: () => playing(scene)
  };
}
