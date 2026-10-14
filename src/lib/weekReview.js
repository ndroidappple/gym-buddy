import { activeDays, baseOf, isWarmup } from "../data/program.js";
import { COACHES, COACH_ORDER, coachFor, headCoach } from "../data/coaches.js";
import { GOALS as TRAIN_GOALS } from "./setup.js";
import { GOALS as FOOD_GOALS, MEALS, addDays, totals, isAlcoholic } from "./nutrition.js";
import { PHASE_TYPES, phaseStatus } from "./phase.js";
import { lifting, volume, bestE1rm, bestSet, cardioTotals, liftSeries, trend, bodyweightSeries, readyToIncrease, byDateAsc, fmtW, num, plural, iso } from "./util.js";

/* The week in review. Everything here is plain functions over the account data, shared by the app
   (when to offer a review, drawing its cards) and api/review.js (the facts the coach agent reads,
   the tools it digs with, and the review written by code when no model answers). The numbers are
   all worked out here: the agent interprets them and never does the arithmetic. */

export const REVIEW_PREFIX = "week-review:";
export const reviewKey = (weekEnd) => REVIEW_PREFIX + weekEnd;
/** A week's review can be written this many times (the first, then updates after new logs). */
export const MAX_GENERATIONS = 3;
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The lifter's review settings: on by default, out Sundays at 10 AM, with a notification. */
export const reviewPrefs = (prefs) => ({ on: true, day: 0, hour: 10, notify: true, ...prefs?.weekReview });

const weekday = (d) => new Date(d + "T12:00:00").getDay();
export const weekWindow = (weekEnd) => ({ start: addDays(weekEnd, -6), end: weekEnd });
const within = (d, w) => !!d && d >= w.start && d <= w.end;

/**
 * The latest review that's out at `now`: { date, weekEnd, at }. It comes out on the review day at
 * the review hour and covers the 7 full days before that day (Sunday's covers Sunday to Saturday),
 * so every day in it is complete when it's written. `at` is when it came out (ms).
 */
export function latestReview(r, now = new Date()) {
  const today = iso(now);
  let date = addDays(today, -((weekday(today) - r.day + 7) % 7));
  if (date === today && now.getHours() < r.hour) date = addDays(date, -7);
  const at = new Date(`${date}T${String(r.hour).padStart(2, "0")}:00:00`).getTime();
  return { date, weekEnd: addDays(date, -1), at };
}

/** "10 AM", "12 PM", "6 PM". */
export const hourLabel = (h) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;
/** "Sunday at 10 AM". */
export const whenLabel = (r) => `${WEEKDAYS[r.day]} at ${hourLabel(r.hour)}`;
/** The days a review covers, by name: "Sunday to Saturday". */
export const coversLabel = (r) => `${WEEKDAYS[r.day]} to ${WEEKDAYS[(r.day + 6) % 7]}`;

/** "Oct 5 – 11", or "Sep 28 – Oct 4" across a month. */
export function rangeLabel(weekEnd) {
  const { start } = weekWindow(weekEnd);
  const a = new Date(start + "T12:00:00"), b = new Date(weekEnd + "T12:00:00");
  const m = (d) => d.toLocaleDateString("en-US", { month: "short" });
  return a.getMonth() === b.getMonth() ? `${m(a)} ${a.getDate()} – ${b.getDate()}` : `${m(a)} ${a.getDate()} – ${m(b)} ${b.getDate()}`;
}

/** What's been logged in the week, as a short string. A review whose fingerprint differs from the
    phone's can be updated with what's new (a forgotten Saturday dinner logged on Sunday). */
export function fingerprint({ sessions = [], weighins = [], food = null }, weekEnd) {
  const w = weekWindow(weekEnd);
  const n = (xs) => xs.filter((x) => within(x.date, w)).length;
  return `${n(sessions)}.${n(weighins)}.${food ? n(food) : 0}`;
}

/** Anything logged in the week: a week with nothing in it gets no review. */
export const hasActivity = ({ sessions = [], food = null }, weekEnd) => {
  const w = weekWindow(weekEnd);
  return sessions.some((s) => within(s.date, w)) || (food || []).some((e) => within(e.date, w));
};

/**
 * Whether Today offers a review: { weekEnd, glow } or null. Offered from the moment it's out until
 * it's opened (glowing), then without the glow for the rest of the day it was opened.
 */
