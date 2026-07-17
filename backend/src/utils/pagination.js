const HARD_MAX = parseInt(process.env.MAX_PAGE_SIZE || "2000", 10);

function paginate(items, query = {}, key = "data") {
  const list = Array.isArray(items) ? items : [];
  const total = list.length;

  let limit = parseInt(query.limit, 10);
  let offset = parseInt(query.offset, 10);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;

  const explicitLimit = Number.isFinite(limit) && limit > 0;
  if (!explicitLimit) limit = total;
  limit = Math.min(limit, HARD_MAX);

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
