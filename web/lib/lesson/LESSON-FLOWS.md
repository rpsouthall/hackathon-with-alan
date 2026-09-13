# Guided English-to-Japanese encounters

## World mapping

| Environment | NPC | Stable world ID | Lesson ID | Goal |
| --- | --- | --- | --- | --- |
| Coffee shop | Aoi | `cafe_owner` | `coffee` | Order coffee and pay |
| Neighbourhood walk | Haru | `local_guide` | `directions` | Ask for and confirm a route |
| Inn | Ren | `inn_host` | `inn` | Check in and ask about the stay |
| Fruit market | Yui | `market_produce` | `market` | Choose fruit and understand the price |
| Tea stall | Sora | `market_tea` | `tea` | Sample tea and choose a gift |
| Restaurant | Koharu | `restaurant_momiji_host` | `restaurant` | Request a table, order and pay |

`characters.ts` is the allowlist for the live cast, appearance IDs and lesson identity. `world-lessons.ts` resolves world NPC IDs to lesson template IDs. Some old template NPC IDs are retained for `/lesson-lab` compatibility; do not interpret the restaurant template's legacy `local_guide` ID as the city guide's scenario. Pass `worldNpcId` into `LessonDialogue` to preserve the real character's name and avatar. Nao also uses coffee practice; Kaede uses tea practice. Preserve Ryan's geometry and spawn positions.

## Entry and exit

1. The player reaches the venue's NPC. The authoritative world accepts an `interact` request (the existing nearby E/Start encounter interaction).
2. Resolve `lessonNpcForWorldNpc(activeEncounter.npcId)` and the allowlisted character, then open its dialogue screen. A venue can later have an entrance trigger that requests the same encounter, provided server membership/proximity checks still pass.
3. Show the NPC/avatar, location, ten-step progress, and a single current question. Never start three paid avatar sessions during exploration.
4. The player answers in English, selects a quiz option, or tries Japanese. Voice input and typed input should feed the same current question; switching input mode must not advance or reset the lesson.
5. Show feedback before Next. Incorrect quiz answers remain retryable on the same question. Retry should not count another completed question. Record one final result per question, with attempts separately.
6. After the tenth reviewed question, show the phrases practised and actual lesson completion. Distinguish “reviewed” from “correct”; do not label a completed example as verified proficiency.
7. Leaving dialogue, losing encounter membership, or disconnecting stops media and cancels pending work. Responses from an old encounter must not appear in a new one.

The character picker provides a Walk closer action that follows collision-aware routes. Starting an accepted encounter opens its lesson and live avatar. Other residents retain sample dialogue until authored lessons are added.

## Instruction and feedback policy

- The agent stays in its venue role and speaks short, approachable Japanese. Explain corrections in English and show a natural Japanese equivalent.
- English is an accepted learning input. A correct English answer means the player understood the task; offer the Japanese form rather than calling the English response a mistake.
- Correct actual errors, not harmless alternative wording. Model answers are examples, not exact-match grading rules.
- Preserve quantities, negation, tense, and politeness. Explain one useful change at a time, invite a retry, then continue.
- On a wrong multiple-choice answer, show the reason and the correct concept. Do not advance automatically.
- Each quiz has one correct choice. Do not include a correct English translation as an incorrect distractor beside the same Japanese answer. Spoken or typed English is still accepted during conversation practice.
- A comprehension answer and a natural NPC reply may differ: “The menu” is the answer to the menu quiz; ありがとうございます is the Japanese phrase to practise afterward. Do not grade comprehension against `modelAnswer`.
- `meaning` translates the NPC's question. `answerMeaning` translates `modelAnswer`. Feedback must use the latter beside the corrected Japanese.
- Provide the optional romaji `reading` for model answers. Always retain Japanese text.
- The fixed scenario supplies menu/pricing facts. Stay consistent: one market peach costs 300 yen; two cost 600 yen.
- Avoid pronunciation scores from typed answers. If no speech assessment is connected, say so.

## Ten steps per location

| # | Coffee shop | Fruit market | Restaurant |
| --- | --- | --- | --- |
| 1 | Say you are alone | Ask for fruit | Request a table for two |
| 2 | Recognize the menu | Ask for a recommendation | Understand a reservation question |
| 3 | Order one coffee | Identify seasonal peaches | Request the menu |
| 4 | Choose iced coffee | Ask the price per peach | Ask for a recommended dish |
| 5 | Complete a size request | Understand 300 yen each | Understand the set-meal contents |
| 6 | Request no milk | Complete an order for two | Complete a meal order |
| 7 | Politely decline cake | Request ripe fruit for today | Ask for water |
| 8 | Confirm the order | Decline a bag politely | Ask for slow repetition |
| 9 | Ask about card payment | Understand the 600-yen total | Ask for the bill |
| 10 | Thank the barista | Thank the vendor | Thank the host for the meal |

## Manual acceptance examples

- Coffee/drink: “One coffee please” → accept intent; teach コーヒーを一杯お願いします. Do not mark English as wrong.
- Coffee/milk: “Milk please” → correction must explain that the task requires *without* milk; show ミルクなしでお願いします.
- Market/quantity: choose 二人 → explain that it counts people; retry with 二個.
- Market/price-check: choose 300 yen → accept; retain price per fruit, not the total.
- Market/total: choose 600 yen → accept; explain two at 300 each.
- Restaurant/table: 二人です → accept the natural shortened answer; do not demand the full example.
- Restaurant/order: choose お願いします → accept; show the full Japanese meal order.
- Restaurant/repeat: choose 早くして → explain that it asks someone to hurry; offer a slow-repeat request.
- Pause at question 5 then retry → stay at 5; advance once only when the learner selects Next.
- Change from coffee to market → begin the market flow, without coffee audio or feedback arriving afterward.

Content checks: `node --import tsx --test tests/lesson/scenarios.test.ts` from `web/`.