export function reviewState({ prefs, now = new Date(), sessions = [], food = null }) {
  const r = reviewPrefs(prefs);
  if (!r.on) return null;
  const { weekEnd } = latestReview(r, now);
  const opened = r.opened === weekEnd;
  if (opened && r.openedOn !== iso(now)) return null;
  if (!hasActivity({ sessions, food }, weekEnd)) return null;
  return { weekEnd, glow: !opened };
}

const r1 = (x) => Math.round(x * 10) / 10;
const avg = (xs) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : null);
const pct = (a, b) => (b ? r1(((a - b) / b) * 100) : null);
const hourIn = (ms, tz) => {
  try { return +new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz || undefined }).format(ms) % 24; } catch { return new Date(ms).getHours(); }
};
const sessionMins = (s) => {
  const m = s.startedAt && s.finishedAt ? Math.round((s.finishedAt - s.startedAt) / 60000) : null;
  return m != null && m >= 5 && m <= 240 ? m : null;
};

/** Sets, volume and cardio for the sessions in a window, with working sets per coach's area. */
function weekTraining(sorted, w) {
  const sessions = sorted.filter((s) => within(s.date, w));
  let sets = 0, vol = 0, min = 0, mi = 0;
  const groups = {};
  for (const s of sessions) {
    for (const [n, xs] of Object.entries(s.sets || {})) {
      const l = lifting(xs);
      if (l.length) {
        sets += l.length;
        vol += volume(l);
        const g = coachFor(baseOf(n));
        groups[g] = (groups[g] || 0) + l.length;
      }
      const c = cardioTotals(xs);
      min += c.min; mi += c.mi;
    }
  }
  // The training goal is days a week: two workouts on one day still make one training day.
  return { sessions, count: sessions.length, days: new Set(sessions.map((s) => s.date)).size, sets, volume: Math.round(vol), cardioMin: Math.round(min), cardioMi: r1(mi), groups };
}

/** Daily food totals for a window, over the days with anything logged. */
function weekFood(food, w) {
  const by = {};
  for (const e of food) if (within(e.date, w)) (by[e.date] ||= []).push(e);
  const days = Object.keys(by).sort().map((d) => ({ date: d, ...totals(by[d]) }));
  return { logged: days.length, avgKcal: avg(days.map((d) => d.kcal)), avgProtein: avg(days.map((d) => d.protein)) };
}

/** lb/week from a least-squares line through the points (null when there's too little to say). */
function slope(points) {
  if (points.length < 3) return null;
  const t0 = new Date(points[0].date + "T12:00:00").getTime();
  const xs = points.map((p) => (new Date(p.date + "T12:00:00").getTime() - t0) / 864e5);
  if (xs[xs.length - 1] < 10) return null;
  const mx = avg(xs), my = avg(points.map((p) => p.bw));
  const num_ = xs.reduce((a, x, i) => a + (x - mx) * (points[i].bw - my), 0);
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  return den ? r1((num_ / den) * 7 * 10) / 10 : null;
}

/**
 * The week's facts: every number the review shows or reasons from.
 * `food` is the food log (entries) when nutrition tracking is on, covering at least 8 weeks back;
 * `tz` is the lifter's time zone (the server runs in UTC).
 */
