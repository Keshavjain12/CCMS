

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fileStore = require("../src/utils/fileStore");

test("newStoredName: generated, safe, extension honoured", () => {
  const png = fileStore.newStoredName("photo", "evidence.PNG");
  assert.match(png, /^att_[0-9a-f-]+\.png$/i);

  assert.match(fileStore.newStoredName("photo", "noext"), /\.jpg$/);
  assert.match(fileStore.newStoredName("document", "x.exe"), /\.pdf$/, "disallowed ext → type default");
});

test("resolveStored: only resolves names we issued (traversal guard)", () => {
  const good = fileStore.newStoredName("photo", "x.png");
  assert.ok(fileStore.resolveStored(good), "a generated name resolves");
  assert.ok(fileStore.resolveStored(good).startsWith(fileStore.UPLOAD_DIR));

  for (const evil of ["../../../etc/passwd", "evil.js", "att_x/../../y.png", "", null, "photo_drum_01.jpg"]) {
    assert.equal(fileStore.resolveStored(evil), null, `must reject: ${evil}`);
  }
});

test("contentTypeFor: maps by extension, defaults to octet-stream", () => {
  assert.equal(fileStore.contentTypeFor("att_x.png"), "image/png");
  assert.equal(fileStore.contentTypeFor("att_x.pdf"), "application/pdf");
  assert.equal(fileStore.contentTypeFor("att_x.zzz"), "application/octet-stream");
});
