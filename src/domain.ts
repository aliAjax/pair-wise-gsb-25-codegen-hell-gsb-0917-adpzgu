import type {
  Category,
  ChangeEntry,
  Eye,
  EyeRx,
  InitialDraft,
  PrescriptionPair,
  PrescriptionVersion,
  RxField,
  VersionDraft,
} from "./types";

/** 球镜 / 柱镜变化超过该度数（D）必须填写变更原因；“超过”为严格大于。 */
export const CHANGE_THRESHOLD = 0.5;

/** 阈值的展示文案：球镜/柱镜按 D，轴位按度。 */
export function thresholdText(field: RxField): string {
  return field === "axis" ? `${CHANGE_THRESHOLD.toFixed(2)}°` : `${CHANGE_THRESHOLD.toFixed(2)}D`;
}

/** 验光处方以 0.25D 为一档。 */
export const DIOPTER_STEP = 0.25;

export const EYE_LABEL: Record<Eye, string> = { OD: "右眼", OS: "左眼" };

export const FIELD_LABEL: Record<RxField, string> = {
  sphere: "球镜",
  cylinder: "柱镜",
  axis: "轴位",
};

export const CATEGORIES: Category[] = ["儿童", "成人", "渐进片", "角膜塑形镜"];

const EPS = 1e-9;

export function emptyEyeRx(): EyeRx {
  return { sphere: 0, cylinder: 0, axis: null, correctedVA: "" };
}

export function emptyPair(): PrescriptionPair {
  return { OD: emptyEyeRx(), OS: emptyEyeRx() };
}