export function buildWeekFacts({ sessions = [], program, weighins = [], prefs = {}, food = null, weekEnd, tz }) {
  const w = weekWindow(weekEnd);
  const back = (k) => weekWindow(addDays(weekEnd, -7 * k));
  const dates = Array.from({ length: 7 }, (_, i) => addDays(w.start, i));
  const sorted = sessions.filter((s) => s.date <= w.end).sort(byDateAsc);
  const weighs = weighins.filter((x) => x.date <= w.end);
  const nut = prefs.nutrition?.on && prefs.nutrition.targets && food ? prefs.nutrition : null;
  const foodUpTo = nut ? food.filter((e) => e.date <= w.end) : null;
  const plan = {};
  activeDays(program).forEach((d) => program[d].exercises.forEach((e) => { plan[e.n] ||= e; }));
  const target = prefs.profile?.days || activeDays(program).length || null;
  const bwAll = bodyweightSeries(sorted, weighs);

  /* Eight weeks, oldest first: the trends. */
  const weeks = Array.from({ length: 8 }, (_, i) => 7 - i).map((k) => {
    const ww = back(k), t = weekTraining(sorted, ww), f = nut ? weekFood(foodUpTo, ww) : null;
    const bw = bwAll.filter((p) => within(p.date, ww)).map((p) => p.bw);
    return {
      start: ww.start, end: ww.end, sessions: t.count, days: t.days, sets: t.sets, volume: t.volume, cardioMin: t.cardioMin,
      logged: f ? f.logged : null, avgKcal: f?.logged ? Math.round(f.avgKcal) : null, avgProtein: f?.logged ? Math.round(f.avgProtein) : null,
      bw: bw.length ? r1(avg(bw)) : null,
    };
  });
  const history = weeks.slice(0, 7).filter((x) => x.sessions || x.logged || x.bw != null).length;

  /* ── Training ── */
  const cur = weekTraining(sorted, w), prev = weekTraining(sorted, back(1));
  const prior4 = [1, 2, 3, 4].map((k) => weekTraining(sorted, back(k))).filter((x) => x.count > 0);
  const groups = COACH_ORDER.filter((id) => id !== "dash").map((id) => ({
    id, name: COACHES[id].group, sets: cur.groups[id] || 0, prev: prev.groups[id] || 0,
    avg4: prior4.length ? r1(avg(prior4.map((x) => x.groups[id] || 0))) : null,
  })).filter((g) => g.sets || g.prev || g.avg4);

  const prs = {}, downs = [], skippedCount = {};
  const sessionsOut = cur.sessions.map((s) => {
    const lifts = Object.keys(s.sets || {}).filter((n) => lifting(s.sets[n]).length);
    const earlier = sorted.filter((x) => byDateAsc(x, s) < 0);
    let records = 0;
    for (const n of lifts) {
      const now = bestE1rm(s.sets[n]);
      const best = Math.max(0, ...earlier.map((x) => bestE1rm(x.sets?.[n] || [])));
      if (best > 0 && now > best) {
        records++;
        const b = bestSet(s.sets[n]);
        if (!prs[n] || now > prs[n].e1rm) prs[n] = { lift: n, date: s.date, set: `${fmtW(b.w)}×${b.r}`, e1rm: r1(now), from: r1(best), pct: pct(now, best), coach: coachFor(baseOf(n)) };
      }
      const last = [...earlier].reverse().find((x) => lifting(x.sets?.[n]).length);
      const was = last && bestE1rm(last.sets[n]);
      if (was && now < was * 0.95) downs.push({ lift: n, date: s.date, e1rm: r1(now), was: r1(was), pct: pct(now, was), coach: coachFor(baseOf(n)) });
    }
    const swapped = new Set(Object.keys(s.swaps || {}));
    const skipped = (program[s.day]?.exercises || []).map((e) => e.n).filter((n) => !isWarmup(n) && !s.sets?.[n]?.length && !swapped.has(n));
    skipped.forEach((n) => { skippedCount[n] = (skippedCount[n] || 0) + 1; });
    return {
      date: s.date, weekday: WEEKDAYS[weekday(s.date)], day: s.day, name: program[s.day]?.name || (s.day === "custom" ? "Custom" : s.day),
      mins: sessionMins(s), startHour: s.startedAt ? hourIn(s.startedAt, tz) : null, sets: lifts.reduce((a, n) => a + lifting(s.sets[n]).length, 0),
      volume: Math.round(lifts.reduce((a, n) => a + volume(s.sets[n]), 0)), records, skipped,
    };
  });

  const trainedLifts = [...new Set(cur.sessions.flatMap((s) => Object.keys(s.sets || {}).filter((n) => lifting(s.sets[n]).length)))];
  const lifts = trainedLifts.map((n) => {
    const series = liftSeries(sorted, n);
    const now = Math.max(...series.filter((p) => within(p.date, w)).map((p) => p.orm));
    const then = series.filter((p) => p.date < w.start && p.date >= addDays(w.start, -28)).map((p) => p.orm);
    const recent = series.filter((p) => p.date >= addDays(w.end, -41)).map((p) => p.orm);
    const t = recent.length >= 4 ? trend(recent) : null;
    return { lift: n, coach: coachFor(baseOf(n)), sessions: series.length, e1rm: r1(now), change4: then.length ? pct(now, Math.max(...then)) : null, trend6: t == null ? null : r1(t) };
  });
  const ready = trainedLifts.map((n) => {
    const last = [...cur.sessions].reverse().find((s) => lifting(s.sets?.[n]).length);
    const up = readyToIncrease(plan[n], lifting(last.sets[n]));
    return up && { lift: n, from: up.from, to: up.to, coach: coachFor(baseOf(n)) };
  }).filter(Boolean);
  const rirs = cur.sessions.flatMap((s) => Object.values(s.sets || {}).flatMap((xs) => lifting(xs).filter((x) => x.rir != null).map((x) => +x.rir)));
  let streak = 0;
  if (target) for (let k = 0; k < 12 && weekTraining(sorted, back(k)).days >= target; k++) streak++;
  const prior4Sessions = prior4.flatMap((x) => x.sessions);
  const hours = (xs) => xs.filter((s) => s.startedAt).map((s) => hourIn(s.startedAt, tz));
  const mins = (xs) => xs.map(sessionMins).filter((m) => m != null);

  const training = {
    target, days: cur.days, prevDays: prev.days, count: cur.count, prevCount: prev.count, sets: cur.sets, prevSets: prev.sets, volume: cur.volume, prevVolume: prev.volume,
    avg4Sets: prior4.length ? Math.round(avg(prior4.map((x) => x.sets))) : null,
    cardioMin: cur.cardioMin, cardioMi: cur.cardioMi, prevCardioMin: prev.cardioMin,
    sessions: sessionsOut, groups, prs: Object.values(prs).sort((a, b) => b.pct - a.pct), downs: downs.sort((a, b) => a.pct - b.pct).slice(0, 4),
    skipped: Object.entries(skippedCount).map(([lift, times]) => ({ lift, times })).sort((a, b) => b.times - a.times).slice(0, 5),
    lifts: lifts.sort((a, b) => (b.change4 ?? -99) - (a.change4 ?? -99)),
    risers: lifts.filter((l) => l.change4 != null && l.change4 >= 2.5).slice(0, 3),
    stalls: lifts.filter((l) => l.trend6 != null && l.trend6 <= 0.5 && l.sessions >= 4).slice(0, 3),
    ready, avgRir: rirs.length ? r1(avg(rirs)) : null, streak,
    avgMins: mins(cur.sessions).length ? Math.round(avg(mins(cur.sessions))) : null,
    prevAvgMins: mins(prior4Sessions).length ? Math.round(avg(mins(prior4Sessions))) : null,
    avgStartHour: hours(cur.sessions).length ? r1(avg(hours(cur.sessions))) : null,
    prevAvgStartHour: hours(prior4Sessions).length ? r1(avg(hours(prior4Sessions))) : null,
  };

  /* ── Nutrition ── */
  let nutrition = null;
  if (nut) {
    const t = nut.targets;
    const es = foodUpTo.filter((e) => within(e.date, w));
    const trained = new Set(cur.sessions.map((s) => s.date));
    const days = dates.map((d) => {
      const de = es.filter((e) => e.date === d), x = totals(de);
      return { date: d, logged: de.length > 0, kcal: Math.round(x.kcal), protein: Math.round(x.protein), carbs: Math.round(x.carbs), fat: Math.round(x.fat), trained: trained.has(d) };
    });
    const logged = days.filter((d) => d.logged);
    // A day under ~45% of target is most likely only partly logged: it would drag every average down.
    const partial = logged.filter((d) => d.kcal < t.kcal * 0.45);
    const full = logged.filter((d) => d.kcal >= t.kcal * 0.45);
    const mean = (xs, k) => (xs.length ? Math.round(avg(xs.map((d) => d[k]))) : null);
    const split = (xs) => ({ days: xs.length, kcal: mean(xs, "kcal"), protein: mean(xs, "protein") });
    const isWeekend = (d) => [0, 6].includes(weekday(d.date));
    const foods = {};
    for (const e of es) {
      const k = e.name.trim().toLowerCase();
      const f = (foods[k] ||= { name: e.name.trim(), times: 0, kcal: 0, protein: 0 });
      f.times++; f.kcal += +e.kcal || 0; f.protein += +e.protein || 0;
    }
    const foodList = Object.values(foods).map((f) => ({ ...f, kcal: Math.round(f.kcal), protein: Math.round(f.protein) }));
    const sum = totals(es);
    const drinks = es.filter((e) => isAlcoholic(e.name));
    const avgKcal = mean(full, "kcal");
    nutrition = {
      targets: { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat, burn: t.burn ?? null },
      goal: FOOD_GOALS.find((g) => g.id === nut.goal)?.label || null,
      days, logged: logged.length, partialDays: partial.map((d) => d.date),
      avgKcal, avgProtein: mean(full, "protein"), avgCarbs: mean(full, "carbs"), avgFat: mean(full, "fat"),
      proteinHit: full.filter((d) => d.protein >= t.protein * 0.9).length,
      kcalOnTarget: full.filter((d) => Math.abs(d.kcal - t.kcal) <= t.kcal * 0.1).length,
      kcalOver: full.filter((d) => d.kcal > t.kcal * 1.1).length, kcalUnder: full.filter((d) => d.kcal < t.kcal * 0.9).length,
      trainingDays: split(full.filter((d) => d.trained)), restDays: split(full.filter((d) => !d.trained)),
      weekend: split(full.filter(isWeekend)), weekdays: split(full.filter((d) => !isWeekend(d))),
      meals: MEALS.map((m) => {
        const x = totals(es.filter((e) => e.meal === m.id));
        return { id: m.id, label: m.label, kcalShare: sum.kcal ? Math.round((x.kcal / sum.kcal) * 100) : 0, proteinShare: sum.protein ? Math.round((x.protein / sum.protein) * 100) : 0 };
      }),
      topByKcal: [...foodList].sort((a, b) => b.kcal - a.kcal).slice(0, 5),
      topByProtein: [...foodList].sort((a, b) => b.protein - a.protein).slice(0, 5),
      drinks: drinks.length ? { entries: drinks.length, kcal: Math.round(totals(drinks).kcal) } : null,
      prevAvgKcal: weeks[6].avgKcal, prevAvgProtein: weeks[6].avgProtein, prevLogged: weeks[6].logged,
      // What the logged food alone predicts for the scale (1 lb ≈ 3,500 kcal), to hold against the weigh-ins.
      impliedRate: avgKcal != null && full.length >= 4 && t.burn ? r1(((avgKcal - t.burn) * 7) / 3500) : null,
    };
  }

  /* ── Bodyweight ── */
  let body = null;
  if (bwAll.length) {
    const wk = bwAll.filter((p) => within(p.date, w)).map((p) => p.bw), pv = bwAll.filter((p) => within(p.date, back(1))).map((p) => p.bw);
    const last = bwAll[bwAll.length - 1];
    const ph = prefs.phase && !prefs.phase.endedAt && prefs.phase.start <= w.end ? prefs.phase : null;
    let phase = null;
    if (ph) {
      const { points, ...s } = phaseStatus(ph, sorted, weighs, w.end); // eslint-disable-line no-unused-vars
      phase = { type: ph.type, label: PHASE_TYPES[ph.type].label, start: ph.start, end: ph.end, startWeight: ph.startWeight, target: ph.target, rate: ph.rate, ...s };
    }
    body = {
      points: bwAll.filter((p) => p.date >= addDays(w.end, -55)),
      weighIns: wk.length, weekAvg: wk.length ? r1(avg(wk)) : null, prevAvg: pv.length ? r1(avg(pv)) : null,
      change: wk.length && pv.length ? r1(avg(wk) - avg(pv)) : null,
      rate4: slope(bwAll.filter((p) => p.date >= addDays(w.end, -27))),
      last: { date: last.date, bw: last.bw }, phase,
    };
  }

  const goals = {
    training: (prefs.profile?.goals || []).map((g) => TRAIN_GOALS.find((x) => x.id === g)?.label).filter(Boolean),
    days: target, note: prefs.profile?.note ? String(prefs.profile.note).slice(0, 200) : null,
  };
  const facts = {
    // The head coach leads the review and speaks for training days, food and the scale.
    v: 1, weekEnd, start: w.start, dates, history, goals, training, nutrition, body, weeks, head: headCoach(prefs),
    notes: cur.sessions.filter((s) => s.note).map((s) => ({ date: s.date, note: String(s.note).slice(0, 200) })),
    fingerprint: fingerprint({ sessions: sorted, weighins: weighs, food: foodUpTo }, weekEnd),
  };
  return { ...facts, ...highsAndLows(facts) };
}

