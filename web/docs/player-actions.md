# Player emotes and sprint

Focus the world and press **G** for the emote wheel. Click **Wave**, **Bow**, **Cheer**, or **Nod**, or select with **1–4**. **Escape**, **G**, the center Close button, or the backdrop closes it. The wheel uses a native modal dialog with keyboard focus isolation. Closing or choosing a gesture returns focus to the world.

Hold either **Shift** key while using **WASD / arrows** to sprint. Walking is 3 m/s and sprinting is 5.5 m/s; diagonal input is normalized. Releasing Shift returns to walking. Blur, hidden tabs, dialogs and camera transitions clear held input. The on-screen directional controls also accept Shift-click.

All gestures are one-shot animations visible to everyone in the room. Moving cancels a gesture; conversations and vehicle riding prevent emotes. Bow and Wave use the original exported GLB clips. Cheer and Nod are generated over a copy of the idle clip using the existing rig, with grounded feet and unchanged assets. The renderer prioritizes an active gesture over residual movement interpolation.

The authority accepts only an emote name, assigns its ID and elapsed time, stops held movement, and expires the gesture. Repeated snapshots do not restart playback; late joins seek to the current gesture time. Sprint is a boolean input flag; the server computes speed and retains the same Rapier capsule/collision checks. Protocol **2** is required by browser and room server; restart both when upgrading from protocol 1.

Runtime: `player-actions.ts`, `player-input.ts`, `schema.ts`, `room.ts`, `scene.ts`, `emote-clips.ts`, `avatar.ts`, `emote-wheel.tsx`, and the viewport callbacks. No provider credentials or voice configuration are involved.

Verification covers authoritative speeds, stale inputs, forged commands, collision at sprint speed, emote expiry/cancellation and late joins using real WebSockets; actual GLB skeleton/foot poses, input releases, and browser wheel selection/focus behavior.
