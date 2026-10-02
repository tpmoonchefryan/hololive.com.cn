import ContentSecondaryButton from './ContentSecondaryButton';
export default function ContentPagination({ query }) {
  return <nav aria-label="Pagination" className="flex items-center justify-center gap-3 py-3 text-sm">
    <ContentSecondaryButton aria-label="Previous page" disabled={query.loading || query.page <= 1} onClick={() => query.setPage(query.page - 1)}>‹</ContentSecondaryButton>
    <span aria-live="polite">{query.page} / {Math.max(1, query.totalPages)} · {query.totalItems}</span>
    <ContentSecondaryButton aria-label="Next page" disabled={query.loading || query.page >= query.totalPages} onClick={() => query.setPage(query.page + 1)}>›</ContentSecondaryButton>
  </nav>;
}