/** Candidate high and low points, best first. The agent picks and words them; the code-written review uses the first. */
function highsAndLows({ training: t, nutrition: n, body: b, head = "tank" }) {
  const highs = [], lows = [];
  const pr = t.prs[0];
  if (pr) highs.push({ text: `New best on ${pr.lift}: ${pr.set}, est. max ${num(pr.e1rm)} lb (+${pr.pct}%)${t.prs.length > 1 ? `, one of ${t.prs.length} records` : ""}.`, coach: pr.coach });
  if (t.target && t.days >= t.target) highs.push({ text: t.streak >= 2 ? `Trained ${t.days} of ${t.target} days, ${t.streak} weeks in a row on target.` : `Trained all ${t.target} planned days.`, coach: head });
  if (t.avg4Sets && t.sets >= t.avg4Sets * 1.1) highs.push({ text: `${t.sets} working sets, up ${pct(t.sets, t.avg4Sets)}% on your recent average.`, coach: head });
  if (n && n.proteinHit >= 5) highs.push({ text: `Protein target hit on ${n.proteinHit} days.`, coach: head });
  if (b?.phase && ["on", "ahead"].includes(b.phase.status)) highs.push({ text: `${b.phase.label} on pace: ${num(b.phase.current)} lb, week ${b.phase.week} of ${b.phase.weeks}.`, coach: head });
  const riser = t.risers[0];
  if (riser && riser.lift !== pr?.lift) highs.push({ text: `${riser.lift} est. max up ${riser.change4}% on four weeks ago.`, coach: riser.coach });

  if (t.target && t.days < t.target) lows.push({ text: t.days ? `Trained ${t.days} of ${t.target} planned days.` : "No workouts logged this week.", coach: head });
  const down = t.downs[0];
  if (down) lows.push({ text: `${down.lift} came in ${Math.abs(down.pct)}% under last time (est. max ${num(down.e1rm)} vs ${num(down.was)} lb).`, coach: down.coach });
  const skip = t.skipped.find((s) => s.times >= 1);
  if (skip) lows.push({ text: `${skip.lift} skipped ${skip.times === 1 ? "once" : `${skip.times} times`}.`, coach: coachFor(baseOf(skip.lift)) });
  const missed = t.groups.find((g) => !g.sets && g.avg4 >= 3);
  if (missed) lows.push({ text: `No ${missed.name.toLowerCase()} work, usually about ${Math.round(missed.avg4)} sets a week.`, coach: missed.id });
  if (n) {
    const low = n.days.filter((d) => d.logged && !n.partialDays.includes(d.date)).sort((a, b) => a.protein - b.protein)[0];
    if (low && low.protein < n.targets.protein * 0.7) lows.push({ text: `Protein dipped to ${low.protein} g on ${WEEKDAYS[weekday(low.date)]} (target ${n.targets.protein} g).`, coach: head });
    const over = n.days.filter((d) => d.logged).sort((a, b) => b.kcal - a.kcal)[0];
    if (over && over.kcal > n.targets.kcal * 1.15) lows.push({ text: `${WEEKDAYS[weekday(over.date)]} ran to ${over.kcal.toLocaleString("en-US")} kcal, ${over.kcal - n.targets.kcal} over target.`, coach: head });
    if (n.logged <= 4) lows.push({ text: `Food logged on ${n.logged} of 7 days.`, coach: head });
  }
  if (b?.phase?.status === "behind") lows.push({ text: `${b.phase.label} behind pace: ${num(b.phase.current)} lb, planned ${num(b.phase.expected)} lb by now.`, coach: head });
  return { highs, lows };
}

