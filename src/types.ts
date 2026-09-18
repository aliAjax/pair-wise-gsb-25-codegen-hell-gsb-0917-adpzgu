export type Eye = "OD" | "OS";

export type Category = "儿童" | "成人" | "渐进片" | "角膜塑形镜";

export type VersionKind = "initial" | "followup";

export type RxField = "sphere" | "cylinder" | "axis";

/** 单眼处方。轴位仅在有柱镜（散光）时存在，取值 0-180 度（整数）。 */
export interface EyeRx {
  /** 球镜 DS */
  sphere: number;
  /** 柱镜 DC */
  cylinder: number;
  /** 轴位（度，0-180），柱镜为 0 时恒为 null */
  axis: number | null;
  /** 矫正视力，如 5.0 */
  correctedVA: string;
}

export interface PrescriptionPair {
  OD: EyeRx;
  OS: EyeRx;
}

/** 一次处方相对上一版的单条字段变更；旧值、差值、原因都随版本固化。 */
export interface ChangeEntry {
  eye: Eye;
  field: RxField;
  label: string;
  fromText: string;
  toText: string;
  deltaText: string;
  /** 是否超过 0.50D / 0.50° —— 为 true 时 reason 必填 */
  exceedsThreshold: boolean;
  reason: string;
}

/** 不可变处方版本。提交复查只会新增版本，旧版本永不覆盖。 */
export interface PrescriptionVersion {
  id: string;
  version: number;
  kind: VersionKind;
  /** 检查日期（YYYY-MM-DD，由验光师填写） */
  examDate: string;
  /** 提交入库时间（ISO，系统生成，用于审计） */
  createdAt: string;
  optometrist: string;
  category: Category;
  pd: number | null;
  note: string;
  /** 复查版本继承自哪个版本号；初配为 null */
  inheritedFromVersion: number | null;
  changes: ChangeEntry[];
  rx: PrescriptionPair;
}

export interface Patient {
  id: string;
  code: string;
  name: string;
  createdAt: string;
  /** 按 version 升序排列，只追加、不修改 */
  versions: PrescriptionVersion[];
}

export interface VersionDraft {
  examDate: string;
  optometrist: string;
  category: Category;
  pd: number | null;
  note: string;
  rx: PrescriptionPair;
  /** key 为 `${eye}.${field}`，仅超阈值字段需要原因 */
  reasons: Partial<Record<`${Eye}.${RxField}`, string>>;
}

export interface InitialDraft extends VersionDraft {
  code: string;
  name: string;
}
