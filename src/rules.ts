import type { EyeRx, EyeSide, FieldChange, RxField } from "./types";

/**
 * 变更阈值规则：
 * - 球镜(DS)、柱镜(DC)：变化超过 0.50D 必须填写变更原因
 * - 轴位：仅允许 0-180 度；复查时变化超过 0.50(度) 必须填写原因
 *   （轴位为角度，阈值以「度」计；临床实际轴位以整数记录，故任何整数改动都会留痕）
 */
export const FIELD_RULES: Record<
  RxField,
  { label: string; unit: string; threshold: number; precision: number; step: number }
> = {
  sphere: { label: "球镜", unit: "D", threshold: 0.5, precision: 2, step: 0.25 },
  cylinder: { label: "柱镜", unit: "D", threshold: 0.5, precision: 0, step: 1 },
  axis: { label: "轴位", unit: "°", threshold: 0.5, precision: 0, step: 1 },
};

export const EYE_LABEL: Record<EyeSide, string> = { OD: "右眼 OD", OS: "左眼 OS" };
export const FIELD_ORDER: RxField[] = ["sphere", "cylinder", "axis"];

export const AXIS_MIN = 0;
export const AXIS_MAX = 180;

/** 轴位是环变量（0° 与 180° 等价），取两条路径中更短的变化距离 */
export function axisDistance(a: number, b: number): number {
  const direct = Math.abs(a - b);
  return Math.min(direct, 180 - direct);
}

/** 球镜/柱镜绝对变化量(D)，修掉浮点误差 */
export function diopterDelta(a: number, b: number): number {
  return Math.round(Math.abs(a - b) * 100) / 100;
}

export function changeMagnitude(field: RxField, oldValue: number, newValue: number): number {
  if (field === "axis") return axisDistance(oldValue, newValue);
  return diopterDelta(oldValue, newValue);
}

/** 变化是否「超过」阈值：恰好 0.50D 不算，必须 > 0.50 */
export function isBreached(field: RxField, magnitude: number): boolean {
  return magnitude > FIELD_RULES[field].threshold + 1e-9;
}

/** 展示用：D 值保留两位，轴位取整 */
export function formatRxValue(field: RxField, value: number): string {
  const rule = FIELD_RULES[field];
  if (field === "axis") return String(Math.round(value)) + "°";
  return value.toFixed(rule.precision) + "D";
}

/** 差值展示：轴位用环向距离（正），球/柱镜带方向 */
export function formatDelta(field: RxField, oldValue: number, newValue: number): string {
  if (field === "axis") return "Δ " + axisDistance(oldValue, newValue).toFixed(0) + "°";
  const d = Math.round((newValue - oldValue) * 100) / 100;
  return (d > 0 ? "+" : "") + d.toFixed(2) + "D";
}

/**
 * 对比新旧双眼处方，产出需要留痕的变更（变化量超过阈值的字段）。
 * 原因由表单在提交前补入；此函数只负责找字段与旧值。
 */
export function draftChanges(prev: { right: EyeRx; left: EyeRx }, next: { right: EyeRx; left: EyeRx }): Omit<FieldChange, "reason">[] {
  const out: Omit<FieldChange, "reason">[] = [];
  (["OD", "OS"] as EyeSide[]).forEach((eye) => {
    FIELD_ORDER.forEach((field) => {
      const oldValue = prev[eye === "OD" ? "right" : "left"][field];
      const newValue = next[eye === "OD" ? "right" : "left"][field];
      const magnitude = changeMagnitude(field, oldValue, newValue);
      if (!isBreached(field, magnitude)) return;
      out.push({
        eye,
        field,
        oldValue,
        newValue,
        delta: field === "axis" ? axisDistance(oldValue, newValue) : Math.round((newValue - oldValue) * 100) / 100,
      });
    });
  });
  return out;
}