/** The facts as the agent reads them: chart-only detail left out. */
export function factsForAgent(facts) {
  const { body, ...rest } = facts;
  return { ...rest, body: body && { ...body, points: undefined } };
}

/* ── The agent's tools: read-only looks at the lifter's data ── */

const setText = (x) => (x.min != null ? `${num(x.min)} min${x.mi != null ? ` ${num(x.mi)} mi` : ""}` : `${fmtW(x.w)}x${x.r}${x.rir != null ? ` @${x.rir} RIR` : ""}`);

/** A lift's last 12 sessions up to the week's end, or the names of lifts that do exist. */
export function liftHistory(sessions, lift, upTo) {
  const upto = sessions.filter((s) => s.date <= upTo);
  const names = [...new Set(upto.flatMap((s) => Object.keys(s.sets || {})))];
  const name = names.find((n) => n.toLowerCase() === String(lift).toLowerCase()) || names.find((n) => n.toLowerCase().includes(String(lift).toLowerCase()));
  if (!name) return { error: `No lift called "${lift}".`, lifts: names.slice(0, 60) };
  const rows = [...upto].sort(byDateAsc).filter((s) => s.sets?.[name]?.length).slice(-12).map((s) => ({
    date: s.date, weekday: WEEKDAYS[weekday(s.date)], sets: s.sets[name].map(setText).join(", "),
    e1rm: lifting(s.sets[name]).length ? r1(bestE1rm(s.sets[name])) : null,
  }));
  return { lift: name, sessions: rows };
}

