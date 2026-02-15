import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cancelAdminTranslationJob,
  cancelAdminTranslationJobKeepalive,
  createAdminTranslationJob,
  detectSourceLanguage,
  getAdminTranslationRuntimeConfig,
  getAdminTranslationJob,
  getAdminTranslationJobResult,
  getTargetLangs,
} from "../lib/adminTranslateApi";

const TERMINAL_JOB_STATUS = new Set([
  "succeeded",
  "partial_success",
  "failed",
  "canceled",
]);
const POLL_INTERVAL_MS = 2000;
const DEFAULT_MAX_INPUT_CHARS = 120000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function normalizeValueMap(valueMap) {
  return {
    zh: valueMap?.zh || "",
    en: valueMap?.en || "",
    ja: valueMap?.ja || "",
  };
}

function mergeTranslatedTargets(valueMap, translatedMap, targetLangs, fillEmptyOnly = true) {
  const base = normalizeValueMap(valueMap);
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

function buildTranslateGroups(fields) {
  const groups = [];
  const groupMap = new Map();
  const fieldMeta = {};

  for (const field of fields) {
    const key = `${field?.key || ""}`.trim();
    if (!key || !field?.value) continue;

    const value = normalizeValueMap(field.value);
    const sourceLang = detectSourceLanguage(value);
    if (!sourceLang) continue;

    const sourceText = `${value?.[sourceLang] || ""}`.trim();
    if (!sourceText) continue;

    const targets = getTargetLangs(sourceLang);
    if (targets.length === 0) continue;

    const groupKey = `${sourceLang}::${targets.join(",")}`;
    let group = groupMap.get(groupKey);
    if (!group) {
      group = {
        sourceLang,
        targets,
        fields: {},
      };
      groups.push(group);
      groupMap.set(groupKey, group);
    }
    group.fields[key] = sourceText;
    fieldMeta[key] = {
      sourceLang,
      targets,
    };
  }

  return {
    groups,
    fieldMeta,
  };
}

function createInitialJobState() {
  return {
    visible: false,
    jobId: "",
    status: "idle",
    percent: 0,
    groupPercent: 0,
    doneUnits: 0,
    totalUnits: 0,
    currentStage: "idle",
    currentField: "",
    currentTarget: "",
    groupIndex: 0,
    groupTotal: 0,
    startedAt: "",
    elapsedMs: 0,
    error: "",
    errors: [],
    canceling: false,
  };
}

function createCanceledError(message = "translation canceled") {
  const error = new Error(message);
  error.code = "TRANSLATION_CANCELED";
  return error;
}

function createPrecheckTooLongError(items, maxInputChars) {
  const list = Array.isArray(items) ? items : [];
  const max = Number.isFinite(maxInputChars) ? maxInputChars : DEFAULT_MAX_INPUT_CHARS;
  const details = list
    .slice(0, 4)
    .map((item) => `${item.field}[${item.source_lang}] ${item.length}`)
    .join(", ");
  const suffix = list.length > 4 ? ` ...(+${list.length - 4})` : "";
  const error = new Error(`字段长度超过限制（max ${max}）：${details}${suffix}`);
  error.code = "TRANSLATION_PRECHECK_TOO_LONG";
  error.details = list;
  error.max_input_chars = max;
  return error;
}

export function useAdminContentTranslation() {
  const [translating, setTranslating] = useState(false);
  const [fillPolicy, setFillPolicy] = useState("fill_empty_only");
  const [maxInputChars, setMaxInputChars] = useState(DEFAULT_MAX_INPUT_CHARS);
  const [translationJob, setTranslationJob] = useState(createInitialJobState);
  const activeJobRef = useRef({
    jobId: "",
    cancelRequested: false,
  });

  useEffect(() => {
    let mounted = true;
    const loadRuntimeConfig = async () => {
      const config = await getAdminTranslationRuntimeConfig();
      if (mounted) {
        setFillPolicy(config.fillPolicy);
        setMaxInputChars(config.maxInputChars);
      }
    };
    loadRuntimeConfig();
    return () => {
      mounted = false;
    };
  }, []);

  const defaultFillEmptyOnly = useMemo(
    () => fillPolicy !== "overwrite_target",
    [fillPolicy]
  );

  const resetTranslationJob = useCallback(() => {
    setTranslationJob(createInitialJobState());
  }, []);

  const closeTranslationProgress = useCallback(() => {
    setTranslationJob((prev) => ({
      ...prev,
      visible: false,
    }));
  }, []);

  const requestCancelForActiveJob = useCallback(() => {
    const jobId = activeJobRef.current.jobId;
    if (!jobId || activeJobRef.current.cancelRequested) return "";

    activeJobRef.current.cancelRequested = true;
    setTranslationJob((prev) => ({
      ...prev,
      status: prev.status === "queued" ? "queued" : "canceling",
      currentStage: "canceling",
      canceling: true,
      visible: true,
    }));
    return jobId;
  }, []);

  const cancelTranslationJob = useCallback(async () => {
    const jobId = requestCancelForActiveJob();
    if (!jobId) return;

    try {
      await cancelAdminTranslationJob(jobId);
    } catch {
      // Polling will still resolve final state.
    }
  }, [requestCancelForActiveJob]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      const jobId = requestCancelForActiveJob();
      if (jobId) {
        cancelAdminTranslationJobKeepalive(jobId);
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [requestCancelForActiveJob]);

  useEffect(() => {
    return () => {
      const jobId = requestCancelForActiveJob();
      if (jobId) {
        cancelAdminTranslationJobKeepalive(jobId);
      }
    };
  }, [requestCancelForActiveJob]);

  const pollTranslationJob = useCallback(async ({ jobId, groupIndex, groupTotal }) => {
    for (;;) {
      if (activeJobRef.current.cancelRequested && !jobId) {
        throw createCanceledError();
      }

      const payload = await getAdminTranslationJob(jobId);
      const job = payload?.job;
      if (!job) {
        throw new Error("translation job payload missing");
      }

      const groupPercent = job?.progress?.percent || 0;
      const overallPercent = groupTotal > 0
        ? Math.min(
            100,
            Math.round((((groupIndex - 1) + groupPercent / 100) / groupTotal) * 100)
          )
        : groupPercent;

      setTranslationJob((prev) => ({
        ...prev,
        visible: true,
        jobId,
        status: job.status || prev.status,
        percent: overallPercent,
        groupPercent,
        doneUnits: job?.progress?.done_units || 0,
        totalUnits: job?.progress?.total_units || 0,
        currentStage: job?.progress?.current_stage || job.status || "running",
        currentField: job?.progress?.current_field || "",
        currentTarget: job?.progress?.current_target || "",
        groupIndex,
        groupTotal,
        startedAt: job?.timing?.started_at || prev.startedAt,
        elapsedMs: job?.timing?.elapsed_ms || prev.elapsedMs,
        error: job?.error?.message || "",
        errors: Array.isArray(job?.errors) ? job.errors : [],
        canceling: job.status === "canceling",
      }));

      if (TERMINAL_JOB_STATUS.has(`${job.status || ""}`)) {
        return job;
      }

      await sleep(POLL_INTERVAL_MS);
    }
  }, []);

  const translateFields = useCallback(
    async ({ scene = "admin", fields = [], fillEmptyOnly } = {}) => {
      const safeFields = Array.isArray(fields) ? fields : [];
      const sourceValueMap = {};
      for (const field of safeFields) {
        if (!field?.key) continue;
        sourceValueMap[field.key] = normalizeValueMap(field.value);
      }

      const { groups, fieldMeta } = buildTranslateGroups(safeFields);
      if (groups.length === 0) {
        return {
          changedCount: 0,
          fields: sourceValueMap,
          partial: false,
          canceled: false,
          errors: [],
        };
      }

      let runtimeMaxInputChars = maxInputChars;
      try {
        const runtimeConfig = await getAdminTranslationRuntimeConfig();
        if (runtimeConfig?.maxInputChars) {
          runtimeMaxInputChars = runtimeConfig.maxInputChars;
          setMaxInputChars(runtimeConfig.maxInputChars);
        }
        if (runtimeConfig?.fillPolicy) {
          setFillPolicy(runtimeConfig.fillPolicy);
        }
      } catch {
        // Fallback to local state.
      }

      const tooLongItems = [];
      for (const field of safeFields) {
        const key = `${field?.key || ""}`.trim();
        if (!key) continue;
        const value = normalizeValueMap(field.value);
        const sourceLang = detectSourceLanguage(value);
        if (!sourceLang) continue;
        const sourceText = `${value?.[sourceLang] || ""}`.trim();
        if (!sourceText) continue;
        if (sourceText.length > runtimeMaxInputChars) {
          tooLongItems.push({
            field: key,
            source_lang: sourceLang,
            length: sourceText.length,
          });
        }
      }
      if (tooLongItems.length > 0) {
        throw createPrecheckTooLongError(tooLongItems, runtimeMaxInputChars);
      }

      setTranslating(true);
      activeJobRef.current.cancelRequested = false;
      setTranslationJob(() => ({
        ...createInitialJobState(),
        visible: true,
        status: "queued",
        currentStage: "queued",
        groupIndex: 1,
        groupTotal: groups.length,
      }));

      const translatedByField = {};
      const jobErrors = [];

      try {
        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index];
          const groupIndex = index + 1;
          if (activeJobRef.current.cancelRequested) {
            throw createCanceledError();
          }

          const createResult = await createAdminTranslationJob({
            scene,
            sourceLang: group.sourceLang,
            targets: group.targets,
            fields: group.fields,
          });

          const jobId = createResult?.job_id;
          if (!jobId) {
            throw new Error("translation job id missing");
          }

          activeJobRef.current.jobId = jobId;
          setTranslationJob((prev) => ({
            ...prev,
            visible: true,
            jobId,
            status: createResult.status || "queued",
            currentStage: createResult.status || "queued",
            groupIndex,
            groupTotal: groups.length,
            doneUnits: createResult?.progress?.done_units || 0,
            totalUnits: createResult?.progress?.total_units || 0,
            percent: Math.round(((groupIndex - 1) / groups.length) * 100),
            groupPercent: 0,
            error: "",
            errors: [],
          }));

          const finalJob = await pollTranslationJob({
            jobId,
            groupIndex,
            groupTotal: groups.length,
          });

          if (finalJob.status === "canceled") {
            throw createCanceledError();
          }

          const resultPayload = await getAdminTranslationJobResult(jobId).catch(() => null);
          const fieldTranslations =
            resultPayload?.translations && typeof resultPayload.translations === "object"
              ? resultPayload.translations
              : finalJob?.partial_result || {};

          for (const [fieldKey, translatedMap] of Object.entries(fieldTranslations)) {
            translatedByField[fieldKey] = {
              ...(translatedByField[fieldKey] || {}),
              ...(translatedMap || {}),
            };
          }

          if (Array.isArray(resultPayload?.errors) && resultPayload.errors.length > 0) {
            jobErrors.push(...resultPayload.errors);
          }
          if (finalJob.status === "failed") {
            jobErrors.push({
              code: finalJob?.error?.code || "JOB_FAILED",
              message: finalJob?.error?.message || "translation job failed",
            });
          }
        }

        const finalFillEmptyOnly =
          typeof fillEmptyOnly === "boolean" ? fillEmptyOnly : defaultFillEmptyOnly;
        const mergedFields = {};
        let changedCount = 0;

        for (const field of safeFields) {
          if (!field?.key) continue;
          const key = field.key;
          const sourceValue = sourceValueMap[key] || normalizeValueMap(field.value);
          const meta = fieldMeta[key];
          if (!meta) {
            mergedFields[key] = sourceValue;
            continue;
          }
          const merged = mergeTranslatedTargets(
            sourceValue,
            translatedByField[key] || {},
            meta.targets,
            finalFillEmptyOnly
          );
          mergedFields[key] = merged.value;
          if (merged.changed) changedCount += 1;
        }

        setTranslationJob((prev) => ({
          ...prev,
          visible: true,
          status: jobErrors.length > 0 ? "partial_success" : "succeeded",
          currentStage: jobErrors.length > 0 ? "partial_success" : "succeeded",
          percent: 100,
          groupPercent: 100,
          canceling: false,
          errors: jobErrors,
          error: "",
        }));

        return {
          changedCount,
          fields: mergedFields,
          partial: jobErrors.length > 0,
          canceled: false,
          errors: jobErrors,
        };
      } catch (error) {
        const canceled =
          error?.code === "TRANSLATION_CANCELED" ||
          activeJobRef.current.cancelRequested;

        setTranslationJob((prev) => ({
          ...prev,
          visible: true,
          status: canceled ? "canceled" : "failed",
          currentStage: canceled ? "canceled" : "failed",
          canceling: false,
          error: canceled ? "translation canceled" : error?.message || "translation failed",
        }));

        if (canceled) {
          throw createCanceledError();
        }
        throw error;
      } finally {
        setTranslating(false);
        activeJobRef.current.jobId = "";
      }
    },
    [defaultFillEmptyOnly, maxInputChars, pollTranslationJob]
  );

  return {
    translating,
    fillPolicy,
    maxInputChars,
    translationJob,
    translateFields,
    cancelTranslationJob,
    closeTranslationProgress,
    resetTranslationJob,
  };
}

export default useAdminContentTranslation;
