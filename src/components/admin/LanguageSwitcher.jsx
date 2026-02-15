import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Languages } from "lucide-react";
import ContentSecondaryButton from "./content/ContentSecondaryButton";

export default function LanguageSwitcher() {
    const { t, i18n } = useTranslation("common");
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const menuId = "admin-language-menu";

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const changeLanguage = (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem("i18nextLng", lng);
    setOpen(false);
  };

  const languages = [
    { code: "zh", label: t("languageNames.zh") },
    { code: "en", label: t("languageNames.en") },
    { code: "ja", label: t("languageNames.ja") },
  ];
  const activeLanguageCode = i18n.language?.split("-")[0] || "en";

  return (
    <div ref={containerRef} className="relative">
      <ContentSecondaryButton
        type="button"
        variant="solid"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="flex items-center gap-2 px-3 py-2 bg-transparent text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-blue)]/30"
      >
        <Languages className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">
          {languages.find((l) => l.code === activeLanguageCode)?.label || t("languageNames.en")}
        </span>
      </ContentSecondaryButton>

      <div
        id={menuId}
        role="menu"
        aria-hidden={!open}
        className={`absolute right-0 mt-2 w-32 bg-white rounded-lg shadow-lg border border-slate-100 py-1 z-50 transition-[opacity,visibility,transform] duration-200 ${open ? "opacity-100 visible translate-y-0" : "opacity-0 invisible -translate-y-1"}`}
      >
        {languages.map((lang) => (
          <ContentSecondaryButton
            key={lang.code}
            type="button"
            variant="solid"
            role="menuitemradio"
            aria-checked={activeLanguageCode === lang.code}
            onClick={() => changeLanguage(lang.code)}
            className={`w-full rounded-none bg-transparent text-left px-4 py-2 text-sm transition-colors ${
              activeLanguageCode === lang.code
                ? "text-[var(--color-brand-blue)] font-semibold bg-[var(--color-brand-blue)]/10 hover:bg-[var(--color-brand-blue)]/15"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            {lang.label}
          </ContentSecondaryButton>
        ))}
      </div>
    </div>
  );
}
