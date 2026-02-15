import { useCallback, useEffect, useMemo, useState } from "react";
import {
  detectSourceLanguage,
  getTargetLangs,
  getAdminTranslationFillPolicy,
  requestAdminTranslation,
} from "../lib/adminTranslateApi";

function mergeTranslatedTargets(valueMap, translatedMap, targetLangs, fillEmptyOnly = true) {
  const base = {
    zh: valueMap?.zh || "",
    en: valueMap?.en || "",
    ja: valueMap?.ja || "",
  };
  let changed = false;

  for (const lang of targetLangs) {
    const translated = translatedMap?.[lang];
    if (typeof translated !== "string") continue;
    if (fillEmptyOnly && `${base[lang] || ""}`.trim()) continue;
    base[lang] = translated;
    changed = true;
  }

  return {
    value: base,
    changed,
  };
}

export function useAdminContentTranslation() {
  const [translating, setTranslating] = useState(false);
  const [fillPolicy, setFillPolicy] = useState("fill_empty_only");

  useEffect(() => {
    let mounted = true;
    const loadPolicy = async () => {
      const policy = await getAdminTranslationFillPolicy();
      if (mounted) {
        setFillPolicy(policy);
      }
    };
    loadPolicy();
    return () => {
      mounted = false;
    };
  }, []);

  const defaultFillEmptyOnly = useMemo(
    () => fillPolicy !== "overwrite_target",
    [fillPolicy]
  );

  const translateField = useCallback(
    async ({
      scene = "admin",
      fieldName = "content",
      value,
      fillEmptyOnly,
      targets,
    }) => {
      const sourceLang = detectSourceLanguage(value);
      if (!sourceLang) {
        return {
          changed: false,
          sourceLang: "",
          targets: [],
          value: {
            zh: value?.zh || "",
            en: value?.en || "",
            ja: value?.ja || "",
          },
        };
      }

      const sourceText = `${value?.[sourceLang] || ""}`.trim();
      if (!sourceText) {
        return {
          changed: false,
          sourceLang,
          targets: [],
          value: {
            zh: value?.zh || "",
            en: value?.en || "",
            ja: value?.ja || "",
          },
        };
      }

      const targetLangs =
        Array.isArray(targets) && targets.length
          ? targets
          : getTargetLangs(sourceLang);
      if (targetLangs.length === 0) {
        return {
          changed: false,
          sourceLang,
          targets: [],
          value: {
            zh: value?.zh || "",
            en: value?.en || "",
            ja: value?.ja || "",
          },
        };
      }

      const response = await requestAdminTranslation({
        scene,
        sourceLang,
        targets: targetLangs,
        fields: {
          [fieldName]: sourceText,
        },
      });

      const translatedMap = response?.translations?.[fieldName] || {};
      const finalFillEmptyOnly =
        typeof fillEmptyOnly === "boolean"
          ? fillEmptyOnly
          : defaultFillEmptyOnly;
      const merged = mergeTranslatedTargets(
        value,
        translatedMap,
        targetLangs,
        finalFillEmptyOnly
      );

      return {
        changed: merged.changed,
        sourceLang,
        targets: targetLangs,
        value: merged.value,
      };
    },
    [defaultFillEmptyOnly]
  );

  const translateFields = useCallback(
    async ({ scene = "admin", fields = [], fillEmptyOnly } = {}) => {
      setTranslating(true);
      try {
        const next = {};
        let changedCount = 0;

        for (const field of fields) {
          if (!field?.key || !field?.value) continue;
          const result = await translateField({
            scene,
            fieldName: field.key,
            value: field.value,
            fillEmptyOnly,
          });
          next[field.key] = result.value;
          if (result.changed) changedCount += 1;
        }

        return {
          changedCount,
          fields: next,
        };
      } finally {
        setTranslating(false);
      }
    },
    [translateField]
  );

  return {
    translating,
    fillPolicy,
    translateField,
    translateFields,
  };
}

export default useAdminContentTranslation;
