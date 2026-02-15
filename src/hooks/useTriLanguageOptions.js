import { useMemo } from "react";
import { useTranslation } from "react-i18next";

export function useTriLanguageOptions() {
  const { t, i18n } = useTranslation();

  return useMemo(
    () => [
      { code: "zh", label: t("common.languageNames.zh") },
      { code: "en", label: t("common.languageNames.en") },
      { code: "ja", label: t("common.languageNames.ja") },
    ],
    [i18n.language, t]
  );
}

export default useTriLanguageOptions;