/** Food per day (and per meal) between two dates, up to 42 days. */
export function foodDays(food, start, end) {
  if (!food) return { error: "Food tracking is off." };
  const s = start > end ? end : start, e = addDays(s, 41) < end ? addDays(s, 41) : end;
  const out = [];
  for (let d = s; d <= e; d = addDays(d, 1)) {
    const de = food.filter((x) => x.date === d);
    if (!de.length) { out.push({ date: d, logged: false }); continue; }
    const x = totals(de);
    out.push({
      date: d, weekday: WEEKDAYS[weekday(d)], kcal: Math.round(x.kcal), protein: Math.round(x.protein), carbs: Math.round(x.carbs), fat: Math.round(x.fat),
      meals: Object.fromEntries(MEALS.map((m) => [m.id, Math.round(totals(de.filter((y) => y.meal === m.id)).kcal)])),
    });
  }
  return { from: s, to: e, days: out };
}

/** The individual foods logged between two dates (up to 80), optionally for one meal. */
export function foodItems(food, start, end, meal) {
  if (!food) return { error: "Food tracking is off." };
  const rows = food.filter((x) => x.date >= start && x.date <= end && (!meal || x.meal === meal)).sort((a, b) => a.date.localeCompare(b.date));
  return {
    count: rows.length,
    items: rows.slice(0, 80).map((x) => ({ date: x.date, meal: x.meal, name: x.name, amount: `${num(+x.amount)} ${x.unit}`, kcal: Math.round(+x.kcal || 0), protein: Math.round(+x.protein || 0) })),
  };
}

