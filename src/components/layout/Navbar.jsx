import { Link, useLocation } from "react-router-dom";
import { Menu, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useState } from "react";
import { ASSETS } from "../../config/assets";

const LANGS = [{ code: "zh", label: "中" }, { code: "ja", label: "日" }, { code: "en", label: "EN" }];

export default function Navbar() {
  const { t, i18n } = useTranslation("common");
  const { pathname } = useLocation();
  const [showMenu, setShowMenu] = useState(false);
  const links = [{ to: "/", label: t("navbar.home") }, { to: "/docs", label: t("navbar.docs") }];
  const renderLinks = () => links.map(({ to, label }) => (
    <Link key={to} to={to} onClick={() => setShowMenu(false)} aria-current={pathname === to ? "page" : undefined}
      className={`px-3 py-2 rounded-lg font-medium text-slate-900 hover:bg-slate-100 ${pathname === to ? "underline underline-offset-4" : ""}`}>{label}</Link>
  ));
  const renderLanguages = () => LANGS.map(({ code, label }) => (
    <button type="button" key={code} disabled={i18n.language === code} aria-label={t(`languageNames.${code}`)}
      onClick={() => { i18n.changeLanguage(code); setShowMenu(false); }}
      className={`px-3 py-2 rounded-md text-sm font-bold text-slate-900 ${i18n.language === code ? "bg-[#8ed1fc]" : "hover:bg-slate-100"}`}>{label}</button>
  ));
  // The existing docs palette provides consistent contrast over every home state.
  return <header className="fixed top-0 w-full z-50 select-none">
    <nav className="flex items-center justify-between px-4 md:px-8 h-14 md:h-16 bg-white/95 backdrop-blur-md shadow-sm">
      <Link to="/" className="flex items-center gap-2 shrink-0">
        <img src={ASSETS.IMAGES.NAV_ICON} alt={t("navbar.logoAlt")} width={30} height={30} />
        <span className="font-extrabold text-xl tracking-wider hidden md:inline-block text-slate-900">{t("navbar.siteTitle")}</span>
      </Link>
      <div className="hidden md:flex gap-5 items-center">{renderLinks()}<div className="flex gap-2">{renderLanguages()}</div></div>
      <button type="button" className="md:hidden p-2 rounded text-slate-900 focus-visible:outline-2 focus-visible:outline-blue-600"
        onClick={() => setShowMenu((open) => !open)} aria-expanded={showMenu} aria-controls="public-mobile-menu"
        aria-label={t(showMenu ? "navbar.closeMenu" : "navbar.openMenu")}>
        {showMenu ? <X size={28} /> : <Menu size={28} />}
      </button>
    </nav>
    {showMenu && <div id="public-mobile-menu" className="md:hidden absolute top-full w-full bg-white shadow-lg border-b">
      <div className="flex flex-col gap-2 py-4 px-5">{renderLinks()}<div className="flex gap-2">{renderLanguages()}</div></div>
    </div>}
  </header>;
}
