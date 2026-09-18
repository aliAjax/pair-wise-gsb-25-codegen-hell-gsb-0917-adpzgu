import type {
  InitialDraft,
  Patient,
  PrescriptionPair,
  PrescriptionVersion,
  VersionDraft,
} from "./types";
import {
  buildFollowupVersion,
  buildInitialVersion,
  emptyPair,
  uid,
} from "./domain";

const STORAGE_KEY = "hxwl-11.patients.v1";

/**
 * 种子数据走和线上完全相同的版本构建器：
 * 超阈值变更必须带原因，否则此处直接抛错。
 */
function seedPatients(): Patient[] {
  const stamp = (day: number) => new Date(2026, 8, day, 9, 30, 0).toISOString();

  function patient(
    code: string,
    name: string,
    createdISO: string,
    initial: InitialDraft,
    followups: Array<{ draft: VersionDraft; iso: string }>,
  ): Patient {
    const versions: PrescriptionVersion[] = [
      buildInitialVersion(initial, { id: `seed-${code}-v1`, createdAt: createdISO }),
    ];
    followups.forEach((f, i) => {
      versions.push(
        buildFollowupVersion(versions[versions.length - 1], f.draft, {
          id: `seed-${code}-v${i + 2}`,
          createdAt: f.iso,
        }),
      );
    });
    return {
      id: `seed-${code}`,
      code,
      name,
      createdAt: createdISO,
      versions,
    };
  }

  const p032Initial: InitialDraft = {
    code: "Patient-032",
    name: "李晓童",
    examDate: "2025-12-20",
    optometrist: "王验光师",
    category: "儿童",
    pd: 56,
    note: "初配，家长诉看黑板眯眼半年。",
    rx: {
      OD: { sphere: -2.5, cylinder: 0, axis: null, correctedVA: "5.0" },
      OS: { sphere: -2.25, cylinder: 0, axis: null, correctedVA: "5.0" },
    },
    reasons: {},
  };
  const p032v2: VersionDraft = {
    examDate: "2026-03-20",
    optometrist: "王验光师",
    category: "儿童",
    pd: 57,
    note: "三个月复查。",
    rx: {
      OD: { sphere: -2.75, cylinder: 0, axis: null, correctedVA: "5.0" },
      OS: { sphere: -2.25, cylinder: 0, axis: null, correctedVA: "5.0" },
    },
    reasons: {},
  };
  const p032v3: VersionDraft = {
    examDate: "2026-06-20",
    optometrist: "复查医生",
    category: "儿童",
    pd: 58,
    note: "半年复查，近视进展，已建议增加户外活动。",
    rx: {
      OD: { sphere: -3.5, cylinder: -0.5, axis: 175, correctedVA: "5.0" },
      OS: { sphere: -2.75, cylinder: 0, axis: null, correctedVA: "5.0" },
    },
    reasons: {
      "OD.sphere": "眼轴增长 0.22mm，近视持续进展。",
    },
  };

  const p081Initial: InitialDraft = {
    code: "Patient-081",
    name: "陈建华",
    examDate: "2026-05-10",
    optometrist: "周验光师",
    category: "渐进片",
    pd: 63,
    note: "初配渐进片，ADD +1.50，瞳高已确认。",
    rx: {
      OD: { sphere: 0.5, cylinder: -0.75, axis: 90, correctedVA: "4.9" },
      OS: { sphere: 0.75, cylinder: -0.5, axis: 85, correctedVA: "4.9" },
    },
    reasons: {},
  };
  const p081v2: VersionDraft = {
    examDate: "2026-08-12",
    optometrist: "周验光师",
    category: "渐进片",
    pd: 63,
    note: "适应良好，参数微调。",
    rx: {
      OD: { sphere: 0.25, cylinder: -0.75, axis: 90, correctedVA: "5.0" },
      OS: { sphere: 0.75, cylinder: -0.75, axis: 90, correctedVA: "5.0" },
    },
    reasons: {
      "OS.axis": "渐进片戴用习惯改变，镜眼距稳定后精调轴位。",
    },
  };

  const p144Initial: InitialDraft = {
    code: "Patient-144",
    name: "赵雨桐",
    examDate: "2026-07-02",
    optometrist: "王验光师",
    category: "成人",
    pd: 60,
    note: "初配，视物重影。",
    rx: {
      OD: { sphere: -1.5, cylinder: -1, axis: 180, correctedVA: "4.9" },
      OS: { sphere: -1.75, cylinder: -1.25, axis: 170, correctedVA: "4.9" },
    },
    reasons: {},
  };
  const p144v2: VersionDraft = {
    examDate: "2026-09-05",
    optometrist: "复查医生",
    category: "成人",
    pd: 60,
    note: "两个月复查，散光矫正优化。",
    rx: {
      OD: { sphere: -1.5, cylinder: -1.75, axis: 175, correctedVA: "5.0" },
      OS: { sphere: -1.75, cylinder: -1.25, axis: 170, correctedVA: "5.0" },
    },
    reasons: {
      "OD.cylinder": "初戴适应后散光足矫，角膜地形图支持。",
      "OD.axis": "交叉柱镜精调，最佳视力轴位 175°。",
    },
  };

  return [
    patient("Patient-032", "李晓童", stamp(1), p032Initial, [
      { draft: p032v2, iso: stamp(12) },
      { draft: p032v3, iso: stamp(15) },
    ]),
    patient("Patient-081", "陈建华", stamp(8), p081Initial, [{ draft: p081v2, iso: stamp(16) }]),
    patient("Patient-144", "赵雨桐", stamp(9), p144Initial, [{ draft: p144v2, iso: stamp(17) }]),
  ];
}

export function loadPatients(): Patient[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      const seed = seedPatients();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seed));
      return seed;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("数据格式错误");
    return parsed as Patient[];
  } catch (err) {
    console.error("读取本地验光数据失败，使用示例数据：", err);
    return seedPatients();
  }
}

export function savePatients(patients: Patient[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(patients));
}

export function newId(): string {
  return uid();
}

export { emptyPair };
