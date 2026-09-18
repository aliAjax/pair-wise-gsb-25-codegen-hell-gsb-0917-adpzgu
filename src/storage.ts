import type { PatientSummary, RxVersion } from "./types";

// 只追加(append-only)的本地持久层：版本一旦写入不可修改，刷新后版本链仍在
const STORAGE_KEY = "hxwl-11.rx-versions.v1";

function loadRaw(): RxVersion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RxVersion[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(versions: RxVersion[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(versions));
}

export function loadVersions(): RxVersion[] {
  return loadRaw().sort((a, b) => {
    if (a.patientId !== b.patientId) return a.patientId.localeCompare(b.patientId);
    return a.version - b.version;
  });
}

/** 追加一个新版本；绝不修改或删除已有版本 */
export function appendVersion(version: RxVersion): RxVersion[] {
  const versions = loadRaw();
  if (versions.some((v) => v.id === version.id)) return loadVersions(); // 幂等，拒绝重复
  versions.push(version);
  persist(versions);
  return loadVersions();
}

export function groupByPatient(versions: RxVersion[]): PatientSummary[] {
  const map = new Map<string, PatientSummary>();
  for (const v of versions) {
    let p = map.get(v.patientId);
    if (!p) {
      p = { id: v.patientId, name: v.patientName, category: v.category, versions: [] };
      map.set(v.patientId, p);
    }
    p.versions.push(v);
  }
  for (const p of map.values()) {
    p.versions.sort((a, b) => a.version - b.version);
    // 名称/分类以最新版本为准，旧版本内容不动
    p.name = p.versions[p.versions.length - 1].patientName;
    p.category = p.versions[p.versions.length - 1].category;
  }
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** 下次版本号；同患者复查必须接在链尾 */
export function nextVersionNumber(versions: RxVersion[], patientId: string): number {
  return versions.filter((v) => v.patientId === patientId).length + 1;
}

export function makeVersionId(): string {
  return "v_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
}
