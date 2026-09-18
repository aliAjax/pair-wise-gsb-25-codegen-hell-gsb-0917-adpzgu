import { useMemo, useState, type ReactNode } from "react";
import type {
  Category,
  Eye,
  EyeRx,
  InitialDraft,
  Patient,
  PrescriptionPair,
  RxField,
  VersionDraft,
} from "./types";
import {
  CATEGORIES,
  CHANGE_THRESHOLD,
  axisError,
  diffChanges,
  formatAxis,
  formatD,
  isQuarterStep,
  parseNumeric,
  thresholdText,
  todayISO,
} from "./domain";

interface EyeInput {
  sphere: string;
  cylinder: string;
  axis: string;
  correctedVA: string;
}

interface FormState {
  code: string;
  name: string;
  examDate: string;
  optometrist: string;
  category: Category;
  pd: string;
  note: string;
  OD: EyeInput;
  OS: EyeInput;
}

type FormMode = { type: "initial" } | { type: "followup"; patient: Patient };

interface Props {
  mode: FormMode;
  onSubmitInitial: (draft: InitialDraft) => string | null;
  onSubmitFollowup: (patientId: string, draft: VersionDraft) => void;
  onCancel: () => void;
}

function eyeFromRx(rx: EyeRx): EyeInput {
  return {
    sphere: formatD(rx.sphere),
    cylinder: formatD(rx.cylinder),
    axis: rx.axis === null ? "" : String(rx.axis),
    correctedVA: rx.correctedVA,
  };
}

function initialState(mode: FormMode): FormState {
  if (mode.type === "initial") {
    return {
      code: "",
      name: "",
      examDate: todayISO(),
      optometrist: "",
      category: "儿童",
      pd: "",
      note: "",
      OD: eyeFromRx({ sphere: 0, cylinder: 0, axis: null, correctedVA: "" }),
      OS: eyeFromRx({ sphere: 0, cylinder: 0, axis: null, correctedVA: "" }),
    };
  }
  const last = mode.patient.versions[mode.patient.versions.length - 1];
  return {
    code: mode.patient.code,
    name: mode.patient.name,
    examDate: todayISO(),
    optometrist: last.optometrist,
    category: last.category,
    pd: last.pd === null ? "" : String(last.pd),
    note: "",
    OD: eyeFromRx(last.rx.OD),
    OS: eyeFromRx(last.rx.OS),
  };
}

interface EyeErrors {
  sphere?: string;
  cylinder?: string;
  axis?: string;
}

function validateEye(input: EyeInput): { errors: EyeErrors; rx: EyeRx | null } {
  const errors: EyeErrors = {};
  const sphere = parseNumeric(input.sphere);
  if (sphere === null) errors.sphere = "请填写球镜";
  else if (!isQuarterStep(sphere)) errors.sphere = "球镜须为 0.25D 的整数倍";
  else if (Math.abs(sphere) > 30) errors.sphere = "球镜超出合理范围（±30D）";

  const cylinder = parseNumeric(input.cylinder);
  if (cylinder === null) errors.cylinder = "请填写柱镜，无散光填 0";
  else if (!isQuarterStep(cylinder)) errors.cylinder = "柱镜须为 0.25D 的整数倍";
  else if (Math.abs(cylinder) > 10) errors.cylinder = "柱镜超出合理范围（±10D）";

  const cylActive = cylinder !== null && cylinder !== 0;
  const axisMsg = axisError(input.axis, cylActive);
  if (axisMsg) errors.axis = axisMsg;

  if (Object.keys(errors).length > 0) return { errors, rx: null };
  const axis = cylActive && input.axis.trim() ? Number(input.axis) : null;
  return {
    errors,
    rx: {
      sphere: sphere as number,
      cylinder: cylinder as number,
      axis,
      correctedVA: input.correctedVA.trim(),
    },
  };
}

const DIOPTOR_HINT = "步长 0.25D，如 -2.75";