/** 解析有限数值；空串或非法输入返回 null。 */
export function parseNumeric(raw: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export function isQuarterStep(value: number): boolean {
  const steps = value / DIOPTER_STEP;
  return Math.abs(steps - Math.round(steps)) < 1e-6;
}

/** 轴位校验：只允许 0-180 度的整数。返回错误信息，合法返回 null。 */
export function axisError(raw: string, required: boolean): string | null {
  const text = raw.trim();
  if (!text) {
    return required ? "有柱镜时必须填写轴位" : null;
  }
  if (!/^-?\d+$/.test(text)) {
    return "轴位只允许 0-180 度的整数";
  }
  const value = Number(text);
  if (value < 0 || value > 180) {
    return "轴位只允许 0-180 度";
  }
  return null;
}

/** 轴位是圆周量：0° 与 180° 等价，取最短夹角。 */
export function axisShortDelta(a: number, b: number): number {
  const diff = Math.abs(a - b);
  return Math.min(diff, 180 - diff);
}

export function formatD(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(2)}`;
}

export function formatAxis(value: number | null): string {
  return value === null ? "—" : `${value}°`;
}

export function deltaD(from: number, to: number): string {
  return formatD(Math.round((to - from) * 100) / 100);
}

export function rxSummary(rx: PrescriptionPair): string {
  const eye = (e: EyeRx) => {
    const cyl = e.cylinder !== 0 ? `/${formatD(e.cylinder)}×${e.axis ?? "—"}` : "";
    return `${formatD(e.sphere)}${cyl}`;
  };
  return `OD ${eye(rx.OD)}　OS ${eye(rx.OS)}`;
}

interface FieldChange {
  entry: ChangeEntry;
  /** 超过阈值、需要原因的字段键，如 "OD.sphere" */
  reasonKey: `${Eye}.${RxField}`;
}

/**
 * 对比相邻两版处方，逐眼逐字段生成变更记录。
 * 球镜/柱镜按绝对差值（D），轴位按最短夹角（度），严格大于 0.50 才标记超阈值。
 */
export function diffChanges(
  prev: PrescriptionPair,
  next: PrescriptionPair,
  reasons: VersionDraft["reasons"] = {},
): FieldChange[] {
  const result: FieldChange[] = [];
  (["OD", "OS"] as Eye[]).forEach((eye) => {
    const before = prev[eye];
    const after = next[eye];

    (["sphere", "cylinder"] as const).forEach((field) => {
      const from = before[field];
      const to = after[field];
      if (Math.abs(to - from) <= EPS) return;
      const magnitude = Math.abs(to - from);
      const reasonKey = `${eye}.${field}` as const;
      result.push({
        reasonKey,
        entry: {
          eye,
          field,
          label: `${EYE_LABEL[eye]} · ${FIELD_LABEL[field]}`,
          fromText: `${formatD(from)}D`,
          toText: `${formatD(to)}D`,
          deltaText: `${deltaD(from, to)}D`,
          exceedsThreshold: magnitude > CHANGE_THRESHOLD + EPS,
          reason: reasons[reasonKey]?.trim() ?? "",
        },
      });
    });

    // 轴位：仅前后两版都有柱镜轴位时可比；新增/取消散光记为信息性变更。
    const fromAxis = before.axis;
    const toAxis = after.axis;
    if (fromAxis !== null && toAxis !== null) {
      const magnitude = axisShortDelta(fromAxis, toAxis);
      if (magnitude > EPS) {
        const reasonKey = `${eye}.axis` as const;
        result.push({
          reasonKey,
          entry: {
            eye,
            field: "axis",
            label: `${EYE_LABEL[eye]} · 轴位`,
            fromText: `${fromAxis}°`,
            toText: `${toAxis}°`,
            deltaText: `最短相差 ${magnitude}°`,
            exceedsThreshold: magnitude > CHANGE_THRESHOLD + EPS,
            reason: reasons[reasonKey]?.trim() ?? "",
          },
        });
      }
    } else if (fromAxis === null && toAxis !== null) {
      result.push({
        reasonKey: `${eye}.axis`,
        entry: {
          eye,
          field: "axis",
          label: `${EYE_LABEL[eye]} · 轴位`,
          fromText: "—",
          toText: `${toAxis}°`,
          deltaText: "新增散光轴位",
          exceedsThreshold: false,
          reason: "",
        },
      });
    } else if (fromAxis !== null && toAxis === null) {
      result.push({
        reasonKey: `${eye}.axis`,
        entry: {
          eye,
          field: "axis",
          label: `${EYE_LABEL[eye]} · 轴位`,
          fromText: `${fromAxis}°`,
          toText: "—",
          deltaText: "取消散光轴位",
          exceedsThreshold: false,
          reason: "",
        },
      });
    }
  });
  return result;
}

/** 提交前最后一道闸：所有超阈值变更必须已有非空原因。 */
export function missingReasons(
  prev: PrescriptionPair,
  next: PrescriptionPair,
  reasons: VersionDraft["reasons"],
): ChangeEntry[] {
  return diffChanges(prev, next, reasons)
    .filter(({ entry }) => entry.exceedsThreshold && !entry.reason)
    .map(({ entry }) => entry);
}

export interface VersionMeta {
  id: string;
  createdAt: string;
}

/** 初配即 v1，无前序版本。 */
export function buildInitialVersion(draft: InitialDraft, meta: VersionMeta): PrescriptionVersion {
  return {
    id: meta.id,
    version: 1,
    kind: "initial",
    examDate: draft.examDate,
    createdAt: meta.createdAt,
    optometrist: draft.optometrist.trim(),
    category: draft.category,
    pd: draft.pd,
    note: draft.note.trim(),
    inheritedFromVersion: null,
    changes: [],
    rx: draft.rx,
  };
}

/**
 * 复查版本：版本号 = 上一版 + 1，固化继承关系、旧值快照、差值、原因与时间。
 * 注意：返回的是全新对象，调用方只能 append 到版本链，禁止改写旧版本。
 */
export function buildFollowupVersion(
  prev: PrescriptionVersion,
  draft: VersionDraft,
  meta: VersionMeta,
): PrescriptionVersion {
  const changes = diffChanges(prev.rx, draft.rx, draft.reasons).map(({ entry }) => entry);
  const unsigned = changes.filter((c) => c.exceedsThreshold && !c.reason);
  if (unsigned.length > 0) {
    throw new Error(`以下字段变化超过 ${CHANGE_THRESHOLD} 但未填写原因：${unsigned.map((c) => c.label).join("、")}`);
  }
  return {
    id: meta.id,
    version: prev.version + 1,
    kind: "followup",
    examDate: draft.examDate,
    createdAt: meta.createdAt,
    optometrist: draft.optometrist.trim(),
    category: draft.category,
    pd: draft.pd,
    note: draft.note.trim(),
    inheritedFromVersion: prev.version,
    changes,
    rx: draft.rx,
  };
}

export function todayISO(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
