# Shared character runtime

`avatar.ts` adapts the finished Komorebi character workshop to this application's
single Three.js installation. The shared kit has seven animation clips and all
hair/outfit/accessory choices. Do not load it as a bare scene: overlapping
alternatives need the adapter's visibility setup.

Load one `loadAvatarTemplate()` promise per scene runtime. Share its resolved GLTF
between every `createAvatar(template, appearance)` call. Each avatar owns cloned
bones, materials, facial morph values and an animation mixer; template geometry
and textures stay shared. On cleanup, dispose every avatar, then call
`disposeAvatarTemplate(template)`. Also dispose a template that resolves after its
owning scene has already unmounted.

`object.position` is the world-space foot position, measured in metres with Y up
and +Z forward. The adapter never moves that root. Apply authoritative positions
and pass actual velocity to `setVelocity()` for walking/running animation. Use
`play("Listen")` during encounters and `play("Talk")` only when real speech plays.
Drive `setSpeechLevel(0..1)` from real output audio; the runtime does not simulate
a live voice connection. Wave and Bow support `{ once: true }`.

`CHARACTER_PRESETS` contains all 15 city residents from the workshop's stable
`kyoto_city_cast.json` export. Each entry separates `id`, `name`, and `role` from
validated `appearance` cosmetics. The shared server schema accepts only those
cosmetics for player customization. `preview.ts` supplies the editor's isolated
Three.js viewer without changing room state.

The runtime tests parse the actual packaged GLB and verify all 15 residents'
heights, independent materials/skeletons/morphs, standing ground contact, gait
ground contact, gesture interruption and resource disposal. Run
`node --import tsx --test tests/world/avatar.test.ts` from `web/`.
