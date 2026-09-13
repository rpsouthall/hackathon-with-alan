"use client";

import type { VehicleControlState } from "./vehicle-controls-state";
import { vehicleSpeedKmh } from "./vehicle-controls-state";
import styles from "./vehicle-controls.module.css";

export function VehicleControls({ state, onMount, onDismount }: {
  state: VehicleControlState | null;
  onMount: (vehicleId: string) => void;
  onDismount: () => void;
}) {
  if (!state) return null;
  const riding = state.mode === "riding";
  const kind = state.vehicle.kind === "scooter" ? "scooter" : "skateboard";
  const speed = vehicleSpeedKmh(state.vehicle.speed);
  return <div className={styles.controls} role="group" aria-label="Vehicle controls" data-riding={riding}>
    {riding && <div className={styles.rideInfo}>
      <span className={styles.kind}>Riding {kind}</span>
      <span className={styles.speed} aria-label={`Speed ${speed} kilometres per hour`}>{speed}<small aria-hidden="true">km/h</small></span>
    </div>}
    <button type="button" className={styles.action} aria-keyshortcuts="F"
      aria-label={riding ? `Dismount ${kind}` : `Ride ${kind}`}
      onClick={() => riding ? onDismount() : onMount(state.vehicle.id)}>
      <kbd aria-hidden="true">F</kbd>{riding ? "Dismount" : `Ride ${kind}`}
    </button>
    {riding && <span className={styles.hint}>WASD · release to slow</span>}
  </div>;
}
