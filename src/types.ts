// 验光处方领域模型：处方以「版本」为单位，只追加，不覆盖

export type EyeSide = "OD" | "OS"; // OD 右眼 / OS 左眼
export type RxField = "sphere" | "cylinder" | "axis"; // 球镜 / 柱镜 / 轴位
export type RxKind = "initial" | "review"; // 初配 / 复查

export interface EyeRx {
  sphere: number; // 球镜 DS，单位 D
  cylinder: number; // 柱镜 DC，单位 D
  axis: number; // 轴位，整数，0-180 度
}

export interface VisionInfo {
  unaided: string; // 裸眼视力
  corrected: string; // 矫正视力
}

/** 一次超阈值变更的留痕：旧值、新值、差值、原因 */
export interface FieldChange {
  eye: EyeSide;
  field: RxField;
  oldValue: number;
  newValue: number;
  delta: number; // 球镜/柱镜为带符号差值(D)，轴位为环向距离(度)
  reason: string;
}

/** 处方版本：提交后不可变(immutable) */
export interface RxVersion {
  id: string;
  patientId: string;
  patientName: string;
  category: string;
  version: number; // 同一患者内从 1 递增
  kind: RxKind;
  createdAt: string; // ISO 时间戳
  right: EyeRx;
  left: EyeRx;
  vision: Record<EyeSide, VisionInfo>;
  pd: number | null; // 瞳距 mm
  changes: FieldChange[]; // 初配为空，复查只记录超阈值且已填原因的变更
  note: string;
}

export interface PatientSummary {
  id: string;
  name: string;
  category: string;
  versions: RxVersion[]; // 按 version 升序
}
