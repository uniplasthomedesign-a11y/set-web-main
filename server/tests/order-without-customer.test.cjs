const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createLocalStore } = require("../local-store.cjs");

// Le formulaire "coordonnées" est masqué côté boutique : une commande doit passer
// sans nom/téléphone/wilaya/adresse envoyés. Le serveur reprend nom et téléphone
// du client agréé ; les anciennes commandes (formulaire complet) restent valides.
test("order-create: coordonnées facultatives, reprises du client agréé", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uniplast-store-qa-"),
  );
  let store = createLocalStore({ dataDir: directory });
  const server = http.createServer((req, res) => {
    void store.handle(req, res).then((handled) => {
      if (!handled) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const jar = {};
  async function call(name, p, who = "admin") {
    const r = await fetch(base + "/api/local/" + name, {
      method: p === undefined ? "GET" : "POST",
      headers: {
        ...(p === undefined ? {} : { "content-type": "application/json" }),
        ...(jar[who] ? { cookie: jar[who] } : {}),
      },
      body: p === undefined ? undefined : JSON.stringify(p),
    });
    const cookie = r.headers.get("set-cookie");
    if (cookie) jar[who] = cookie.split(";")[0];
    return { status: r.status, data: await r.json() };
  }
  try {
    const status = await call("status");
    assert.equal(
      (
        await call("setup", {
          token: status.data.setup_token,
          password: "Local-QA-Password-2026!",
        })
      ).status,
      200,
    );
    const catalog = (await call("catalog")).data;
    const product = {
      ...catalog.products.find((p) => !p.price_on_request),
      available: true,
      availability_confirmed: true,
      stock_cartons: 10,
      discount_price_cents: null,
      unit_price_cents: 1000,
      pack_size: 10,
    };
    assert.equal((await call("product-save", product)).status, 200);
    assert.equal(
      (
        await call("codes-save", {
          name: "Client test",
          phone: "0550000000",
          pin: "012345",
          enabled: true,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call(
          "client-login",
          { phone: "0550000000", pin: "012345" },
          "client",
        )
      ).status,
      200,
    );
    const base_payload = () => ({
      cart: [{ product_id: product.id, cartons: 1 }],
      key: crypto.randomUUID(),
      expected: [
        { product_id: product.id, unit_price_cents: 1000, pack_size: 10 },
      ],
      currency: "DZD",
      shipping: 0,
    });
    // 1. aucun champ « customer »
    const none = await call("order-create", base_payload(), "client");
    assert.equal(none.status, 200);
    assert.equal(none.data.customer.name, "Client test");
    assert.equal(none.data.customer.phone, "+213550000000");
    assert.equal(none.data.customer.wilaya, "");
    assert.equal(none.data.customer.address, "");
    // 2. champs vides
    const blank = await call(
      "order-create",
      {
        ...base_payload(),
        customer: { name: "", phone: "", wilaya: "", address: "", notes: "" },
      },
      "client",
    );
    assert.equal(blank.status, 200);
    assert.equal(blank.data.customer.name, "Client test");
    assert.equal(blank.data.customer.phone, "+213550000000");
    // 3. formulaire complet (anciens navigateurs) : valeurs conservées
    const full = await call(
      "order-create",
      {
        ...base_payload(),
        customer: {
          name: "Autre nom",
          phone: "0550000000",
          wilaya: "Oran",
          address: "Adresse de test 123",
          notes: "ok",
        },
      },
      "client",
    );
    assert.equal(full.status, 200);
    assert.equal(full.data.customer.name, "Autre nom");
    assert.equal(full.data.customer.wilaya, "Oran");
    assert.equal(full.data.customer.address, "Adresse de test 123");
    // 4. un visiteur non connecté reste refusé
    assert.equal(
      (await call("order-create", base_payload(), "visitor")).status,
      403,
    );
  } finally {
    await new Promise((r) => server.close(r));
    store.close();
    const absolute = fs.realpathSync(directory);
    assert(
      absolute.startsWith(fs.realpathSync(os.tmpdir()) + path.sep) &&
        path.basename(absolute).startsWith("uniplast-store-qa-"),
    );
    fs.rmSync(absolute, { recursive: true, force: true });
  }
});
