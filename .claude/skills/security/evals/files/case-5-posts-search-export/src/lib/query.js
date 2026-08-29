function buildFilter(query) {
  const filter = { isPublished: true };

  if (query.tag) {
    filter.tags = String(query.tag);
  }
  if (query.author) {
    filter.author = String(query.author);
  }
  if (query.q) {
    filter.title = new RegExp(String(query.q), 'i');
  }

  return filter;
}

module.exports = { buildFilter };
