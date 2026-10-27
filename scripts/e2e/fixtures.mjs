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

/** The account; `sessions` are its logged workouts (none by default). */
export const account = ({ sessions = [] } = {}) => ({
  tables: {
    storage_kv: [{ user_id: USER.id, key: "ironlog-v2", value: JSON.stringify({ ...record, sessions }), updated_at: "2026-10-01T15:00:00Z" }],
    foods: FOODS.map((f) => ({ ...f, user_id: USER.id })),
    food_entries: [],
  },
  userMeta: { name_asked: true, first_name: "Nick" },
});