/** The same facts for an earlier week, trimmed to the headline numbers. */
export function weekSnapshot(data, weekEnd, weeksAgo) {
  const k = Math.max(1, Math.min(8, Math.round(+weeksAgo || 1)));
  const f = buildWeekFacts({ ...data, weekEnd: addDays(weekEnd, -7 * k) });
  const t = f.training, n = f.nutrition;
  return {
    start: f.start, end: f.weekEnd,
    training: { days: t.days, count: t.count, sets: t.sets, volume: t.volume, cardioMin: t.cardioMin, groups: t.groups, prs: t.prs, sessions: t.sessions.map(({ date, name, mins, sets, startHour }) => ({ date, name, mins, sets, startHour })) },
    nutrition: n && { logged: n.logged, avgKcal: n.avgKcal, avgProtein: n.avgProtein, proteinHit: n.proteinHit, trainingDays: n.trainingDays, restDays: n.restDays, weekend: n.weekend },
    body: f.body && { weekAvg: f.body.weekAvg, change: f.body.change },
  };
}

/* ── The story: what the cards say ── */

const COACH_IDS = new Set(COACH_ORDER);
const str = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const coachId = (c, d = "tank") => (COACH_IDS.has(c) ? c : d);
const note = (x, d, maxT = 70, maxB = 360) => (x && str(x.body, maxB) ? { title: str(x.title, maxT), body: str(x.body, maxB), coach: coachId(x.coach, d) } : null);

/** The agent's write_review input, trimmed and checked, with anything missing filled from `fallback`. */
export function cleanStory(input, facts, fallback) {
  const head = facts.head || "tank";
  const s = input && typeof input === "object" ? input : {};
  const list = (xs, fn, max) => (Array.isArray(xs) ? xs.map(fn).filter(Boolean).slice(0, max) : []);
  const story = {
    headline: str(s.headline, 90), summary: str(s.summary, 420),
    training: note(s.training, head),
    nutrition: facts.nutrition ? note(s.nutrition, head) : null,
    body: facts.body ? note(s.body, head) : null,
    high: note(s.high, head, 70, 280), low: note(s.low, head, 70, 280),
    trends: list(s.trends, (x) => note(x, head, 70, 280), 3),
    insights: list(s.insights, (x) => { const n = note(x, head, 80, 360); return n && { ...n, evidence: str(x.evidence, 180) }; }, 4),
    focus: list(s.focus, (x) => (x && str(x.action, 120) ? { action: str(x.action, 120), why: str(x.why, 220), coach: coachId(x.coach, head) } : null), 3),
  };
  for (const k of ["headline", "summary", "training", "high", "low"]) if (!story[k]) story[k] = fallback[k];
  if (facts.nutrition && !story.nutrition) story.nutrition = fallback.nutrition;
  if (facts.body && !story.body) story.body = fallback.body;
  if (!story.focus.length) story.focus = fallback.focus;
  if (!story.trends.length) story.trends = fallback.trends;
  return story;
}

