import { useState, useEffect } from 'react';
import { X, ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import pb from '../../lib/pocketbase';
import { activeAnnouncementFilter, nextBoundary } from './announcement';
export default function GlobalBanner({ overrideAnnouncement = null }) {
  const { t, i18n } = useTranslation('common');
  const [announcement, setAnnouncement] = useState(null);
  const [dismissedId, setDismissedId] = useState(null);
  const item = overrideAnnouncement || announcement;
  const visible = item && item.id !== dismissedId;
  const text = item?.content?.[i18n.language] || item?.content?.en || item?.content?.zh || Object.values(item?.content || {})[0] || '';
  useEffect(() => {
    if (overrideAnnouncement) return;
    let cancelled = false;
    let timer;
    const refresh = async () => {
      const now = Date.now();
      try {
        const collection = pb.collection('announcements');
        const current = await collection.getList(1, 1, { filter: activeAnnouncementFilter(pb, now), sort: '-created,-id', requestKey: null });
        if (cancelled) return;
        setAnnouncement(current.items[0] || null);
        const upcoming = await Promise.all(['start_time', 'end_time'].map(field => collection.getList(1, 1, {
          filter: pb.filter(`is_active = true && ${field} > {:now}`, { now: new Date(now).toISOString().replace('T', ' ') }), sort: field, requestKey: null,
        })));
        if (cancelled) return;
        const boundary = nextBoundary(upcoming.flatMap(result => result.items), now);
        timer = setTimeout(refresh, Math.max(1, Math.min(60000, boundary ? boundary - Date.now() : 60000)));
      } catch {
        if (cancelled) return;
        timer = setTimeout(refresh, 60000);
      }
    };
    refresh();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [overrideAnnouncement]);
  if (!visible || !text) return null;
  const urgent = item.type === 'urgent';
  return <>
    <div role="status" className={`${overrideAnnouncement ? 'relative' : 'sticky top-[56px] md:top-[64px] mt-[56px] md:mt-[64px]'} w-full ${urgent ? 'bg-red-600' : 'bg-blue-600'} border-b border-white/20 z-40`}>
      <div className="max-w-7xl mx-auto flex items-start gap-3 px-4 py-3 text-white">
        <div className="min-w-0 flex-1 text-sm md:text-base whitespace-pre-wrap [overflow-wrap:anywhere]">
          {text}{item.link && <a href={item.link} target="_blank" rel="noopener noreferrer" className="ml-2 underline inline-flex items-center gap-1">{t('banner.details')}<ExternalLink className="w-3 h-3" /></a>}
        </div>
        <button type="button" onClick={() => setDismissedId(item.id)} className="shrink-0 p-2 rounded hover:bg-white/20" aria-label={t('banner.close')}><X className="w-4 h-4" /></button>
      </div>
    </div>
  </>;
}
