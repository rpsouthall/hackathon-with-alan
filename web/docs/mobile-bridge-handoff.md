# Mobile controls and bridge traversal

Based on main at 885634a, preserving the submission and avatar lesson updates.

- Time controls move to the upper-right corner on desktop and upper-left on compact/touch layouts, clear of Lessons.
- Direction buttons are 48px press-and-hold controls. Multiple contacts combine into diagonals. Release, pointer cancellation, lost capture, window blur, hidden document, disabled input, and unmount clear the corresponding input. Movement uses the existing per-frame local prediction and throttled network path.
- Compact HUD hides the player roster and keyboard hints, shortens the lesson control, and separates movement, camera, voice, and contextual actions. Portrait, landscape, and safe-area positioning are supported.
- Touch devices cap rendering resolution at 1.25 DPR instead of 1.75 to reduce pixel work; desktop rendering quality is unchanged.
- Vehicle support probes account for footprint height changes on walkable slopes. The center probe retains the original step/drop limits and Rapier still handles walls, rails, and slopes. Both scooters and skateboards cross both exported bridges in either direction.

## Verification

217 world tests passed, including eight bridge traversal cases and held-input state regressions. TypeScript and production build passed. ESLint has zero errors and two pre-existing unused-variable warnings in lesson/difficulty.ts. Local Worker integration passed all 14 checks (32-client load test: zero protocol/schema errors). Browser layout reviewed at 390×844, 844×390, and 1280×800. Physical iOS/Android touch and frame-rate testing remains a device smoke check; desktop viewport testing does not emulate phone performance.

## Alan's release

Update and deploy **both the website and the multiplayer Worker from the merged main revision**. They import the same lib/world/physics.ts. Deploying only the website leaves multiplayer authority with the old bridge restriction. Use the existing deployment configuration and secrets; this change adds no secrets, schema changes, room migration, or new service.

After deployment, refresh two clients, mount either vehicle, and cross the arched bridge in both directions. On a phone, hold an arrow for several seconds, release outside the button, and confirm movement stops; test diagonals and switching apps during a hold. Verify the time menu and Lessons open independently.

No live website or Cloudflare deployment was performed for this GitHub handoff.
