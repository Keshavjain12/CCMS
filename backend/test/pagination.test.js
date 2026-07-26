
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { paginate, HARD_MAX } = require("../src/utils/pagination");

const range = (n) => Array.from({ length: n }, (_, i) => i);

test("no limit → returns everything (back-compat), hasMore false", () => {
  const p = paginate(range(10), {}, "data");
  assert.equal(p.total, 10);
  assert.equal(p.count, 10);
  assert.equal(p.hasMore, false);
  assert.ok(Array.isArray(p.data));
});

test("limit + offset slice correctly and report hasMore", () => {
  const p = paginate(range(10), { limit: "3" }, "data");
  assert.equal(p.count, 3);
  assert.equal(p.hasMore, true);

  const p2 = paginate(range(10), { limit: "3", offset: "9" }, "data");
  assert.equal(p2.count, 1);
  assert.equal(p2.hasMore, false);
});

test("negative/garbage offset is treated as 0", () => {
  const p = paginate(range(5), { offset: "-4" }, "data");
  assert.equal(p.offset, 0);
  assert.equal(p.count, 5);
});

test("hard max clamps an over-large request", () => {
  const p = paginate(range(HARD_MAX + 500), { limit: String(HARD_MAX + 9999) }, "data");
  assert.equal(p.count, HARD_MAX);
  assert.equal(p.limit, HARD_MAX);
  assert.equal(p.hasMore, true);
});

test("non-array input is handled gracefully", () => {
  const p = paginate(null, {}, "rows");
  assert.equal(p.total, 0);
  assert.deepEqual(p.rows, []);
});
