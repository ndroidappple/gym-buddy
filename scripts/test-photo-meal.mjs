/* Checks for logging a meal from photos on a kitchen scale: the scale reading Tank reads, the meal
   fitted to it (src/lib/nutrition.js), and the photos the API takes in (api/coach.js).
   Run: npm run test:food   (exits 1 on any failure) */
import { cleanMeal, scaleGrams, fitToScale } from "../src/lib/nutrition.js";
import { photosOf, foodInstructions } from "../api/coach.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// The display in grams, whatever its unit; unread or implausible is null.
eq("grams as read", scaleGrams({ value: 412, unit: "g" }), 412);
eq("oz", scaleGrams({ value: 14.5, unit: "oz" }), 411);
eq("lb", scaleGrams({ value: 1.2, unit: "lb" }), 544);
eq("kg", scaleGrams({ value: 0.41, unit: "kg" }), 410);
eq("ml counts as grams", scaleGrams({ value: 300, unit: "ml" }), 300);
eq("no reading", scaleGrams(undefined), null);
eq("zero", scaleGrams({ value: 0, unit: "g" }), null);
eq("unknown unit", scaleGrams({ value: 412, unit: "stone" }), null);
eq("not a plate's weight", scaleGrams({ value: 30, unit: "kg" }), null);

// What Tank sends for a chicken and rice plate: his split by eye, about 380 g, and a drink on the side.
const raw = {
  name: "Chicken Rice Bowl",
  scale_reading: { value: 456, unit: "g" },
  items: [
    { food: "Chicken breast (cooked)", amount: "about 150 g", grams: 150, kcal: 248, protein: 46.5, carbs: 0, fat: 5.4, alcohol: 0, estimated: true },
    { food: "White rice (cooked)", amount: "about 1 cup (200 g)", grams: 200, kcal: 260, protein: 5.4, carbs: 56.4, fat: 0.6, alcohol: 0, estimated: true },
    { food: "Olive oil (cooking)", amount: "1 tsp", grams: 5, kcal: 40, protein: 0, carbs: 0, fat: 4.5, alcohol: 0 },
    { food: "Diet Coke", amount: "12 oz", grams: 355, kcal: 0, protein: 0, carbs: 0, fat: 0, alcohol: 0, on_scale: false },
    { food: "Orange juice", amount: "8 oz", grams: 248, kcal: 112, protein: 1.7, carbs: 25.8, fat: 0.5, alcohol: 0, on_scale: false },
  ],
};
const m = cleanMeal(raw);
eq("reading kept in grams", m.scale, 456);
eq("off-scale items marked", m.items.map((x) => x.onScale ?? true), [true, true, true, false]);
eq("a meal without a reading has no scale", "scale" in cleanMeal({ ...raw, scale_reading: undefined }), false);
eq("a described meal is unchanged", Object.keys(cleanMeal({ name: "Eggs", items: [{ food: "Egg", amount: "2", kcal: 140, protein: 12, carbs: 1, fat: 10 }] })), ["name", "items", "total", "estimated"]);

// Fitted to 456 g: what he judged by eye (chicken, rice) takes the 451 g the known teaspoon of oil
// leaves, his split kept; the oil and the juice beside the plate stay as they were.
const f = fitToScale(m, 456);
const k = 451 / 350;
eq("fit factor is the scale over his eye", Math.round(f.fit.k * 1000) / 1000, Math.round((456 / 355) * 1000) / 1000);
eq("fit seen", f.fit.seen, 355);
eq("grams add up to the scale", f.items.filter((x) => x.onScale !== false).reduce((a, x) => a + x.grams, 0), 456);
eq("chicken scaled", [f.items[0].grams, f.items[0].kcal, f.items[0].protein, f.items[0].amount], [193, Math.round(248 * k), Math.round(46.5 * k * 10) / 10, "193 g"]);
eq("a known amount stays", f.items[2], m.items[2]);
eq("off the scale: as it was", f.items[3], m.items[3]);
// Known amounts heavier than the scale: everything on it is scaled instead.
const tiny = fitToScale(m, 4);
eq("known outweighs the scale: all scaled", tiny.items[2].grams < 5 && tiny.items[0].grams < 150, true);
// Nothing judged by eye (every amount given): all of it is scaled.
const given = fitToScale({ ...m, items: m.items.map((x) => ({ ...x, estimated: false })) }, 710);
eq("nothing guessed: all on the scale scaled", given.items.slice(0, 3).map((x) => x.grams), [300, 400, 10]);
eq("total re-summed", f.total.kcal, f.items.reduce((a, x) => a + x.kcal, 0));
eq("name kept", f.name, "Chicken Rice Bowl");
eq("no weight: unchanged", fitToScale(m, null), m);
eq("zero weight: unchanged", fitToScale(m, 0), m);
eq("an item on the scale without grams: unchanged", fitToScale({ ...m, items: [{ ...m.items[0], grams: null }, m.items[1]] }, 456).fit, undefined);
eq("no meal", fitToScale(null, 400), null);

// Photos: only base64 images of the kinds a phone sends, at most 3.
const jpg = { data: "/9j/4AAQSkZJRgABAQ==", mediaType: "image/jpeg" };
eq("a photo becomes an image part", photosOf([jpg]), [{ type: "image", image: jpg.data, mediaType: "image/jpeg" }]);
eq("at most 3", photosOf([jpg, jpg, jpg, jpg]).length, 3);
eq("not an image type", photosOf([{ ...jpg, mediaType: "application/pdf" }]), []);
eq("a URL is not base64", photosOf([{ ...jpg, data: "https://example.com/x.jpg" }]), []);
eq("too big", photosOf([{ ...jpg, data: "A".repeat(1500000) }]), []);
eq("not a list", photosOf("x"), []);

// The photo rules ride only with photos.
eq("photo rules with photos", /kitchen scale/.test(foodInstructions("", "tank", true)), true);
eq("no photo rules without", /kitchen scale/.test(foodInstructions("", "tank")), false);

if (failed) { console.error(`\n${failed} photo meal check(s) failed`); process.exit(1); }
console.log("photo meal: all checks passed");
