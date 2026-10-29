/* The account the end-to-end tests sign in as: set up, nutrition on, a few saved foods. */
import { USER } from "./fake-backend.mjs";

const meal = (kcal, protein, carbs, fat) => ({ perServing: { kcal, protein, carbs, fat }, servingLabel: "meal" });

export const FOODS = [
  { id: "11111111-1111-4111-8111-000000000001", name: "Banana Berry Smoothie", brand: null, basis: meal(421, 36, 56, 8), created_at: "2026-10-01T15:00:00Z", updated_at: "2026-10-01T15:00:00Z" },
  { id: "11111111-1111-4111-8111-000000000002", name: "Oatmeal with chia", brand: null, basis: meal(522, 20, 80, 14), created_at: "2026-10-02T15:00:00Z", updated_at: "2026-10-02T15:00:00Z" },
];

/** A food database answer for /api/food?q=, the same shape api/food.js returns. */
export const SEARCH_RESULT = {
  id: "fdc-123", name: "Strawberry smoothie", brand: null, source: "usda", ref: "123",
  basis: { per100: { kcal: 60, protein: 1, carbs: 14, fat: 0.3 }, portions: [{ label: "cup", grams: 240 }] },
};

/** Workouts and settings: the one JSON record in storage_kv, as store.js writes it. */
const record = {
  sessions: [],
  weighins: [],
  prefs: {
    welcomed: true,
    headCoach: "tank",
    weekReview: { intro: true }, // its "New: Week in review" sheet already seen
    nutrition: { on: true, targets: { kcal: 2400, protein: 180, carbs: 250, fat: 70 } },
  },
  savedAt: Date.parse("2026-10-01T15:00:00Z"),
};

/** A date as the app writes them (local, YYYY-MM-DD), `days` from today. */
export const day = (days = 0) => new Date(Date.now() + days * 864e5).toLocaleDateString("en-CA");

/** A logged workout: `sets` is { lift: [[weight, reps], ...] }, an hour long. */
export const workout = (id, dayKey, date, sets) => ({
  id, date, day: dayKey, startedAt: Date.parse(`${date}T17:00:00`), finishedAt: Date.parse(`${date}T18:00:00`),
  sets: Object.fromEntries(Object.entries(sets).map(([n, xs]) => [n, xs.map(([w, r]) => ({ w, r }))])),
});

/** A logged food: `days` from today, at `meal`; a meal Tank itemized unless `extra` says otherwise. */
let entryN = 0;
export const entry = (name, meal, days, extra = {}) => {
  const date = day(days), id = `22222222-2222-4222-8222-${String(++entryN).padStart(12, "0")}`;
  return { id, user_id: USER.id, date, meal, name, brand: null, amount: 1, unit: "meal", grams: null, kcal: 500, protein: 40, carbs: 50, fat: 15,
    source: "ai", source_ref: null, basis: null, created_at: `${date}T18:00:0${entryN % 10}Z`, updated_at: `${date}T18:00:00Z`, ...extra };
};

/** Saved weeks in review, newest first, one a week ending yesterday: storage_kv rows as api/review.js writes them. */
export const reviews = (n) => Array.from({ length: n }, (_, i) => {
  const weekEnd = day(-7 * i - 1);
  return { user_id: USER.id, key: `week-review:${weekEnd}`, updated_at: `${weekEnd}T12:00:00Z`,
    value: JSON.stringify({ weekEnd, story: { headline: `Week ${n - i} headline` } }) };
});

/** The account; `sessions` are its logged workouts and `entries` its food log (none by default). */
export const account = ({ sessions = [], entries = [] } = {}) => ({
  tables: {
    storage_kv: [{ user_id: USER.id, key: "ironlog-v2", value: JSON.stringify({ ...record, sessions }), updated_at: "2026-10-01T15:00:00Z" }],
    foods: FOODS.map((f) => ({ ...f, user_id: USER.id })),
    food_entries: entries,
  },
  userMeta: { name_asked: true, first_name: "Nick" },
});
