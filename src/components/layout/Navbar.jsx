import { Link, useLocation } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { ASSETS } from "../../config/assets";

const LANGS = [
  { code: "zh", label: "中" },
  { code: "ja", label: "日" },
  { code: "en", label: "EN" },
];

export default function Navbar() {
  const { t, i18n } = useTranslation("common");
  const location = useLocation();
  const [showMenu, setShowMenu] = useState(false);

  const navLinks = [
    { to: "/", label: t("navbar.home") },
    { to: "/docs", label: t("navbar.docs") }
  ];

  // Determine page type: Standard pages (Docs) vs Custom Background (Home)
  const isStandardPage = location.pathname === "/docs" ||
                         location.pathname.startsWith("/docs/") ||
                         location.pathname.startsWith("/403") ||
                         location.pathname.startsWith("/404") ||
                         location.pathname.startsWith("/500") ||
                         location.pathname.startsWith("/503") ||
                         location.pathname.startsWith("/418");

  return (
    <header className="fixed top-0 w-full z-50 select-none">
      {/* Fixed height: GlobalBanner sticks at top-[56px] md:top-[64px]. */}
      <nav className={`flex items-center justify-between px-4 md:px-8 h-14 md:h-16 transition-[background-color,box-shadow] duration-300 ${
        isStandardPage
          ? "bg-white/80 backdrop-blur-md shadow-sm"
          : "bg-transparent"
      }`}>
        {/* logo区 */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <img
            src={ASSETS.IMAGES.NAV_ICON}
            alt={t("navbar.logoAlt")}
            width={30}
            height={30}
            className={isStandardPage ? "" : "drop-shadow-md"}
          />
          <span className={`font-extrabold text-xl tracking-wider hidden md:inline-block ${
            isStandardPage
              ? "text-slate-900"
              : "text-white drop-shadow-md"
          }`}>{t("navbar.siteTitle")}</span>
        </Link>
        {/* PC菜单区 */}
        <div className="hidden md:flex gap-5 items-center">
          {navLinks.map((l) => (
            <motion.div key={l.to} whileHover={{ scale: 1.12 }} whileTap={{ scale: 0.96 }}>
              <Link to={l.to} aria-current={location.pathname===l.to ? "page" : undefined} className={`px-3 py-1 rounded-lg font-medium text-base transition-colors ${
                isStandardPage
                  ? "text-slate-900 hover:text-[var(--color-brand-blue)]"
                  : "text-white drop-shadow-md hover:text-[var(--color-brand-blue)]/95"
              } ${location.pathname===l.to?"underline underline-offset-4":""}`}>{l.label}</Link>
            </motion.div>
          ))}
          {/* 语言切换 按钮组模式*/}
          <div className="flex gap-2 ml-5 select-none">
            {LANGS.map((l) => (
              <button
                type="button"
                key={l.code}
                onClick={() => i18n.changeLanguage(l.code)}
                aria-label={t(`languageNames.${l.code}`)}
                className={
                  "transition-colors text-sm font-bold px-2 py-1 rounded-md " +
                  (i18n.language === l.code ?
                    "bg-[#8ed1fc] text-white" :
                    isStandardPage ? "text-slate-900 hover:bg-[#8ed1fc]/80" : "text-white hover:bg-[#8ed1fc]/80")
                }
                disabled={i18n.language===l.code}
                style={{cursor: i18n.language===l.code? 'default' : 'pointer'}}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {/* 移动端菜单按钮 */}
        <button
          type="button"
          className="md:hidden p-2 rounded focus-visible:outline-2 focus-visible:outline-blue-600"
          onClick={()=>setShowMenu(v=>!v)}
          aria-expanded={showMenu}
          aria-controls="public-mobile-menu"
          aria-label={t(showMenu ? "navbar.closeMenu" : "navbar.openMenu")}
        >
          {showMenu ? <X size={28} className={isStandardPage ? "text-slate-900" : "text-white drop-shadow-md"} /> : <Menu size={28} className={isStandardPage ? "text-slate-900" : "text-white drop-shadow-md"} />}
        </button>
      </nav>
      <AnimatePresence>
        {showMenu && (
          <motion.div id="public-mobile-menu" initial={{y:-40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:-40,opacity:0}} className={`md:hidden absolute left-0 top-full w-full backdrop-blur-lg shadow-lg border-b z-50 ${
            isStandardPage ? "bg-white/95" : "bg-[var(--color-brand-blue)]/95"
          }`}>
            <div className="flex flex-col gap-2 py-4 px-5">
              {navLinks.map((l) => (
                <Link key={l.to} to={l.to} onClick={()=>setShowMenu(false)} aria-current={location.pathname===l.to ? "page" : undefined} className={`py-3 text-lg rounded px-3 transition mt-1 ${
                  isStandardPage
                    ? "text-slate-900 hover:text-[var(--color-brand-blue)]"
                    : "text-white drop-shadow-md hover:text-white/70"
                } ${location.pathname===l.to?"font-bold underline underline-offset-4":""}`}>{l.label}</Link>
              ))}
              {/* 移动端语言切换按钮组 */}
              <div className="flex gap-2 mt-4">
                {LANGS.map((l) => (
              <button
                    type="button"
                    key={l.code}
                    onClick={() => {i18n.changeLanguage(l.code);setShowMenu(false);}}
                    aria-label={t(`languageNames.${l.code}`)}
                    className={
                      "transition-colors text-base font-extrabold px-3 py-2 rounded-md " +
                      (i18n.language === l.code ?
                        "bg-[#8ed1fc] text-white" :
                        isStandardPage ? "text-slate-900 hover:bg-[#8ed1fc]/80" : "text-white hover:bg-[#8ed1fc]/80")
                    }
                    disabled={i18n.language===l.code}
                    style={{cursor: i18n.language===l.code? 'default' : 'pointer'}}
              >
                    {l.label}
              </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
