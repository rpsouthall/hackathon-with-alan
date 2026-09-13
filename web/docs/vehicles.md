# Vehicles

Find the scooters and skateboards parked around the city. Walk within two metres of an unoccupied vehicle and press **F**, or tap **Ride scooter / Ride skateboard**. Press **F** again or tap **Dismount** to return to walking.

Use **WASD** or the arrow keys to ride in the camera-relative direction. Riding accelerates gradually; releasing movement slows the vehicle. The compact riding prompt shows the server-reported speed in km/h. Touch users can use the existing directional controls and the vehicle button.

**V** still changes the camera. **E** starts nearby conversations after dismounting; **G** opens emotes while on foot; **T** remains push-to-talk. Vehicle controls disappear during encounters, dialogs and the emote wheel. Shift continues to sprint on foot; riding speed is controlled by the authority.

## Integration

`WorldViewport` reads `snapshot.vehicles` from the existing `WorldProvider`; its optional `vehicles` prop supports an explicit override. Each scene update includes the vehicle snapshots. Scene callbacks `onMountVehicle(vehicleId)` and `onDismountVehicle()` send `mount-vehicle` and `dismount-vehicle` commands through the world store. The existing movement packet is unchanged.

`PlayerInput.keyDown()` returns `vehicle` for a non-repeated F press. Text inputs, composition and browser shortcuts are ignored. The scene chooses the nearest available vehicle within two metres, or dismounts its current rider. Availability and speed are authoritative; the UI does not predict ownership or acceleration.

Vehicle UI styles live in `components/world/vehicle-controls.module.css`, independent of the shared HUD styles. The context control uses a 44px minimum button target, a keyboard shortcut label, a visible focus outline and safe-area spacing. Speed changes do not repeatedly announce through a live region.

## Verification

`tests/world/vehicle-input.test.ts` covers F press/repeat behavior, text-input and modifier protection, preserved V/G/E/T actions, nearest available selection, the two-metre boundary, occupied vehicles, modal blocking, riding state and speed display. Browser review should cover all six parked vehicles, both ride types, gradual acceleration and braking, wall collisions, safe dismounting, another player taking a vehicle, and touch controls. Backend/physics tests cover authority behavior separately.

Validated on 2026-09-13: all six real Kyoto parking positions mount and dismount with Rapier; both vehicles accelerate to their own caps and brake; wall and ledge blocking; ownership races; release on disconnect; late-joining WebSocket clients; actual GLB wheel pivots/scale; scooter hand contact across 1.5/1.7/1.9m avatars; skateboard stance; and restoration of the walking rig. The full existing world suite passed 128 tests, followed by two additional asset/pose tests. TypeScript and targeted ESLint passed.

Three scooters and three skateboards are shared per room. Their parked locations persist for the lifetime of that in-memory room. This first version uses ground movement and conservative capsule collision; it does not include jumps, tricks, traffic AI, vehicle damage, or persistence across server restarts.