const signed = (x, unit = "") => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}${unit}`;

/** The review written by plain code: used when no model answers, and to fill any gap in the agent's. */
export function fallbackStory(f) {
  const head = f.head || "tank";
  const t = f.training, n = f.nutrition, b = f.body;
  const all = t.target && t.days >= t.target;
  const headline = !t.count ? (n?.logged ? "A week off the iron, food still logged." : "A quiet week.")
    : all ? (t.prs.length ? `Every training day in, and ${plural(t.prs.length, "new record")}.` : "Every planned training day done.")
    : `${t.days} of ${t.target || t.days} training days in.`;
  const setsVs = t.prevSets ? ` That's ${t.sets >= t.prevSets ? "up" : "down"} from ${t.prevSets} last week.` : "";
  const group = [...t.groups].sort((a, c) => c.sets - a.sets)[0];
  const summary = [
    t.count ? `${plural(t.days, "training day")} and ${t.sets} working sets.${setsVs}` : "No workouts logged this week.",
    n?.avgKcal != null ? `Food averaged ${n.avgKcal.toLocaleString("en-US")} kcal and ${n.avgProtein} g protein against ${n.targets.kcal.toLocaleString("en-US")} kcal and ${n.targets.protein} g.` : "",
    f.history === 0 ? "This is your first review, so it sets the baseline the next ones compare against." : "",
  ].filter(Boolean).join(" ");
  const training = {
    title: t.count ? `${plural(t.days, "day")} · ${t.sets} sets` : "No workouts",
    body: t.count ? [
      group?.sets ? `Most of the work went to ${group.name.toLowerCase()} (${group.sets} sets).` : "",
      t.prs.length ? `New records on ${t.prs.slice(0, 3).map((p) => p.lift).join(", ")}.` : "No new records this week.",
      t.avgMins ? `Sessions ran about ${t.avgMins} minutes.` : "",
    ].filter(Boolean).join(" ") : "Nothing logged in the gym this week. One session gets the rhythm back.",
    coach: head,
  };
  const nutrition = n && {
    title: n.avgKcal != null ? `${n.avgKcal.toLocaleString("en-US")} kcal a day` : "Food",
    body: n.logged ? [
      `Logged ${n.logged} of 7 days.`,
      n.proteinHit ? `Protein target hit on ${plural(n.proteinHit, "day")}.` : `Protein came in under ${n.targets.protein} g every day.`,
      `Calories within 10% of target on ${plural(n.kcalOnTarget, "day")}.`,
      n.trainingDays.days && n.restDays.days ? `Training days averaged ${n.trainingDays.protein} g protein, rest days ${n.restDays.protein} g.` : "",
    ].filter(Boolean).join(" ") : "No food logged this week.",
    coach: head,
  };
  const body_ = b && {
    title: b.weekAvg != null ? `${num(b.weekAvg)} lb average` : `${num(b.last.bw)} lb`,
    body: [
      b.change != null ? `${signed(b.change, " lb")} on last week's average.` : b.weighIns ? "" : "No weigh-in this week.",
      b.phase ? `${b.phase.label}: week ${b.phase.week} of ${b.phase.weeks}, planned ${signed(b.phase.rate, " lb")}/week.` : "",
      b.rate4 != null ? `Four-week trend ${signed(b.rate4, " lb")}/week.` : "",
    ].filter(Boolean).join(" ") || "Weigh in once a week and this card starts tracking the trend.",
    coach: head,
  };
  const high = f.highs[0] ? { title: "High point", body: f.highs[0].text, coach: f.highs[0].coach } : { title: "High point", body: t.count ? "You showed up. Consistency is what moves the numbers." : "Every week logged makes the next review sharper.", coach: head };
  const low = f.lows[0] ? { title: "Low point", body: f.lows[0].text, coach: f.lows[0].coach } : { title: "Low point", body: "Nothing went backwards this week.", coach: head };
  const trends = [];
  const active = f.weeks.filter((x) => x.sessions);
  if (active.length >= 3) trends.push({ title: "Training", body: `${active.length} of the last 8 weeks had workouts, averaging ${Math.round(avg(active.map((x) => x.sets)))} sets.`, coach: head });
  if (b?.rate4 != null) trends.push({ title: "Bodyweight", body: `Moving ${signed(b.rate4, " lb")} a week over the last month.`, coach: head });
  const focus = [
    ...t.ready.slice(0, 2).map((r) => ({ action: `Go up to ${fmtW(r.to)} lb on ${r.lift}`, why: `You hit the top of the range at ${fmtW(r.from)} lb.`, coach: r.coach })),
    t.target && t.days < t.target ? { action: `Train ${t.target} days`, why: `This week was ${t.days}.`, coach: head } : null,
    n && n.logged && n.proteinHit < 5 ? { action: `Reach ${n.targets.protein} g protein on 5+ days`, why: `This week: ${n.proteinHit} days.`, coach: head } : null,
  ].filter(Boolean).slice(0, 3);
  if (!focus.length) focus.push({ action: "Keep the same rhythm", why: "Repeat this week and add a rep where you can.", coach: head });
  return { headline, summary, training, nutrition, body: body_, high, low, trends, insights: [], focus };
}
