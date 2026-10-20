import { isCardio } from "../data/program.js";
import { liftSeries, isIsolation, daysBetween, today } from "./util.js";

/* The lifts that get a page in Progress's top card, after bodyweight. The lifter picks them (pinned
   from the card's Edit sheet or a lift's page, saved as prefs.chartLifts); until then it's the AUTO
   lifts trained most in the last RECENT_DAYS, compounds first since they say more. */
export const MAX_CHART_LIFTS = 8;
const AUTO = 3, RECENT_DAYS = 56;

export function autoChartLifts(sessions) {
  const names = new Set(sessions.flatMap((s) => Object.keys(s.sets)).filter((n) => !isCardio(n)));
  return [...names].map((n) => {
    const series = liftSeries(sessions, n);
    return { n, iso: isIsolation(n), total: series.length, recent: series.filter((x) => daysBetween(x.date, today()) <= RECENT_DAYS).length };
  }).filter((r) => r.total > 1)
    .sort((a, b) => a.iso - b.iso || b.recent - a.recent || b.total - a.total)
    .slice(0, AUTO).map((r) => r.n);
}

/** The chart's lifts, in page order. null in prefs means not picked yet. */
export const chartLifts = (prefs, sessions) => prefs?.chartLifts ?? autoChartLifts(sessions);

/** Pins or unpins one lift: the new list, or null when it's already full. */
export function toggleChartLift(list, n) {
  if (list.includes(n)) return list.filter((x) => x !== n);
  return list.length < MAX_CHART_LIFTS ? [...list, n] : null;
}
