// =========================================================================
// PAGINATION HELPER  —  CCMS
// -------------------------------------------------------------------------
// Bounds large list responses so a single GET can never stream an unbounded
// payload (Section 12.6 — DoS / performance). Behaviour:
//   • ?limit & ?offset are honoured when supplied.
//   • With no ?limit, the full list is returned for backward compatibility,
//     but always clamped to HARD_MAX so a runaway table can't be dumped whole.
//   • Always returns metadata (total / count / offset / hasMore) plus the page
//     under the caller-chosen key.
// =========================================================================

// Absolute ceiling on how many records one response may carry, regardless of
// what the client asks for. Configurable via env for large deployments.
const HARD_MAX = parseInt(process.env.MAX_PAGE_SIZE || "2000", 10);

function paginate(items, query = {}, key = "data") {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;

  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const explicitLimit = Number.isFinite(limit) && limit > 0;
  if (!explicitLimit) limit = total;      // default: everything (back-compat)…
  limit = Math.min(limit, HARD_MAX);      // …but never past the safety ceiling.

  const page = list.slice(offset, offset + limit);

  return {
    [key]: page,
    total,
    count: page.length,
    offset,
    limit,
    hasMore: offset + page.length < total,
  };
}

module.exports = { paginate, HARD_MAX };
