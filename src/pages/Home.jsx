import { useRef, useState, useEffect } from "react";
import { motion, useScroll, useTransform } from "framer-motion";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ASSETS } from "../config/assets";
import { useCmsSections } from "../hooks/useCmsData";

// 背景图片组件，使用 useScroll
function BackgroundImages({ contentRef, firstBg, lastBg }) {
  const { scrollYProgress } = useScroll({ 
    target: contentRef, 
    offset: ["start start", "end end"] 
  });
  const mainOpacity = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  return (
    <div className="fixed inset-0 w-full h-full -z-10">
      <img
        src={lastBg}
        className="absolute inset-0 w-full h-full object-cover"
        alt=""
        aria-hidden="true"
        draggable={false}
      />
      <motion.img
        src={firstBg}
        style={{ opacity: mainOpacity }}
        className="absolute inset-0 w-full h-full object-cover"
        alt=""
        aria-hidden="true"
        draggable={false}
      />
    </div>
  );
}

// 将主要内容提取为独立组件，确保在数据准备好后才渲染
function HomeContent({ sections }) {
  const contentRef = useRef(null);
  const [isMounted, setIsMounted] = useState(false);
  
  // 确保 DOM 已挂载
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsMounted(true);
    }, 0);

    return () => clearTimeout(timer);
  }, []);
  
  // 背景图片：第一张作为渐变背景，最后一张作为固定背景
  const firstSectionBackground = sections.length > 0 && sections[0]?.backgroundUrl 
    ? sections[0].backgroundUrl 
    : ASSETS.IMAGES.HERO_MAIN;
  
  const lastSectionBackground = sections.length > 0 && sections[sections.length - 1]?.backgroundUrl
    ? sections[sections.length - 1].backgroundUrl
    : ASSETS.IMAGES.HERO_SCROLL;

  return (
    <div className="relative w-full min-h-screen overflow-hidden">
      {/* 只有在挂载后才渲染使用 useScroll 的背景组件 */}
      {isMounted ? (
        <BackgroundImages 
          contentRef={contentRef} 
          firstBg={firstSectionBackground}
          lastBg={lastSectionBackground}
        />
      ) : (
        <div className="fixed inset-0 w-full h-full -z-10">
          <img
            src={lastSectionBackground}
            className="absolute inset-0 w-full h-full object-cover"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
          <img
            src={firstSectionBackground}
            className="absolute inset-0 w-full h-full object-cover"
            alt=""
            aria-hidden="true"
            draggable={false}
          />
        </div>
      )}

      <main ref={contentRef} className="relative z-10 flex flex-col w-full min-h-screen pointer-events-auto">
        {sections.map((section) => (
          <section
            key={section.id}
            className="relative h-screen flex flex-col justify-center items-center text-center px-4 z-20 pointer-events-auto"
          >
            <h1 className="text-3xl md:text-6xl font-extrabold text-white drop-shadow-[0_5px_5px_rgba(0,0,0,0.8)] mb-4 leading-tight pointer-events-none">
              {section.title}
            </h1>
            {section.subtitle && (
              <p className="text-base md:text-2xl font-bold text-white drop-shadow-[0_3px_3px_rgba(0,0,0,0.8)] max-w-2xl mx-auto mt-2 mb-8 pointer-events-none">
                {section.subtitle}
              </p>
            )}
            {section.buttons && section.buttons.length > 0 && (
              <div className="flex flex-wrap gap-4 justify-center mt-3 relative z-20 pointer-events-auto">
                {section.buttons.map((button, btnIndex) => {
                  const isExternal = button.link && (button.link.startsWith('http://') || button.link.startsWith('https://'));
                  
                  if (isExternal) {
                    // 外部链接：使用 <a> 标签
                    return (
                      <a
                    key={btnIndex}
                    href={button.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-8 py-3 text-lg font-bold rounded-lg shadow-2xl transition-transform hover:scale-105 bg-[var(--color-brand-blue)] text-white cursor-pointer pointer-events-auto relative z-20"
                      >
                        {button.label}
                        <ExternalLink className="w-5 h-5 ml-2 inline" aria-hidden="true" />
                      </a>
                    );
                  } else {
                    // 内部链接：使用 Link 组件
                    return (
                      <Link
                        key={btnIndex}
                        to={button.link || '/'}
                        className="inline-flex items-center px-8 py-3 text-lg font-bold rounded-lg shadow-2xl transition-transform hover:scale-105 bg-[var(--color-brand-blue)] text-white cursor-pointer pointer-events-auto relative z-20"
                  >
                    {button.label}
                      </Link>
                    );
                  }
                })}
              </div>
            )}
          </section>
        ))}
      </main>
    </div>
  );
}

export default function Home() {
  const { t } = useTranslation("home");
  const { sections, loading, error, retry } = useCmsSections();
  if (loading || error || sections.length === 0) {
    // Fixed dark backdrop, like the hero background: the transparent white-text navbar stays
    // readable when an announcement pushes this screen down.
    return <main className="min-h-screen flex items-center justify-center bg-slate-950 px-6 pt-24 text-white">
      <div aria-hidden="true" className="fixed inset-0 -z-10 bg-slate-950" />
      <div className="text-center" role={error ? "alert" : "status"} aria-live="polite">
        <p className="text-xl font-semibold">{t(loading ? "loading" : error ? "error" : "empty")}</p>
        {error && <button type="button" onClick={retry} className="mt-5 rounded-lg bg-blue-700 px-5 py-3 font-semibold text-white hover:bg-blue-800">{t("retry")}</button>}
      </div>
    </main>;
  }

  // 只有在数据准备好后才渲染使用 useScroll 的组件
  return <HomeContent sections={sections} />;
}
