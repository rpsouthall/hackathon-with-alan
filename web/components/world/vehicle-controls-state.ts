import type { PlayerSnapshot, VehicleSnapshot } from "../../lib/world/schema";

type Rider = Pick<PlayerSnapshot, "id" | "position" | "vehicleId">;
export type VehicleControlState = { mode: "available" | "riding"; vehicle: VehicleSnapshot };

/** The authority decides ownership; this selects only the contextual affordance. */
export function getVehicleControlState(player: Rider | undefined, vehicles: readonly VehicleSnapshot[], blocked = false): VehicleControlState | null {
  if (!player || blocked) return null;
  if (player.vehicleId) {
    const vehicle = vehicles.find((candidate) => candidate.id === player.vehicleId && candidate.riderId === player.id);
    return vehicle ? { mode: "riding", vehicle } : null;
  }
  let nearest: VehicleSnapshot | undefined;
  let nearestDistance = 2;
  for (const vehicle of vehicles) {
    if (vehicle.riderId !== null) continue;
    const distance = Math.hypot(...vehicle.position.map((value, axis) => value - player.position[axis]));
    if (distance <= nearestDistance && (!nearest || distance < nearestDistance || vehicle.id < nearest.id)) {
      nearest = vehicle;
      nearestDistance = distance;
    }
  }
  return nearest ? { mode: "available", vehicle: nearest } : null;
}

export function vehicleSpeedKmh(speed: number): number {
  return Number.isFinite(speed) ? Math.round(Math.abs(speed) * 3.6) : 0;
}
