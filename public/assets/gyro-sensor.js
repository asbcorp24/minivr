// Detect tablet orientation sensors before enabling Three.js camera controls.
// The permission request is made synchronously within the button's click path
// (before the first await), as required by iOS Safari.
export const GYRO_SAMPLE_TIMEOUT_MS = 6000;

export function validGyroSample(event) {
  return Number.isFinite(event?.alpha) && Number.isFinite(event?.beta) && Number.isFinite(event?.gamma);
}

/**
 * @param {Window} host Browser window; supplied explicitly for device tests.
 * @param {{timeoutMs?:number,signal?:AbortSignal}} options
 * @returns {Promise<{status:string,event?:Event,source?:string}>}
 */
export async function requestGyroSample(host, { timeoutMs = GYRO_SAMPLE_TIMEOUT_MS, signal } = {}) {
  if (!host.isSecureContext) return { status: 'insecure' };
  if (!host.DeviceOrientationEvent) return { status: 'unsupported' };
  if (signal?.aborted) return { status: 'cancelled' };

  try {
    const sensor = host.DeviceOrientationEvent;
    if (typeof sensor.requestPermission === 'function') {
      const permission = await sensor.requestPermission();
      if (signal?.aborted) return { status: 'cancelled' };
      if (permission !== 'granted') return { status: 'denied' };
    }
  } catch (error) {
    return { status: 'permission-error', errorName: error?.name || 'Error' };
  }

  if (signal?.aborted) return { status: 'cancelled' };

  return new Promise(resolve => {
    let settled = false;
    let eventSeen = false;
    let timer;
    const cleanup = () => {
      host.removeEventListener('deviceorientation', onSample);
      host.removeEventListener('deviceorientationabsolute', onSample);
      signal?.removeEventListener('abort', onAbort);
      clearTimeout(timer);
    };
    const finish = result => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(result);
    };
    const onSample = event => {
      eventSeen = true;
      if (validGyroSample(event)) finish({ status: 'ready', event, source: event.type });
    };
    const onAbort = () => finish({ status: 'cancelled' });
    host.addEventListener('deviceorientation', onSample);
    host.addEventListener('deviceorientationabsolute', onSample);
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => finish({ status: eventSeen ? 'invalid-data' : 'no-events' }), timeoutMs);
    if (signal?.aborted) onAbort();
  });
}
