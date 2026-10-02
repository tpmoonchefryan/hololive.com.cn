import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import pb from '../lib/pocketbase';
import { createAppLogger } from '../lib/appLogger';

const logger = createAppLogger("useCmsData");

/**
 * 获取首页分段数据
 * 支持多语言 JSON 字段解析和排序
 */
export function useCmsSections() {
  const { i18n } = useTranslation();
  const [sections, setSections] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const fetchSections = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await pb.collection('cms_sections').getList(1, 100, {
          sort: 'sort_order',
          expand: 'background_ref', // Expand relation to get media record
        });
        
        // 处理多语言字段和图片 URL
        const processedSections = result.items.map((section) => {
          // Get background URL from relation first, then fallback to legacy file field
          let backgroundUrl = null;
          if (section.background_ref && section.expand && section.expand.background_ref) {
            // New way: use relation
            const mediaRecord = section.expand.background_ref;
            if (mediaRecord && mediaRecord.file) {
              backgroundUrl = pb.files.getUrl(mediaRecord, mediaRecord.file);
            }
          } else if (section.background) {
            // Legacy way: direct file field (backward compatibility)
            backgroundUrl = pb.files.getUrl(section, section.background);
          }
          
          return {
            ...section,
            title: getLocalizedText(section.title, i18n.language),
            subtitle: getLocalizedText(section.subtitle, i18n.language),
            backgroundUrl: backgroundUrl,
            buttons: (section.buttons || []).map((btn) => ({
              ...btn,
              label: getLocalizedText(btn.label, i18n.language),
            })),
          };
        });
        
        if (active) setSections(processedSections);
      } catch (err) {
        logger.error('Failed to fetch CMS sections:', err);
        if (active) setError(err);
      } finally {
        if (active) setLoading(false);
      }
    };

    fetchSections();
    return () => { active = false; };
  }, [i18n.language, attempt]);

  return { sections, loading, error, retry: () => setAttempt((value) => value + 1) };
}

/**
 * 从多语言 JSON 对象中获取当前语言的文本
 * @param {object} jsonObj - 多语言 JSON 对象，如 {zh: "...", en: "...", ja: "..."}
 * @param {string} lang - 当前语言代码
 * @returns {string} 当前语言的文本，如果不存在则回退到 'zh'
 */
function getLocalizedText(jsonObj, lang) {
  if (!jsonObj || typeof jsonObj !== 'object') {
    return '';
  }
  
  // 优先使用当前语言
  if (jsonObj[lang]) {
    return jsonObj[lang];
  }
  
  // 回退到中文
  if (jsonObj.zh) {
    return jsonObj.zh;
  }
  
  // 如果都没有，返回第一个可用的值
  const values = Object.values(jsonObj);
  return values.length > 0 ? values[0] : '';
}
