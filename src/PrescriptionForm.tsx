import { useMemo, useState } from "react";
import type { EyeRx, EyeSide, FieldChange, RxField, RxVersion, VisionInfo } from "./types";
import {
  AXIS_MAX,
  AXIS_MIN,
  EYE_LABEL,
  FIELD_ORDER,
  FIELD_RULES,
  changeMagnitude,
  draftChanges,
  formatDelta,
  formatRxValue,
} from "./rules";

export interface RxPayload {
  patientName: string;
  category: string;
  right: EyeRx;
  left: EyeRx;
  vision: Record<EyeSide, VisionInfo>;
  pd: number | null;
  changes: FieldChange[];
  note: string;
}

interface FormProps {
  mode: { kind: "initial" } | { kind: "review"; base: RxVersion };
  categories: string[];
  onCancel: () => void;
  onSubmit: (payload: RxPayload) => void;
}

type EyeForm = Record<RxField, string>;
type VisionForm = Record<"unaided" | "corrected", string>;

const emptyEye = (): EyeForm => ({ sphere: "", cylinder: "", axis: "" });
const eyeFromRx = (rx: EyeRx): EyeForm => ({
  sphere: rx.sphere.toFixed(2),
  cylinder: rx.cylinder.toFixed(2),
  axis: String(rx.axis),
});
const reasonKey = (eye: EyeSide, field: RxField) => `${eye}.${field}`;

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function PrescriptionForm({ mode, categories, onCancel, onSubmit }: FormProps) {
  const isReview = mode.kind === "review";
  const base = isReview ? mode.base : undefined;

  const [name, setName] = useState(base?.patientName ?? "");
  const [category, setCategory] = useState(base?.category ?? "儿童近视");
  const [right, setRight] = useState<EyeForm>(base ? eyeFromRx(base.right) : emptyEye());
  const [left, setLeft] = useState<EyeForm>(base ? eyeFromRx(base.left) : emptyEye());
  const [vision, setVision] = useState<Record<EyeSide, VisionForm>>({
    OD: { unaided: base?.vision.OD.unaided ?? "", corrected: base?.vision.OD.corrected ?? "" },
    OS: { unaided: base?.vision.OS.unaided ?? "", corrected: base?.vision.OS.corrected ?? "" },
  });
  const [pd, setPd] = useState(base ? (base.pd == null ? "" : String(base.pd)) : "");
  const [note, setNote] = useState("");
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [triedSubmit, setTriedSubmit] = useState(false);

  const setEyeField = (eye: EyeSide, field: RxField, value: string) => {
    const setter = eye === "OD" ? setRight : setLeft;
    setter((prev) => ({ ...prev, [field]: value }));
  };

  /** 实时解析 + 校验单个数值字段 */
  const parsedField = (eye: EyeSide, field: RxField): { value: number | null; error: string | null } => {
    const raw = (eye === "OD" ? right : left)[field];
    if (raw.trim() === "") return { value: null, error: "必填" };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { value: null, error: "请输入数字" };
    if (field === "axis") {
      if (!Number.isInteger(n)) return { value: null, error: "轴位必须为整数" };
      if (n < AXIS_MIN || n > AXIS_MAX) return { value: null, error: "轴位只允许 0-180 度" };
      return { value: n, error: null };
    }
    if (n < -20 || n > 20) return { value: null, error: "范围 -20.00 ~ +20.00D" };
    if (Math.round(n * 4) !== n * 4) return { value: null, error: "须为 0.25D 的整数倍" };
    return { value: Math.round(n * 100) / 100, error: null };
  };

  const eyesParsed = useMemo(() => {
    const result: Record<EyeSide, { rx: EyeRx | null; fieldError: Record<RxField, string | null> }> = {
      OD: { rx: null, fieldError: { sphere: null, cylinder: null, axis: null } },
      OS: { rx: null, fieldError: { sphere: null, cylinder: null, axis: null } },
    };
    (["OD", "OS"] as EyeSide[]).forEach((eye) => {
      const parts = FIELD_ORDER.map((f) => parsedField(eye, f));
      FIELD_ORDER.forEach((f, i) => (result[eye].fieldError[f] = parts[i].error));
      if (parts.every((p) => p.value != null)) {
        result[eye].rx = { sphere: parts[0].value!, cylinder: parts[1].value!, axis: parts[2].value! };
      }
    });
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [right, left]);

  /** 实时算出超阈值变更（仅复查、且 6 个数值全部合法时） */
  const pendingChanges = useMemo(() => {
    if (!isReview || !base || !eyesParsed.OD.rx || !eyesParsed.OS.rx) return [];
    return draftChanges(
      { right: base.right, left: base.left },
      { right: eyesParsed.OD.rx, left: eyesParsed.OS.rx }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eyesParsed, isReview, base]);

  const breachKeys = new Set(pendingChanges.map((c) => reasonKey(c.eye, c.field)));

  const liveError = (key: string): string | undefined => (triedSubmit ? errors[key] : undefined);

  const handleSubmit = () => {
    setTriedSubmit(true);
    const nextErrors: Record<string, string> = {};

    if (!isReview) {
      if (name.trim().length < 2) nextErrors["name"] = "请填写患者姓名（至少 2 个字）";
      if (!category.trim()) nextErrors["category"] = "请选择分类";
    }
    (["OD", "OS"] as EyeSide[]).forEach((eye) => {
      FIELD_ORDER.forEach((f) => {
        const e = eyesParsed[eye].fieldError[f];
        if (e) nextErrors[reasonKey(eye, f)] = e;
      });
      (["unaided", "corrected"] as const).forEach((vk) => {
        if (!vision[eye][vk].trim()) nextErrors[`${eye}.${vk}`] = "必填";
      });
    });
    if (pd.trim() !== "") {
      const pdNum = Number(pd);
      if (!Number.isFinite(pdNum) || pdNum < 40 || pdNum > 80) nextErrors["pd"] = "瞳距应在 40-80mm 之间";
    }
    pendingChanges.forEach((c) => {
      const k = reasonKey(c.eye, c.field);
      const r = (reasons[k] ?? "").trim();
      if (r.length < 5) nextErrors[k + ".reason"] = `${EYE_LABEL[c.eye]}${FIELD_RULES[c.field].label}变化超过 ${FIELD_RULES[c.field].threshold}${FIELD_RULES[c.field].unit}，必须填写变更原因（至少 5 个字）`;
    });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const changes: FieldChange[] = pendingChanges.map((c) => ({
      ...c,
      reason: reasons[reasonKey(c.eye, c.field)].trim(),
    }));

    onSubmit({
      patientName: isReview ? base!.patientName : name.trim(),
      category: isReview ? base!.category : category.trim(),
      right: eyesParsed.OD.rx!,
      left: eyesParsed.OS.rx!,
      vision: {
        OD: { unaided: vision.OD.unaided.trim(), corrected: vision.OD.corrected.trim() },
        OS: { unaided: vision.OS.unaided.trim(), corrected: vision.OS.corrected.trim() },
      },
      pd: pd.trim() === "" ? null : Math.round(Number(pd) * 2) / 2,
      changes,
      note: note.trim(),
    });
  };

  const renderEyePanel = (eye: EyeSide) => {
    const prevRx = base ? (eye === "OD" ? base.right : base.left) : null;
    const cur = eye === "OD" ? right : left;
    return (
      <div className="eye-panel" key={eye}>
        <h3>{EYE_LABEL[eye]}</h3>
        {FIELD_ORDER.map((field) => {
          const k = reasonKey(eye, field);
          const breached = breachKeys.has(k);
          const parsed = parsedField(eye, field);
          const draft = pendingChanges.find((c) => c.eye === eye && c.field === field);
          let badge: { text: string; cls: string } | null = null;
          if (isReview && prevRx && parsed.value != null) {
            const mag = changeMagnitude(field, prevRx[field], parsed.value);
            if (mag === 0) badge = { text: "未变化", cls: "delta-same" };
            else if (breached && draft) badge = { text: formatDelta(field, prevRx[field], parsed.value), cls: "delta-breach" };
            else badge = { text: formatDelta(field, prevRx[field], parsed.value), cls: "delta-minor" };
          }
          return (
            <div className={`rx-row ${breached ? "is-breached" : ""}`} key={field}>
              <label className="rx-field">
                <span>
                  {FIELD_RULES[field].label}
                  <em>
                    {field === "axis"
                      ? `整数 · ${AXIS_MIN}-${AXIS_MAX}°`
                      : `D · 步进 0.25`}
                  </em>
                </span>
                <div className="rx-input-line">
                  {isReview && prevRx && <i className="old-value">{formatRxValue(field, prevRx[field])} →</i>}
                  <input
                    value={cur[field]}
                    onChange={(e) => setEyeField(eye, field, e.target.value)}
                    inputMode="decimal"
                    placeholder={FIELD_RULES[field].unit === "D" ? "-2.00" : "0-180"}
                    aria-invalid={Boolean(liveError(k))}
                  />
                  {badge && <span className={`delta-badge ${badge.cls}`}>{badge.text}</span>}
                </div>
                {liveError(k) && <small className="field-error">{errors[k]}</small>}
              </label>
              {breached && (
                <label className="reason-box">
                  <span className="reason-flag">
                    ⚠ {FIELD_RULES[field].label}变化超过 {FIELD_RULES[field].threshold}
                    {FIELD_RULES[field].unit}，请填写变更原因
                  </span>
                  <textarea
                    rows={2}
                    value={reasons[k] ?? ""}
                    onChange={(e) => setReasons((prev) => ({ ...prev, [k]: e.target.value }))}
                    placeholder="例如：复验近视进展，眼轴增长，矫正视力 1.0"
                  />
                  {liveError(k + ".reason") && <small className="field-error">{errors[k + ".reason"]}</small>}
                </label>
              )}
            </div>
          );
        })}
        <div className="vision-row">
          {(["unaided", "corrected"] as const).map((vk) => (
            <label key={vk}>
              <span>{vk === "unaided" ? "裸眼视力" : "矫正视力"}</span>
              <input
                value={vision[eye][vk]}
                onChange={(e) => setVision((p) => ({ ...p, [eye]: { ...p[eye], [vk]: e.target.value } }))}
                placeholder="如 1.0"
              />
              {liveError(`${eye}.${vk}`) && <small className="field-error">{errors[`${eye}.${vk}`]}</small>}
            </label>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section className="panel rx-form-panel">
      <div className="section-heading">
        <div>
          <p>{isReview ? "复查处方 · 继承上次" : "新患者 · 初次处方"}</p>
          <h2>{isReview ? `为 ${base!.patientName} 新建复查` : "新建初次处方"}</h2>
        </div>
        <button onClick={onCancel}>取消</button>
      </div>

      {isReview && base && (
        <div className="inherit-banner">
          <strong>已继承 v{base.version} 处方</strong>
          <span>
            开立于 {formatDateTime(base.createdAt)} · 球镜/柱镜/轴位/视力均已预填，请直接在其基础上调整；
            任一参数变化超过阈值时须填写变更原因。
          </span>
        </div>
      )}

      <div className="form-meta-grid">
        {!isReview ? (
          <>
            <label>
              <span>患者姓名</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="患者真实姓名" />
              {liveError("name") && <small className="field-error">{errors.name}</small>}
            </label>
            <label>
              <span>分类</span>
              <input list="category-options" value={category} onChange={(e) => setCategory(e.target.value)} />
              <datalist id="category-options">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
              {liveError("category") && <small className="field-error">{errors.category}</small>}
            </label>
          </>
        ) : (
          <>
            <label>
              <span>患者</span>
              <input value={`${base!.patientName}（${base!.patientId}）`} disabled />
            </label>
            <label>
              <span>分类</span>
              <input value={base!.category} disabled />
            </label>
          </>
        )}
        <label>
          <span>瞳距 PD（mm，可选）</span>
          <input value={pd} onChange={(e) => setPd(e.target.value)} inputMode="decimal" placeholder="如 60" />
          {liveError("pd") && <small className="field-error">{errors.pd}</small>}
        </label>
      </div>

      <div className="eye-grid">{(["OD", "OS"] as EyeSide[]).map(renderEyePanel)}</div>

      <label className="note-field">
        <span>备注（可选）</span>
        <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="医嘱、随访计划等" />
      </label>

      <div className="form-footer">
        <p className="rule-hint">
          规则：球镜或柱镜变化超过 0.50D、轴位变化超过 0.50° 必须填写变更原因；轴位仅允许 {AXIS_MIN}-{AXIS_MAX}{" "}
          度的整数。提交后旧处方不会被覆盖，将生成新版本并永久保留旧值、原因与时间。
        </p>
        <button className="primary-action" onClick={handleSubmit}>
          {isReview ? `提交复查（生成 v${base!.version + 1}）` : "提交初配处方（v1）"}
        </button>
      </div>
    </section>
  );
}
