# Live characters and walking

The city keeps Ryan's 3D cast. Opening a supported encounter uses its world NPC ID to select a live HeyGen appearance, role and ten-question lesson. Character names are applied to both lesson copy and the live voice prompt. The server resolves IDs from the allowlist in `lib/lesson/characters.ts`; clients cannot request an arbitrary paid avatar.

| Game character | Public LiveAvatar appearance | Practice |
| --- | --- | --- |
| Aoi | Rika Sitting | Coffee order |
| Haru | Wayne | Directions around town |
| Ren | Graham Sitting | Inn check-in |
| Yui | June HR | Fruit shopping |
| Sora | Thaddeus Sitting | Tea shopping |

Nao also has the coffee lesson, Koharu the restaurant lesson, and Kaede the tea lesson. Other residents retain their sample conversations and do not display a live-avatar badge. Appearance is separate from spoken language: the existing GPT-Live voice pipeline produces Japanese and accepts the learner's selected native language.

Avatar IDs and ACTIVE status were verified through the [official public avatar endpoint](https://docs.liveavatar.com/api-reference/avatar/list-public-avatars) on 2026-09-13. The selected public preview images are cached in `public/avatars`; they are previews, not live video. They do not establish the real actors' nationality. Provider account availability and credits still apply when a session starts.

## Walk closer

Select a resident and choose **Walk closer**. The client plans a pedestrian route against the exported collision boxes, including bridge ramps and door clearances. It sends the same movement commands as WASD; the room remains responsible for movement, collisions and talking distance. On arrival the button becomes **Start encounter** (or **Join encounter**). Walking alone never starts a paid avatar session.

Choose **Stop walking**, press a movement key, change the selected resident, or switch away from the browser window to cancel. A blocked or unavailable route reports a message and leaves manual walking available. The map covers the city's pedestrian ground and bridges, not rooftop navigation.

`tests/world/navigation.test.ts` follows routes to all five featured residents using the real room physics and verifies that each resulting encounter request passes the authority's distance check. Lesson tests check unique avatar assignments, matching character/scenario routing, and ten questions with multiple quiz types for every scenario.
