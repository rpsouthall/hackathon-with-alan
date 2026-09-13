# Kyoto atmosphere

The town sits in a meadow surrounded by two layers of distant hills. A procedural sky adds a horizon gradient, drifting clouds, sun, moon and stars without downloading a sky texture. The sky never writes depth and the backdrop stays outside or beneath the existing playable geometry.

A full day lasts twelve minutes, starting at 14:00. Sun direction, shadow direction, hemisphere light, fog and moonlight update continuously. The shadow camera keeps a constant world-sized frustum independent of the player. Existing shop and street lights brighten after dusk. The Kyoto clock opens time presets, a slider and a pause/resume control. Presets ease over 2.4 seconds; scrubbing applies the selected time immediately. This clock controls local presentation only.

One instanced mesh draws 288 tumbling sakura petals around the eight exported cherry trees, excluding the pine. Petals fade by shrinking at flight boundaries and near shop interiors. They retain opaque depth testing to avoid transparency sorting flicker. Reduced-motion preferences start the clock paused, stop cloud drift and omit the falling petal layer; players can still choose a time explicitly.

`createWorldAtmosphere` owns the three visual layers and disposes them before the scene's general resource cleanup. Scene networking, geometry, collision and local shop cutaways remain authoritative through their existing systems.

Validation: time rollover, preset easing, immediate scrubbing, reduced motion, moving shadow-frustum coverage, night illumination, petal outdoor bounds/resource cleanup and sky depth/resource cleanup have automated coverage. Existing GLB depth and cutaway regressions pass. Browser checks cover isometric and third-person views, visible hills/clouds/petals, dusk/night and the time controls.
