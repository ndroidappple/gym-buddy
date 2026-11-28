# UX audit: GymBuddy, 2026-11-28 (quick: Nutrition → Trends)

- **Commit:** `b67479a` → see the commit "UX polish (quick): Trends scorecard" that follows it
- **Platform / environments:** web, Chromium, 390 and 1280, light and dark (quick matrix); three data shapes: sparse (5 of 25 days logged, 2 weigh-ins, Nick's real shape), full (25 of 28, 10 weigh-ins), partial-only (2 days, both under 45% of the calorie goal)
- **Reviewers:** ux-reviewer ✗ · interaction-reviewer ✗ · design-qa ✗. Quick mode: the review and QA were done by the main session and aren't independent.

## 1. Executive verdict
Useful and usable: the scorecard answers "how's my eating going and is it working" in one screen, with every tile one tap from its detail. Trust had two gaps in thin-data states (unexplained dashes) and the charts broke on wider screens; both fixed. Identity holds (Lexend heavy numerals, plate-free neutral data colors, flat cards per the brief's elevation rule).

## 2. Coverage
| Item | Count |
|---|---:|
| Screens reviewed | 7 / 7 (scorecard, calories, protein, weight, logging, carbs & fat, empty state by code) |
| Modals and sheets reviewed | 0 / 0 |
| Journeys run | J-Trends: scorecard → tile → back (covered by e2e) |
| Findings: P0 / P1 / P2 | 0 / 4 / 1 |
| WCAG failures | 0 |

Alcohol detail not captured (needs wellness data); reviewed from code only.

## 3. Design identity
| Adjective (from brief) | Evident | Evidence |
|---|---|---|
| Glanceable, not sparse | evident | four equal tiles, number + goal + chart + status, all above the tab bar |
| Honest, not preachy | partly → evident | thin-data states now say why there's no number |
| Bold, not loud | evident | color only on off-goal bars and status pills |

## 5. Findings (complete list)
| ID | Pri | Tag | Location | Problem | Fix | Effort | Status |
|---|---|---|---|---|---|---|---|
| T-01 | P1 | usability / trust | Scorecard, Calories & Protein details | With only partly logged days, tiles show "–" and "No full days yet" with no reason; the Calories lead reads "0 on goal · 0 over · 0 under" | One quiet line under the grid explains the 45% rule and when averages start; detail leads say "no full days yet, so no average" instead of an empty tally | S | fixed |
| T-02 | P1 | usability | Weight detail | Under 3 weigh-ins the lead is a bare "–", though the tile already shows the latest weight | Lead with the latest weigh-in and what a trend needs ("3+ over 10+ days") | S | fixed |
| T-03 | P1 | platform guideline (44pt) | Period picker, every Trends screen | Select was 34px tall | Select fills a 44pt tap area; the 34pt pill is drawn behind it, unchanged | S | fixed |
| T-04 | P1 | visual | Scorecard tiles at 1280 (and wide phones) | Small charts drew at a fixed 150px and sat centered in wider tiles | Charts measure their box (ResizeObserver) and draw at its width | S | fixed |
| T-05 | P2 | copy | Protein detail, week by week | "hit 0 of 1 days" | "hit 0 of 1 day" | S | fixed |

### Acceptance criteria
- T-01: partial-only capture shows the explanation under the grid; Calories detail lead has no "0 on goal · 0 over · 0 under". ✓ `after/partial-390-dark-*`
- T-02: sparse Weight detail leads "200.6 lb, latest weigh-in, Nov 25". ✓ `after/sparse-390-light-nutrition_trends_weight.png`
- T-03: layout audit reports no target under 44px on any Trends screen. ✓ `audit-after.json`
- T-04: at 1280 the tile charts span the tile's inner width. ✓ `after/sparse-1280-*-nutrition_trends.png`
- T-05: protein week rows pluralize. ✓ from code

## Needs your call
- **N-1: The Calories tile's status on a cut when you're well under.** On a cut, under isn't flagged, so the tile says "1 of 5 days on goal" while averaging 400 under. Recommendation: keep it. The goal says under is fine, and the gap is one tap away. The alternative wins if you want the tile to nudge you to eat closer to target (useful against under-eating on a long cut): then show "400 under goal" as plain text.
- **N-2: Space under the scorecard on tall phones** (~150pt on an iPhone 15 Pro). Recommendation: leave it. The screen's job is the at-a-glance read, and filler would dilute it. The alternative wins if you find yourself opening the same detail every time (e.g. Calories); then preview that detail's chart there.

## 6. Accessibility and interaction test results
- Layout audit (390/1280, light/dark, 3 data shapes, 28 captures): no horizontal overflow, no clipped text, no console errors; targets all ≥ 44px after T-03.
- e2e: scorecard fits above the tab bar, equal tile heights, drill in and back; swipe back from a detail.
- Unverified: 200% text (not in the quick matrix), VoiceOver reading order.

## Can't know without real users
Whether the scorecard gets opened at all, and how often, once the week in review already covers the same ground on Sundays.
