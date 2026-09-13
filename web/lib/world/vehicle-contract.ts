/** Vehicles share the world's metre/Y-up, +Z-forward ground-origin convention. */
export const VEHICLE_KINDS = ["scooter", "skateboard"] as const;
export type VehicleKind = typeof VEHICLE_KINDS[number];
export const VEHICLE_MOUNT_DISTANCE = 2;
export const VEHICLE_CONFIG = {
  scooter: { maxSpeed: 7, acceleration: 6, braking: 10, radius: 0.9, height: 1.9 },
  skateboard: { maxSpeed: 6, acceleration: 4.8, braking: 8, radius: 0.5, height: 1.9 },
} as const satisfies Record<VehicleKind, { maxSpeed: number; acceleration: number; braking: number; radius: number; height: number }>;
