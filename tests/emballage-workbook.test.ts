import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  EMBALLAGE_SOURCE_SHA256,
  parseEmballageWorkbook,
} from "../src/catalogWorkbook.ts";

// In-memory parser fixtures, never used as a customer catalogue or deliverable.
function fixture() {
  const book = new ExcelJS.Workbook(),
    sheet = book.addWorksheet("Produits"),
    info = book.addWorksheet("Informations");
  info.getCell("A1").value = "UNIPLAST EMBALLAGE";
  info.getCell("B1").value = "1";
  info.getCell("B2").value = EMBALLAGE_SOURCE_SHA256;
  sheet.addRow([
    "Action",
    "Identifiant existant",
    "Référence actuelle",
    "Identifiant modèle",
    "Référence PDF",
    "Nom du produit",
    "Code-barres",
    "Dimensions",
    "Capacité",
    "Poids (g)",
    "Unités par colis",
  ]);
  for (let index = 0; index < 44; index++) {
    const id = `model-${index}`;
    for (const [offset, action] of ["Modifier", "Ajouter"].entries())
      sheet.addRow([
        action,
        offset ? "" : id,
        `BASE${index}`,
        id,
        `REF${index}${offset ? "C" : "T"}`,
        `BOITE EMBALLAGE ${index} ${offset ? "COULEUR" : "TRANSPARENT"}`,
        String(6130000000000 + 2 * index + offset),
        "Valeur informative",
        "500 ml",
        37,
        12,
      ]);
  }
  return book;
}
async function bytes(book: ExcelJS.Workbook) {
  return new Uint8Array(await book.xlsx.writeBuffer()).slice().buffer;
}

test("dedicated Emballage workbook imports 44 updates and 44 additions; physical columns never become patches", async () => {
  const book = fixture(),
    sheet = book.getWorksheet("Produits")!;
  sheet.getCell("J2").value =
    "This informational value must never overwrite a live weight";
  const parsed = await parseEmballageWorkbook(await bytes(book));
  assert.equal(parsed.source_sha256, EMBALLAGE_SOURCE_SHA256);
  assert.equal(parsed.rows.filter((row) => row.action === "update").length, 44);
  assert.equal(parsed.rows.filter((row) => row.action === "create").length, 44);
  assert.equal(parsed.rows[1].id, "");
  assert.equal(parsed.rows[1].base_id, parsed.rows[0].id);
  assert.equal(typeof parsed.rows[0].barcode, "string");
  assert.deepEqual(Object.keys(parsed.rows[0]).sort(), [
    "action",
    "barcode",
    "base_id",
    "code",
    "id",
    "name",
    "previous_code",
  ]);
});

test("dedicated import refuses an unrelated source and formulas in any worksheet", async () => {
  let book = fixture();
  book.getWorksheet("Informations")!.getCell("B2").value = "different-document";
  await assert.rejects(
    parseEmballageWorkbook(await bytes(book)),
    /fichier dédié/,
  );
  book = fixture();
  book.getWorksheet("Informations")!.getCell("A8").value = {
    formula: "1+1",
    result: 2,
  };
  await assert.rejects(parseEmballageWorkbook(await bytes(book)), /formules/);
});

test("dedicated import refuses duplicate identities, new record IDs and missing model pairs", async () => {
  let book = fixture(),
    sheet = book.getWorksheet("Produits")!;
  sheet.getCell("G3").value = sheet.getCell("G2").value;
  await assert.rejects(parseEmballageWorkbook(await bytes(book)), /répété/);
  book = fixture();
  sheet = book.getWorksheet("Produits")!;
  sheet.getCell("B3").value = "unexpected-new-ID";
  await assert.rejects(parseEmballageWorkbook(await bytes(book)), /invalide/);
  book = fixture();
  sheet = book.getWorksheet("Produits")!;
  sheet.spliceRows(89, 1);
  await assert.rejects(
    parseEmballageWorkbook(await bytes(book)),
    /88 articles/,
  );
});
