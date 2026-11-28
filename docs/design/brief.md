# Design brief: GymBuddy

_Last updated: 2026-11-28 · Status: **assumed (unconfirmed)**. Drafted by the UX polish pass from the README, the code and the
shipped screens. Nick: confirm or edit the adjectives and exceptions; everything below the line follows from them._

The UX polish skill reads this file at the start of every run. Edit it whenever the direction changes.

## Product
- **Purpose:** tell one lifter what to do next (this set, this meal, this week) from their own numbers, and log it with almost no typing.
- **Primary users:** a lifter on a 4-day split, using it 4–5 times a week in the gym and 3–5 times a day for food.
- **Secondary users:** none in-app. AI assistants read the log (read-only) through MCP/REST.
- **Platforms:** web app added to the iPhone home screen (iOS 16.4+ for lock-screen alerts). Desktop works but isn't the target.

## Contexts of use
| Where / when | Their state | Design implication |
|---|---|---|
| Between sets, gym floor | sweaty, one hand, 60–150 s of rest, bad wifi, bright or dim light | one obvious next action, huge numbers, 44pt+ targets, no typing, offline-first |
| Kitchen / desk, logging food | two hands, a minute to spare | fast search, repeat yesterday, plain-English entry |
| Sunday couch, week in review | relaxed, curious | story pacing, personality allowed |
| Before a workout | deciding what to do today | today's day, what to beat, one Start button |

## Core journeys
| # | Journey | Start → goal | Success looks like |
|---|---|---|---|
| J1 | Log a workout | Today → Start → log every set → Finish → recap | every set one tap from the pre-fill; the coach's next-set call is readable at a glance |
| J2 | Log a meal | Today/Nutrition → Add food → search or describe → add | a repeat meal in ≤ 2 taps; a new one in one sentence |
| J3 | Check progress on a lift | Progress → lift → e1RM chart and PRs | can answer "am I getting stronger?" in one look |
| J4 | First run | sign-in → name → head coach → setup → first workout | first set logged in under 3 minutes, no required question that only some people need |
| J5 | Change the program | Settings → Program → day → add/swap/reorder | change made without breaking history |
| J6 | Week in review | notification/Today chip → story cards | read in under a minute, ends with one thing to do |

## Emotional target
Between sets: *"I know exactly what to do next."* After a workout: *"That counted."*

## Design adjectives (assumed)
1. **Tough, not mean.** The coaches push; the UI never shames a missed day.
2. **Playful, not childish.** Cartoon crew and chunky shapes, but the numbers are adult and exact.
3. **Glanceable, not sparse.** One big answer per card, readable at arm's length mid-set.
4. **Honest, not preachy.** Code does the math, guesses are labeled, nothing changes without Apply.
5. **Bold, not loud.** Heavy type and plate colours where they mean something; quiet everywhere else.

## Direction profile
**Playful, expressive × Energetic, motivational.** Character system and chunky stylized depth from the first; heavy numerals,
saturated plate colours and a dark-first gym palette from the second.

## Brand assets
| Asset | Value | Notes |
|---|---|---|
| Day colours | IWF plates: Push `#FF5E57`, Pull `#4C8DFF`, Legs `#FFC53D`, Shoulders `#2EC27E` | identify the day only; never good/bad |
| Performance signals | ▲/▼, "PR" stamp, PR gold `#FFB23E` | shape + text, not colour alone |
| Neutrals | Chalk (light) `#F5F2ED` warm; Iron (dark) `#121117` violet-tinted | dark is the default theme |
| Display + text font | Lexend 400–800, tabular figures everywhere | one family; weight does the hierarchy |
| Icons | lucide-react, 2px stroke | rounded caps match Lexend |
| Mascots | six SVG coaches (Tank, Wings, Boulder, Piston, Brick, Dash), one per training area | each with own colour, body shape, idle and voice |
| Voice | "tough, warm gym coach. Direct, a little funny, never preachy. Short sentences." | from `api/coach.js` |
| Type scale | 11 · 12.5 · 13.5 · 15 · 16 · 18 · 20 · 24 · 26, display 28+ per screen | enforced by `npm run test:type` |

## Signature elements
1. **The lip:** a flat, hard offset shadow (`0 5px 0 var(--lip)`) under chunky cards and buttons, like a plate's rim. Hero card, primary buttons, tab bar.
2. **Plate-coloured day cards:** the hero card on Today and each session wears its day's plate colour.
3. **The coach crew:** a cartoon coach speaks for each lift, the head coach for the plan.

## Exceptions to the default rules
| Rule broken | What we do instead | Why |
|---|---|---|
| "Neutral content colours" | each workout day has its own saturated plate hue | lets you tell days apart across the calendar and history; always paired with the day's name |
| "Soft shadows, elevation earned" (Nick #6) | hard flat offset "lip" instead of blurred shadows | it's the tough/plate signature. Still earned: hero card, primary/floating actions, tab bar. Not on secondary list cards (see audit 2026-11-28) |
| "Text scales with the system setting" | type is px from a fixed scale; pinch-zoom is allowed instead (double-tap zoom is off) | a precise, chunky layout; pinch is the floor for WCAG 1.4.4. Following the iOS text size is proposal P-11 |
| Text on plate colours | always Iron ink (`--on-<day>`), never white | white measured 2.3–3.4:1 on the plates (audit 2026-11-28) |

## Benchmarks
| App | Convention worth keeping | Where we deliberately differ |
|---|---|---|
| Strong | set table with last time's numbers, one tap to complete a set, auto rest timer | a coach tells you the *next* set instead of leaving you to work it out |
| Hevy | free, social, routines folder | no social feed; personal coaching instead |
| MacroFactor | targets-first food dashboard, fast repeat logging, adaptive targets | plain-English logging itemized by the coach; food lives next to training |

## Out of bounds
- Colour meaning good/bad on day colours.
- Guilt mechanics (streak loss shaming, red "missed" days).
- The model inventing numbers: every number shown is computed in code.
- Coaches changing anything without an Apply tap.
