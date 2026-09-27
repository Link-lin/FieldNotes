/**
 * Easing for the globe camera, like a map app: zoom glides toward its target, and a released
 * drag keeps turning and slows to a stop. Times in ms, angles in degrees.
 */
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 4;
/** Time constant of the zoom glide: most of the way there in about 0.3 s, settled in about 0.6 s. */
const ZOOM_TAU = 110;
/** Time constant of the spin after a drag: coasts for about a second. */
const SPIN_TAU = 330;
/** Below this speed (degrees per ms) the spin stops. */
const SPIN_STOP = 0.003;

export type Motion = { rot: [number, number]; zoom: number; target: number; vel: [number, number] };

export const clampZoom = (z: number) => Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
export const clampLat = (v: number) => Math.max(-80, Math.min(80, v));

/** Advances one frame of `dt` ms. Returns true while anything is still moving. */
export function glide(m: Motion, dt: number, dragging: boolean): boolean {
  let moving = false;
  const dz = m.target - m.zoom;
  if (Math.abs(dz) > 0.0005 * m.target) {
    m.zoom += dz * (1 - Math.exp(-dt / ZOOM_TAU));
    moving = true;
  } else m.zoom = m.target;
  if (!dragging) {
    if (Math.hypot(m.vel[0], m.vel[1]) > SPIN_STOP) {
      m.rot = [m.rot[0] + m.vel[0] * dt, clampLat(m.rot[1] + m.vel[1] * dt)];
      const f = Math.exp(-dt / SPIN_TAU);
      m.vel = [m.vel[0] * f, m.vel[1] * f];
      moving = true;
    } else m.vel = [0, 0];
  }
  return moving;
}
