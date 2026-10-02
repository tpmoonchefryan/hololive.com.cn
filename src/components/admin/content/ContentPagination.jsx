import { useTranslation } from 'react-i18next';
import ContentSecondaryButton from './ContentSecondaryButton';
export default function ContentPagination({ query }) {
  const { t } = useTranslation('common');
  const translate = (key, values) => t(`pagination.${key}`, { nsSeparator: false, ...values });
  return <nav aria-label={translate('label')} className="flex items-center justify-center gap-3 py-3 text-sm">
    <ContentSecondaryButton aria-label={translate('prev')} disabled={query.loading || query.page <= 1} onClick={() => query.setPage(query.page - 1)}>‹</ContentSecondaryButton>
    <span aria-live="polite">{translate('info', { page: query.page, total: Math.max(1, query.totalPages), count: query.totalItems })}</span>
    <ContentSecondaryButton aria-label={translate('next')} disabled={query.loading || query.page >= query.totalPages} onClick={() => query.setPage(query.page + 1)}>›</ContentSecondaryButton>
  </nav>;
}