export default function RxForm({ mode, onSubmitInitial, onSubmitFollowup, onCancel }: Props) {
  const prev =
    mode.type === "followup"
      ? mode.patient.versions[mode.patient.versions.length - 1]
      : null;

  const [form, setForm] = useState<FormState>(() => initialState(mode));
  const [reasons, setReasons] = useState<Partial<Record<`${Eye}.${RxField}`, string>>>({});
  const [attempted, setAttempted] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const odValidation = useMemo(() => validateEye(form.OD), [form.OD]);
  const osValidation = useMemo(() => validateEye(form.OS), [form.OS]);
  const metaErrors = useMemo(() => {
    const e: { examDate?: string; optometrist?: string; code?: string; name?: string; pd?: string } = {};
    if (!form.examDate) e.examDate = "请选择检查日期";
    if (!form.optometrist.trim()) e.optometrist = "请填写验光师";
    if (!form.pd.trim()) {
      // 允许不填
    } else {
      const pd = parseNumeric(form.pd);
      if (pd === null || pd < 40 || pd > 80) e.pd = "瞳距应在 40-80mm 之间";
    }
    if (mode.type === "initial") {
      if (!form.code.trim()) e.code = "请填写患者编号";
      if (!form.name.trim()) e.name = "请填写患者姓名";
    }
    return e;
  }, [form, mode]);

  const rxValid = odValidation.rx !== null && osValidation.rx !== null;
  const nextRx: PrescriptionPair | null =
    rxValid && odValidation.rx && osValidation.rx
      ? { OD: odValidation.rx, OS: osValidation.rx }
      : null;

  const changes = useMemo(() => {
    if (!prev || !nextRx) return [];
    return diffChanges(prev.rx, nextRx, reasons);
  }, [prev, nextRx, reasons]);

  const missingReasonKeys = new Set(
    changes.filter((c) => c.entry.exceedsThreshold && !c.entry.reason).map((c) => c.reasonKey),
  );

  function setEye(eye: Eye, patch: Partial<EyeInput>) {
    setForm((f) => ({ ...f, [eye]: { ...f[eye], ...patch } }));
  }

  function buildDraft(): VersionDraft {
    return {
      examDate: form.examDate,
      optometrist: form.optometrist,
      category: form.category,
      pd: form.pd.trim() ? (parseNumeric(form.pd) as number) : null,
      note: form.note,
      rx: nextRx as PrescriptionPair,
      reasons,
    };
  }

  function handleSubmit() {
    setBanner(null);
    setAttempted(true);
    if (Object.keys(metaErrors).length > 0 || !nextRx) {
      setBanner("表单存在校验错误，请修正后再提交。");
      return;
    }
    if (missingReasonKeys.size > 0) {
      setBanner(`有 ${missingReasonKeys.size} 项变化超过 ${CHANGE_THRESHOLD}，必须填写变更原因后才能提交。`);
      return;
    }
    try {
      if (mode.type === "initial") {
        const draft: InitialDraft = { ...buildDraft(), code: form.code.trim(), name: form.name.trim() };
        const err = onSubmitInitial(draft);
        if (err) setBanner(err);
      } else {
        onSubmitFollowup(mode.patient.id, buildDraft());
      }
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "提交失败");
    }
  }

  const title =
    mode.type === "initial"
      ? "新增患者 · 初配处方（v1）"
      : `复查处方 · ${mode.patient.name}（${mode.patient.code}）`;

  return (
    <section className="panel rx-form">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{mode.type === "followup" ? `继承自 v${prev?.version} 处方` : "新建档案"}</p>
          <h2>{title}</h2>
        </div>
        <button onClick={onCancel}>取消</button>
      </div>

      {mode.type === "followup" && prev && (
        <div className="inherit-banner">
          本次复查默认继承 <strong>v{prev.version}</strong>（{prev.examDate}）全部处方参数，修改任一字段将在下方生成差异；
          球镜/柱镜/轴位变化 <strong>&gt; 0.50</strong> 必须填写变更原因。
        </div>
      )}

      {attempted && banner && <div className="form-banner">{banner}</div>}

      <div className="form-meta-grid">
        {mode.type === "initial" && (
          <>
            <FieldError label="患者编号" error={attempted ? metaErrors.code : undefined}>
              <input
                value={form.code}
                placeholder="如 Patient-201"
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
              />
            </FieldError>
            <FieldError label="姓名" error={attempted ? metaErrors.name : undefined}>
              <input
                value={form.name}
                placeholder="患者姓名"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </FieldError>
          </>
        )}
        <FieldError label="检查日期" error={attempted ? metaErrors.examDate : undefined}>
          <input
            type="date"
            value={form.examDate}
            onChange={(e) => setForm((f) => ({ ...f, examDate: e.target.value }))}
          />
        </FieldError>
        <FieldError label="验光师" error={attempted ? metaErrors.optometrist : undefined}>
          <input
            value={form.optometrist}
            placeholder="验光师姓名"
            onChange={(e) => setForm((f) => ({ ...f, optometrist: e.target.value }))}
          />
        </FieldError>
        <label>
          <span>分类</span>
          <select
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <FieldError label="瞳距（mm，可不填）" error={attempted ? metaErrors.pd : undefined}>
          <input
            value={form.pd}
            placeholder="如 60"
            onChange={(e) => setForm((f) => ({ ...f, pd: e.target.value }))}
          />
        </FieldError>
      </div>

      <div className="eye-grid">
        {(["OD", "OS"] as Eye[]).map((eye) => {
          const validation = eye === "OD" ? odValidation : osValidation;
          const input = form[eye];
          const prevEye = prev?.rx[eye];
          const cylParsed = parseNumeric(input.cylinder);
          const axisLocked = cylParsed === 0;
          return (
            <article key={eye} className="eye-card">
              <h3>{eye === "OD" ? "右眼 OD" : "左眼 OS"}</h3>
              <div className="eye-fields">
                <DiopterInput
                  label="球镜（DS）"
                  hint={DIOPTOR_HINT}
                  value={input.sphere}
                  oldText={prevEye ? `${formatD(prevEye.sphere)}D` : undefined}
                  error={attempted ? validation.errors.sphere : undefined}
                  onChange={(v) => setEye(eye, { sphere: v })}
                />
                <DiopterInput
                  label="柱镜（DC）"
                  hint={DIOPTOR_HINT + "，无散光填 0"}
                  value={input.cylinder}
                  oldText={prevEye ? `${formatD(prevEye.cylinder)}D` : undefined}
                  error={attempted ? validation.errors.cylinder : undefined}
                  onChange={(v) => setEye(eye, { cylinder: v })}
                />
                <FieldError
                  label="轴位（0-180 度整数）"
                  error={attempted ? validation.errors.axis : undefined}
                >
                  <input
                    type="number"
                    min={0}
                    max={180}
                    step={1}
                    disabled={axisLocked}
                    value={input.axis}
                    placeholder={axisLocked ? "无散光，不需轴位" : "0-180"}
                    onChange={(e) => setEye(eye, { axis: e.target.value })}
                  />
                  {prevEye && (
                    <small className="old-hint">上次：{formatAxis(prevEye.axis)}</small>
                  )}
                </FieldError>
                <label>
                  <span>矫正视力</span>
                  <input
                    value={input.correctedVA}
                    placeholder="如 5.0"
                    onChange={(e) => setEye(eye, { correctedVA: e.target.value })}
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>

      {mode.type === "followup" && (
        <div className="change-panel">
          <h3>
            处方差异
            {changes.length > 0 && <span className="change-count">{changes.length} 项</span>}
          </h3>
          {!nextRx && <p className="muted">完成屈光参数校验后显示差异。</p>}
          {nextRx && changes.length === 0 && (
            <p className="muted">本次复查参数与上次完全一致，无差异，可直接提交为新版本。</p>
          )}
          <div className="change-list">
            {changes.map(({ entry, reasonKey }) => (
              <div
                key={reasonKey}
                className={entry.exceedsThreshold ? "change-item exceeds" : "change-item"}
              >
                <div className="change-head">
                  <strong>{entry.label}</strong>
                  <span className="change-flow">
                    {entry.fromText} → {entry.toText}
                    <em>{entry.deltaText}</em>
                  </span>
                  {entry.exceedsThreshold ? (
                    <span className="badge-danger">超过 {thresholdText(entry.field)} · 必填原因</span>
                  ) : (
                    <span className="badge-ok">≤ {thresholdText(entry.field)}</span>
                  )}
                </div>
                {entry.exceedsThreshold && (
                  <textarea
                    className={
                      attempted && missingReasonKeys.has(reasonKey)
                        ? "reason-input invalid"
                        : "reason-input"
                    }
                    rows={2}
                    placeholder="填写本次调整原因，如：眼轴增长、交叉柱镜精调、患者主诉不适等"
                    value={reasons[reasonKey] ?? ""}
                    onChange={(e) =>
                      setReasons((r) => ({ ...r, [reasonKey]: e.target.value }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <label className="note-field">
        <span>备注</span>
        <textarea
          rows={2}
          value={form.note}
          placeholder="主诉、处理建议、复查提醒等"
          onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
        />
      </label>

      <div className="form-actions">
        <button onClick={onCancel}>取消</button>
        <button className="primary-action" onClick={handleSubmit}>
          {mode.type === "initial" ? "提交初配处方（v1）" : `提交复查，生成 v${(prev?.version ?? 1) + 1} 新版本`}
        </button>
      </div>
    </section>
  );
}

function FieldError({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <label className={error ? "field-error" : undefined}>
      <span>{label}</span>
      {children}
      {error && <small className="error-text">{error}</small>}
    </label>
  );
}

function DiopterInput({
  label,
  hint,
  value,
  oldText,
  error,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  oldText?: string;
  error?: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldError label={label} error={error}>
      <input
        type="number"
        step={0.25}
        value={value}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
      />
      {oldText && <small className="old-hint">上次：{oldText}</small>}
    </FieldError>
  );
}
