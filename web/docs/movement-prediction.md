# Local movement and reconciliation

The browser renders its own walking, sprinting, and riding at 60 Hz using the same Rapier controller and collision manifest as the room. Keyboard changes take effect on the next rendered frame. Commands are sent at no more than 40 Hz, with a 20 Hz refresh while held. Local frame input is recorded independently, so that network ceiling does not delay the local character. Other players retain interpolated authority positions.

The server continues to validate directions and derive speeds; clients cannot submit positions. Protocol 3 adds `player.movementAck` containing the last simulated input sequence, the duration processed for that input, and vertical velocity. The browser restores that authority pose and replays subsequent input in its own monotonic time. This does not rely on matching client/server wall clocks.

Small corrections ease visually, unless the eased capsule would overlap a wall. Teleports and mount/dismount changes clear prediction history. Prediction freezes after 750 ms without an authority update and keeps at most two seconds / 512 samples and command markers, so network loss cannot create unlimited local travel. Input also expires after 300 ms as it does on the authority.

`tests/world/movement-prediction.test.ts` checks first-frame walking, key release, simulated 200 ms and variable one-second round trips, reconciliation at a collision wall, sprinting, stale connections, respawn, riding, and encounter/modal blocking. `tests/world/movement-input.test.ts` checks the send ceiling during camera orbit at 60, 120, 144, and 240 Hz, plus queued key release. These are deterministic simulation checks, not a claim about any player's actual network latency. The HUD separately reports measured socket round-trip time.
