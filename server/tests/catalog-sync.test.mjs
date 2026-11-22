import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createNetlifyHandler } from "../netlify-store.mjs";
import { memoryStores } from "./blob-fixture.mjs";
const SITE = "https://catalog-sync-test.example";
const INSTALL = "TEST-ONLY-catalog-sync-installation-key";
async function fixture() {
  const stores = memoryStores(),
    cookies = {};
  const config = {
    origins: [SITE],
    setupKey: INSTALL,
    getStores: () => stores,
  };
  const call = async (name, data, who = "admin", extra = {}) => {
    const response = await createNetlifyHandler(config)(
      new Request(SITE + (name.startsWith("/") ? name : "/api/local/" + name), {
        method: data === undefined ? "GET" : "POST",
        headers: {
          ...(data === undefined
            ? {}
            : {
                "content-type": extra.binary ? "image/png" : "application/json",
              }),
          ...(cookies[who] ? { cookie: cookies[who] } : {}),
        },
        body:
          data === undefined
            ? undefined
            : extra.binary
              ? data
              : JSON.stringify(data),
      }),
      { ip: "192.0.2.31" },
    );
    if (response.headers.has("set-cookie"))
      cookies[who] = response.headers.get("set-cookie").split(";")[0];
    return {
      status: response.status,
      headers: response.headers,
      data: response.headers.get("content-type")?.startsWith("application/json")
        ? await response.json()
        : Buffer.from(await response.arrayBuffer()),
    };
  };
  assert.equal(
    (
      await call("setup", {
        setup_key: INSTALL,
        password: "TEST-ONLY-catalog-sync-password!",
      })
    ).status,
    200,
  );
  return { call, stores };
}
test("conditional catalogue returns tiny unchanged views; private price updates do not leak to guests and image cache stays fast", async () => {
  const f = await fixture(),
    before = (await f.call("catalog")).data;
  assert(Array.isArray(before.products));
  assert.equal(before.revision, undefined);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const upload = await f.call("upload?public=1", png, "admin", {
    binary: true,
  });
  assert.equal(upload.status, 200);
  const original = {
    ...before.products.find((p) => !p.price_on_request),
    images: [{ url: upload.data, scale: 1, x: 0, y: 0 }],
    discount_price_cents: null,
    discount_start: null,
    discount_end: null,
  };
  assert.equal((await f.call("product-save", original)).status, 200);
  const guest = await f.call("catalog?sync=1", undefined, "visitor");
  assert.equal(guest.data.unchanged, false);
  assert.equal(guest.data.admin, false);
  assert.equal(guest.data.client_approved, false);
  assert.equal(guest.data.price_access, false);
  assert.match(guest.data.revision, /^[0-9a-f]{64}$/);
  assert(
    guest.data.catalog.products.every(
      (p) =>
        p.price_hidden &&
        p.unit_price_cents === 0 &&
        p.source_metadata === undefined,
    ),
  );
  for (const header of [
    "cache-control",
    "cdn-cache-control",
    "netlify-cdn-cache-control",
  ])
    assert.equal(guest.headers.get(header), "no-store");
  assert.equal(guest.headers.get("vary"), "Cookie");
  const repeated = await f.call(
    "catalog?sync=1&revision=" + guest.data.revision,
    undefined,
    "visitor",
  );
  assert.equal(repeated.data.unchanged, true);
  assert.equal(repeated.data.catalog, undefined);
  assert(JSON.stringify(repeated.data).length < 250);
  const admin = (await f.call("catalog?sync=1")).data;
  const updated = {
    ...original,
    unit_price_cents: original.unit_price_cents + 12345,
  };
  assert.equal((await f.call("product-save", updated)).status, 200);
  const hiddenChange = (
    await f.call(
      "catalog?sync=1&revision=" + guest.data.revision,
      undefined,
      "visitor",
    )
  ).data;
  assert.equal(hiddenChange.unchanged, true);
  const visibleChange = (
    await f.call("catalog?sync=1&revision=" + admin.revision)
  ).data;
  assert.equal(visibleChange.unchanged, false);
  assert.equal(visibleChange.admin, true);
  assert.equal(
    visibleChange.catalog.products.find((p) => p.id === original.id)
      .unit_price_cents,
    updated.unit_price_cents,
  );
  assert.equal(
    visibleChange.catalog.products.find((p) => p.id === original.id).images[0]
      .url,
    upload.data,
  );
  const image = await f.call(upload.data, undefined, "visitor");
  assert.equal(image.status, 200);
  assert.deepEqual(image.data, png);
  assert.equal(
    image.headers.get("cache-control"),
    "public, max-age=31536000, immutable",
  );
  const replacementBytes = Buffer.concat([png, Buffer.from("replacement")]);
  const replacement = await f.call(
    "upload?public=1",
    replacementBytes,
    "admin",
    { binary: true },
  );
  assert.equal(replacement.status, 200);
  assert.notEqual(
    replacement.data,
    upload.data,
    "replacement images always receive a new UUID URL",
  );
  assert.deepEqual((await f.call(upload.data, undefined, "visitor")).data, png);
  assert.deepEqual(
    (await f.call(replacement.data, undefined, "visitor")).data,
    replacementBytes,
  );
  const privateUpload = await f.call("upload?public=0", png, "admin", {
    binary: true,
  });
  assert.equal(privateUpload.status, 200);
  assert.equal(
    (await f.call(privateUpload.data)).headers.get("cache-control"),
    "private, no-store",
  );
});
test("phone access revocation and settings visibility invalidate the caller view without carrying stale private prices", async () => {
  const f = await fixture(),
    c = (await f.call("catalog")).data;
  const customer = {
    name: "TEST ONLY",
    phone: "0770123456",
    pin: "006789",
    enabled: true,
  };
  const created = await f.call("codes-save", customer);
  assert.equal(created.status, 200);
  assert.equal(
    (
      await f.call(
        "client-login",
        { phone: customer.phone, pin: customer.pin },
        "client",
      )
    ).status,
    200,
  );
  const approved = (await f.call("catalog?sync=1", undefined, "client")).data;
  assert.equal(approved.client_approved, true);
  assert.equal(approved.admin, false);
  assert.equal(approved.price_access, true);
  assert(
    approved.catalog.products.some(
      (p) => !p.price_hidden && p.unit_price_cents > 0,
    ),
  );
  assert.equal(
    (
      await f.call("codes-save", {
        ...customer,
        id: created.data.id,
        pin: "",
        enabled: false,
      })
    ).status,
    200,
  );
  const revoked = (
    await f.call(
      "catalog?sync=1&revision=" + approved.revision,
      undefined,
      "client",
    )
  ).data;
  assert.equal(revoked.unchanged, false);
  assert.equal(revoked.client_approved, false);
  assert.equal(revoked.price_access, false);
  assert(
    revoked.catalog.products.every(
      (p) => p.price_hidden && p.unit_price_cents === 0,
    ),
  );
  assert.equal(
    (
      await f.call("settings-save", {
        ...c.settings,
        price_visibility: "public",
      })
    ).status,
    200,
  );
  const publicView = (
    await f.call(
      "catalog?sync=1&revision=" + revoked.revision,
      undefined,
      "client",
    )
  ).data;
  assert.equal(publicView.unchanged, false);
  assert.equal(publicView.client_approved, false);
  assert.equal(publicView.price_access, true);
  assert(
    publicView.catalog.products.some(
      (p) => !p.price_hidden && p.unit_price_cents > 0,
    ),
  );
  assert.equal(
    (
      await f.call("codes-save", {
        ...customer,
        id: created.data.id,
        pin: "",
        enabled: true,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.call(
        "client-login",
        { phone: customer.phone, pin: customer.pin },
        "client",
      )
    ).status,
    200,
  );
  const approvedPublic = (await f.call("catalog?sync=1", undefined, "client"))
    .data;
  assert.equal(approvedPublic.client_approved, true);
  assert.equal(
    (
      await f.call("codes-save", {
        ...customer,
        id: created.data.id,
        pin: "",
        enabled: false,
      })
    ).status,
    200,
  );
  const revokedPublic = (
    await f.call(
      "catalog?sync=1&revision=" + approvedPublic.revision,
      undefined,
      "client",
    )
  ).data;
  assert.equal(revokedPublic.unchanged, false);
  assert.equal(revokedPublic.client_approved, false);
  assert.deepEqual(revokedPublic.catalog, approvedPublic.catalog);
  assert.notEqual(revokedPublic.revision, approvedPublic.revision);
  const manager = (await f.call("catalog?sync=1")).data;
  assert.equal(manager.admin, true);
  assert.equal((await f.call("logout", {})).status, 200);
  const expiredManager = (
    await f.call("catalog?sync=1&revision=" + manager.revision)
  ).data;
  assert.equal(expiredManager.unchanged, false);
  assert.equal(expiredManager.admin, false);
});

test("access checks never include catalogue data; PIN rotation invalidates old sessions and requires the new PIN", async () => {
  const f = await fixture();
  const inspectCheck = (data) => {
    assert.equal(data.catalog, undefined);
    assert.deepEqual(Object.keys(data).sort(), [
      "admin",
      "client_approved",
      "price_access",
      "revision",
      "unchanged",
    ]);
    assert(Buffer.byteLength(JSON.stringify(data)) <= 350);
    assert.match(data.revision, /^[a-f0-9]{64}$/);
  };
  const legacy = (await f.call("catalog")).data;
  assert.equal(legacy.price_access, undefined);
  const guest = await f.call("catalog?sync=1&check=1", undefined, "visitor");
  assert.equal(guest.status, 200);
  inspectCheck(guest.data);
  assert.equal(guest.data.unchanged, false);
  assert.equal(guest.data.price_access, false);
  assert.equal(guest.headers.get("cache-control"), "no-store");
  const repeated = (
    await f.call(
      "catalog?sync=1&check=1&revision=" + guest.data.revision,
      undefined,
      "visitor",
    )
  ).data;
  inspectCheck(repeated);
  assert.equal(repeated.unchanged, true);
  const product = legacy.products.find((p) => !p.price_on_request);
  assert.equal(
    (
      await f.call("product-save", {
        ...product,
        unit_price_cents: product.unit_price_cents + 111,
      })
    ).status,
    200,
  );
  const hiddenPrice = (
    await f.call(
      "catalog?sync=1&check=1&revision=" + guest.data.revision,
      undefined,
      "visitor",
    )
  ).data;
  inspectCheck(hiddenPrice);
  assert.equal(hiddenPrice.unchanged, true);
  assert.equal(
    hiddenPrice.revision,
    guest.data.revision,
    "the access probe must not reveal a private price change",
  );
  const admin = (
    await f.call("catalog?sync=1&check=1&revision=" + guest.data.revision)
  ).data;
  inspectCheck(admin);
  assert.equal(admin.admin, true);
  assert.equal(admin.price_access, true);
  assert.equal(admin.unchanged, false);
  const customer = {
    name: "TEST PIN rotation",
    phone: "0660123456",
    pin: "001234",
    enabled: true,
  };
  const code = await f.call("codes-save", customer);
  assert.equal(code.status, 200);
  assert.equal(
    (
      await f.call(
        "client-login",
        { phone: customer.phone, pin: customer.pin },
        "client",
      )
    ).status,
    200,
  );
  const approved = (await f.call("catalog?sync=1&check=1", undefined, "client"))
    .data;
  inspectCheck(approved);
  assert.equal(approved.client_approved, true);
  assert.equal(approved.price_access, true);
  const approvedAccess = (
    await f.call("catalog?sync=1&access=1", undefined, "client")
  ).data;
  assert.deepEqual(approvedAccess, {
    access_only: true,
    unchanged: false,
    admin: false,
    client_approved: true,
    price_access: true,
  });
  assert(Buffer.byteLength(JSON.stringify(approvedAccess)) < 180);
  assert.equal(
    (
      await f.call("codes-save", {
        ...customer,
        id: code.data.id,
        pin: "006789",
      })
    ).status,
    200,
  );
  const expired = (
    await f.call(
      "catalog?sync=1&check=1&revision=" + approved.revision,
      undefined,
      "client",
    )
  ).data;
  inspectCheck(expired);
  assert.equal(expired.client_approved, false);
  assert.equal(expired.price_access, false);
  assert.equal(expired.unchanged, false);
  const revokedAccess = (
    await f.call("catalog?sync=1&access=1", undefined, "client")
  ).data;
  assert.deepEqual(revokedAccess, {
    access_only: true,
    unchanged: false,
    admin: false,
    client_approved: false,
    price_access: false,
  });
  assert.equal(
    (
      await f.call(
        "client-login",
        { phone: customer.phone, pin: customer.pin },
        "client",
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await f.call(
        "client-login",
        { phone: customer.phone, pin: "006789" },
        "client",
      )
    ).status,
    200,
  );
  const refreshed = (await f.call("catalog?sync=1", undefined, "client")).data;
  assert.equal(refreshed.price_access, true);
  assert.equal(refreshed.client_approved, true);
  assert.equal(
    refreshed.catalog.products.find((p) => p.id === product.id)
      .unit_price_cents,
    product.unit_price_cents + 111,
  );
  const changedCheck = (
    await f.call(
      "catalog?sync=1&check=1&revision=old-revision",
      undefined,
      "client",
    )
  ).data;
  inspectCheck(changedCheck);
  assert.equal(changedCheck.unchanged, false);
});

test("access-only probe skips catalogue construction and never returns data or revision", async () => {
  const f = await fixture();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "uniplast-access-probe-test-"),
  );
  const database = path.join(directory, "store.sqlite");
  try {
    const state = f.stores.state.records.get("store.sqlite");
    assert(state);
    fs.writeFileSync(database, Buffer.from(state.bytes));
    const db = new DatabaseSync(database);
    try {
      // Deliberately invalid data in this isolated fixture makes a full catalogue
      // read fail, proving that an access probe never constructs the catalogue.
      db.prepare(
        "UPDATE documents SET body='null' WHERE kind='product' AND id=(SELECT id FROM documents WHERE kind='product' LIMIT 1)",
      ).run();
    } finally {
      db.close();
    }
    const bytes = fs.readFileSync(database);
    state.bytes = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const probe = await f.call("catalog?sync=1&access=1");
    assert.equal(probe.status, 200);
    assert.deepEqual(probe.data, {
      access_only: true,
      unchanged: false,
      admin: true,
      client_approved: false,
      price_access: true,
    });
    assert.equal(probe.data.catalog, undefined);
    assert.equal(probe.data.revision, undefined);
    assert(Buffer.byteLength(JSON.stringify(probe.data)) < 180);
    assert.equal(probe.headers.get("cache-control"), "no-store");
    assert.notEqual((await f.call("catalog?sync=1")).status, 200);
  } finally {
    assert.equal(
      path.dirname(path.resolve(directory)),
      path.resolve(os.tmpdir()),
    );
    assert(path.basename(directory).startsWith("uniplast-access-probe-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
