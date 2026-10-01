/* Checks for barcode scanning: reading codes into one canonical form (src/lib/barcode.js), finding a
   scanned food already on the phone, and the food API's barcode handling (api/food.js).
   Run: npm run test:barcode   (exits 1 on any failure) */
import { normalizeBarcode, expandUpcE, sameBarcode, foodForBarcode } from "../src/lib/barcode.js";
import { barcodeForms, fromOff, fromUsda } from "../api/food.js";

let failed = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.error(`✗ ${name}\n    got  ${JSON.stringify(got)}\n    want ${JSON.stringify(want)}`); }
};

// Canonical form: GTIN-13, or EAN-8.
eq("UPC-A gets a leading 0", normalizeBarcode("049000028911"), "0049000028911");
eq("EAN-13 as is", normalizeBarcode("5000159407236"), "5000159407236");
eq("EAN-13 with spaces", normalizeBarcode(" 5 000159 407236 "), "5000159407236");
eq("GTIN-14 with no packaging level", normalizeBarcode("00049000028911"), "0049000028911");
eq("EAN-8 as is", normalizeBarcode("96385074"), "96385074");
eq("bad check digit", normalizeBarcode("049000028912"), null);
eq("too short", normalizeBarcode("12345"), null);
eq("empty", normalizeBarcode(""), null);
eq("null", normalizeBarcode(null), null);

// UPC-E: each expansion rule (last digit 0-2, 3, 4, 5-9).
eq("UPC-E rule 0-2", expandUpcE("04252614"), "042100005264");
eq("UPC-E rule 3", expandUpcE("01234531"), "012300000451");
eq("UPC-E rule 4", expandUpcE("01234543"), "012340000053");
eq("UPC-E rule 5-9", expandUpcE("01234565"), "012345000065");
eq("UPC-E bad check", expandUpcE("01234566"), null);
eq("UPC-E from the detector", normalizeBarcode("04252614", "upc_e"), "0042100005264");
eq("8 digits typed: valid EAN-8 wins", normalizeBarcode("96385074"), "96385074");
eq("8 digits typed: UPC-E when not an EAN-8", normalizeBarcode("04252614"), "0042100005264");

eq("same barcode across forms", sameBarcode("49000028911".padStart(12, "0"), "0049000028911"), true);
eq("different barcode", sameBarcode("5000159407236", "0049000028911"), false);
eq("no stored barcode", sameBarcode(undefined, "0049000028911"), false);

// Finding a scanned food on the phone: saved foods first, then the newest entry.
const code = "0049000028911";
const basis = { per100: { kcal: 0, protein: 0, carbs: 0, fat: 0 }, portions: [] };
const foods = [{ id: "f1", name: "Other", basis }, { id: "f2", name: "Diet Coke (mine)", basis: { ...basis, barcode: code } }];
const entries = [
  { id: "e1", name: "Diet Coke old", source: "off", source_ref: "049000028911", basis, created_at: "2026-09-01T00:00:00Z" },
  { id: "e2", name: "Diet Coke new", source: "usda", source_ref: "123", basis: { ...basis, barcode: "049000028911" }, created_at: "2026-09-20T00:00:00Z" },
  { id: "e3", name: "Quick", source: "quick", source_ref: null, basis: null, created_at: "2026-09-30T00:00:00Z" },
];
eq("saved food wins", foodForBarcode(foods, entries, code)?.item.id, "f2");
eq("else newest entry", foodForBarcode([], entries, code)?.item.id, "e2");
eq("Open Food Facts entry by source_ref", foodForBarcode([], entries.slice(0, 1), code)?.item.id, "e1");
eq("no match", foodForBarcode(foods, entries, "5000159407236"), null);

// API: the forms a code is looked up under, and the barcode riding in the basis.
eq("forms of a GTIN-13 UPC", barcodeForms("0049000028911"), ["0049000028911", "049000028911", "00049000028911"]);
eq("forms of an EAN-13", barcodeForms("5000159407236"), ["5000159407236", "05000159407236"]);
eq("forms of an EAN-8", barcodeForms("96385074"), ["96385074", "00000096385074"]);
const off = fromOff({ code: "0049000028911", product_name: "Diet Coke", brands: "Coca-Cola", nutriments: { "energy-kcal_100g": 0.4 }, serving_quantity: 355, serving_size: "12 fl oz (355 ml)" });
eq("OFF basis carries the barcode", off.basis.barcode, "0049000028911");
const usda = fromUsda({ fdcId: 1, description: "DIET COKE", gtinUpc: "049000028911", servingSize: 355, servingSizeUnit: "g", foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 0 }] });
eq("USDA branded basis carries the barcode", usda.basis.barcode, "049000028911");
eq("USDA everyday food has none", fromUsda({ fdcId: 2, description: "Apple", foodNutrients: [{ nutrientId: 1008, unitName: "KCAL", value: 52 }] }).basis.barcode, undefined);

if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
console.log("barcode: all checks passed");
