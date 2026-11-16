/** Gameplay tuning in one place. Tweak reads and writes CONFIG; DEFAULT_CONFIG stays immutable. */
export const DEFAULT_CONFIG = {
  move: {
    /** Walking speed while carrying boxes (m/s). */
    walk: 3.7,
    /** Pallet-jack speed (m/s). */
    jack: 3.3,
    /** Forklift speed (m/s). */
    fork: 4.0,
    /** How quickly speed follows the stick (higher = snappier). Original game: 14. */
    accel: 12,
    /** How quickly the worker turns to face the stick direction. Original game: 16. */
    turnWalk: 16,
    /** Pallet jack / forklift turn rate: heavier, so slower than walking. */
    turnVehicle: 12,
    /** Speed above which a vehicle hitting a rack costs a penalty. */
    bumpSpeed: 2.2,
  },
  camera: {
    fov: 30,
  },
} as const

// Gameplay always reads active values here. Source defaults remain immutable for
// Tweak Reset and Save with Manus; Apply never writes source or local storage.
type MutableConfig<T> = { -readonly [K in keyof T]: T[K] extends number ? number : T[K] extends object ? MutableConfig<T[K]> : T[K] }
export const CONFIG: MutableConfig<typeof DEFAULT_CONFIG> = structuredClone(DEFAULT_CONFIG)
