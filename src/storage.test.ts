import assert from "node:assert";
import type { Patient, VersionDraft } from "./types";
import { buildFollowupVersion, diffChanges, uid } from "./domain";

/** 模拟浏览器 localStorage，验证“刷新后版本链仍在”的持久化路径。 */
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const localStorage = new MemoryStorage();
(globalThis as { localStorage?: unknown }).localStorage = localStorage;

const { loadPatients, savePatients } = await import("./storage");

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

// 首次加载：无存档时写入种子数据（种子本身通过版本构建器，原因齐全）
const firstLoad = loadPatients();
ok("首次加载生成 3 名种子患者且版本链完整", () => {
  assert.strictEqual(firstLoad.length, 3);
  const p032 = firstLoad.find((p) => p.code === "Patient-032")!;
  assert.strictEqual(p032.versions.length, 3);
  assert.strictEqual(p032.versions[2].version, 3);
  assert.strictEqual(p032.versions[2].inheritedFromVersion, 2);
  // 超阈值的 v3 带原因
  const sphereChange = p032.versions[2].changes.find((c) => c.field === "sphere")!;
  assert.strictEqual(sphereChange.exceedsThreshold, true);
  assert.ok(sphereChange.reason.length > 0);
  // 每个版本都有检查日期和提交时间
  p032.versions.forEach((v) => {
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(v.examDate));
    assert.ok(!Number.isNaN(new Date(v.createdAt).getTime()));
  });
});

// 模拟刷新：重新从“磁盘”读取
const afterRefresh = loadPatients();
ok("刷新后（重新 load）版本链、旧值、原因、时间全部保留", () => {
  const p032 = afterRefresh.find((p) => p.code === "Patient-032")!;
  assert.deepStrictEqual(
    p032.versions.map((v) => v.version),
    [1, 2, 3],
  );
  // v1 旧值快照仍是 -2.50，未被后续版本覆盖
  assert.strictEqual(p032.versions[0].rx.OD.sphere, -2.5);
  assert.strictEqual(p032.versions[2].rx.OD.sphere, -3.5);
  assert.strictEqual(p032.versions[2].changes[0].fromText, "-2.75D");
  assert.strictEqual(p032.versions[2].changes[0].toText, "-3.50D");
});

// 模拟完整的“新增复查”应用层动作：继承 → 修改 → 缺原因被拦 → 补原因 → append
const patients = loadPatients();
const target = patients.find((p) => p.code === "Patient-144")!;
const prev = target.versions[target.versions.length - 1];

const badDraft: VersionDraft = {
  examDate: "2026-09-18",
  optometrist: prev.optometrist,
  category: prev.category,
  pd: prev.pd,
  note: "再次复查",
  // OD 球镜从 -1.50 改到 -2.50，差值 1.00D，超阈值但没给原因
  rx: {
    OD: { sphere: -2.5, cylinder: -1.75, axis: 175, correctedVA: "5.0" },
    OS: { ...prev.rx.OS },
  },
  reasons: {},
};

ok("提交闸门：超阈值无原因时构建器抛错，版本链不增长", () => {
  const before = target.versions.length;
  assert.throws(() => buildFollowupVersion(prev, badDraft, { id: uid(), createdAt: new Date().toISOString() }));
  assert.strictEqual(target.versions.length, before);
});

const goodDraft: VersionDraft = {
  ...badDraft,
  reasons: { "OD.sphere": "近距离用眼负荷增加，近视进展。" },
};

// 与 App.handleSubmitFollowup 相同的不可变更新方式
const next = buildFollowupVersion(prev, goodDraft, {
  id: uid(),
  createdAt: new Date().toISOString(),
});
const updated: Patient[] = patients.map((p) =>
  p.id === target.id ? { ...p, versions: [...p.versions, next] } : p,
);
savePatients(updated);

ok("提交成功：append 新版本 v3，旧版本对象与旧值原样保留", () => {
  const saved = loadPatients().find((p) => p.code === "Patient-144")!;
  assert.strictEqual(saved.versions.length, 3);
  assert.strictEqual(saved.versions[2].version, 3);
  assert.strictEqual(saved.versions[2].kind, "followup");
  assert.strictEqual(saved.versions[2].inheritedFromVersion, 2);
  // 旧版 v2 仍是 -1.50
  assert.strictEqual(saved.versions[1].rx.OD.sphere, -1.5);
  // 新版 v3 是 -2.50
  assert.strictEqual(saved.versions[2].rx.OD.sphere, -2.5);
  const change = saved.versions[2].changes.find((c) => c.field === "sphere")!;
  assert.strictEqual(change.fromText, "-1.50D");
  assert.strictEqual(change.toText, "-2.50D");
  assert.strictEqual(change.deltaText, "-1.00D");
  assert.strictEqual(change.exceedsThreshold, true);
  assert.strictEqual(change.reason, "近距离用眼负荷增加，近视进展。");
  assert.ok(saved.versions[2].createdAt >= saved.versions[1].createdAt);
});

ok("再次刷新后新版本 v3 仍在，且不可从外部反向改写旧链", () => {
  const reloaded = loadPatients().find((p) => p.code === "Patient-144")!;
  assert.strictEqual(reloaded.versions.length, 3);
  assert.deepStrictEqual(
    reloaded.versions.map((v) => [v.version, v.inheritedFromVersion]),
    [
      [1, null],
      [2, 1],
      [3, 2],
    ],
  );
});

// 同一表单中“差异预览”与最终固化一致（RxForm 实时预览用的就是 diffChanges）
ok("实时差异预览结果与提交固化的变更一致", () => {
  const preview = diffChanges(prev.rx, goodDraft.rx, goodDraft.reasons).map((c) => ({
    key: c.reasonKey,
    exceeds: c.entry.exceedsThreshold,
    reason: c.entry.reason,
  }));
  const saved = loadPatients().find((p) => p.code === "Patient-144")!;
  const persisted = saved.versions[2].changes.map((c) => ({
    key: `${c.eye}.${c.field}` as const,
    exceeds: c.exceedsThreshold,
    reason: c.reason,
  }));
  assert.deepStrictEqual(preview, persisted);
});

console.log(`\n端到端持久化 ${passed} 项通过`);
