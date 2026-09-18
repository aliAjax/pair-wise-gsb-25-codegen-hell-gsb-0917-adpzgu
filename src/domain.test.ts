import assert from "node:assert";
import {
  axisError,
  axisShortDelta,
  buildFollowupVersion,
  buildInitialVersion,
  diffChanges,
  emptyPair,
  missingReasons,
} from "./domain";
import type { EyeRx, InitialDraft, PrescriptionVersion, VersionDraft } from "./types";

let passed = 0;
function ok(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const eye = (sphere: number, cylinder = 0, axis: number | null = null): EyeRx => ({
  sphere,
  cylinder,
  axis,
  correctedVA: "5.0",
});

const meta = { id: "x", createdAt: new Date().toISOString() };

const initialDraft: InitialDraft = {
  code: "T-001",
  name: "测试患者",
  examDate: "2026-01-01",
  optometrist: "张",
  category: "成人",
  pd: 60,
  note: "",
  rx: { OD: eye(-2), OS: eye(-2) },
  reasons: {},
};

const v1 = buildInitialVersion(initialDraft, { ...meta, id: "v1" });

ok("初配为 v1 且无变更记录", () => {
  assert.strictEqual(v1.version, 1);
  assert.strictEqual(v1.kind, "initial");
  assert.strictEqual(v1.inheritedFromVersion, null);
  assert.deepStrictEqual(v1.changes, []);
});

// ---- 阈值边界：恰好 0.50 不算“超过”，0.75 才算 ----
const draft050: VersionDraft = {
  ...initialDraft,
  rx: { OD: eye(-2.5), OS: eye(-2) },
  reasons: {},
};
ok("球镜变化恰好 0.50D 不触发原因必填", () => {
  const changes = diffChanges(v1.rx, draft050.rx).map((c) => c.entry);
  assert.strictEqual(changes.length, 1);
  assert.strictEqual(changes[0].exceedsThreshold, false);
  assert.strictEqual(missingReasons(v1.rx, draft050.rx, {}).length, 0);
  const v2 = buildFollowupVersion(v1, draft050, { ...meta, id: "v2" });
  assert.strictEqual(v2.version, 2);
  assert.strictEqual(v2.inheritedFromVersion, 1);
});

const draft075: VersionDraft = {
  ...initialDraft,
  rx: { OD: eye(-2.75), OS: eye(-2) },
  reasons: {},
};
ok("球镜变化 0.75D 必须有原因，无原因抛错且不出版本", () => {
  const missing = missingReasons(v1.rx, draft075.rx, {});
  assert.strictEqual(missing.length, 1);
  assert.strictEqual(missing[0].label, "右眼 · 球镜");
  assert.throws(() => buildFollowupVersion(v1, draft075, { ...meta, id: "vX" }), /未填写原因/);
});

ok("球镜变化 0.75D 带原因后可提交，旧值/差值/原因固化", () => {
  const withReason: VersionDraft = {
    ...draft075,
    reasons: { "OD.sphere": "眼轴增长" },
  };
  const v2 = buildFollowupVersion(v1, withReason, { ...meta, id: "v2" });
  assert.strictEqual(v2.version, 2);
  assert.strictEqual(v2.changes.length, 1);
  assert.deepStrictEqual(
    {
      from: v2.changes[0].fromText,
      to: v2.changes[0].toText,
      delta: v2.changes[0].deltaText,
      exceeds: v2.changes[0].exceedsThreshold,
      reason: v2.changes[0].reason,
    },
    { from: "-2.00D", to: "-2.75D", delta: "-0.75D", exceeds: true, reason: "眼轴增长" },
  );
});

// ---- 柱镜阈值 ----
const cylDraft: VersionDraft = {
  ...initialDraft,
  rx: { OD: eye(-2, -0.75, 90), OS: eye(-2) },
  reasons: { "OD.cylinder": "足矫" },
};
ok("柱镜 0 → -0.75 超阈值且原因被接受；新增轴位为信息性变更", () => {
  const v2 = buildFollowupVersion(v1, cylDraft, { ...meta, id: "v2" });
  const cyl = v2.changes.find((c) => c.field === "cylinder")!;
  const axis = v2.changes.find((c) => c.field === "axis")!;
  assert.strictEqual(cyl.exceedsThreshold, true);
  assert.strictEqual(cyl.reason, "足矫");
  assert.strictEqual(axis.exceedsThreshold, false);
  assert.strictEqual(axis.deltaText, "新增散光轴位");
});

// ---- 轴位圆周差 ----
ok("轴位最短夹角：180→0 为 0°（等价），175→5 为 10°", () => {
  assert.strictEqual(axisShortDelta(180, 0), 0);
  assert.strictEqual(axisShortDelta(175, 5), 10);
  assert.strictEqual(axisShortDelta(90, 88), 2);
});

ok("轴位变化 10° 超 0.50 必填原因；轴位为整数刻度，任何 ≥1° 改动均超 0.50°", () => {
  const prev = { OD: eye(-2, -1, 175), OS: eye(-2) };
  const nextBig = { OD: eye(-2, -1, 5), OS: eye(-2) };
  const nextSmall = { OD: eye(-2, -1, 177), OS: eye(-2) };
  assert.strictEqual(missingReasons(prev, nextBig, {}).length, 1);
  assert.strictEqual(missingReasons(prev, nextSmall, {}).length, 1);
  // 轴位完全不变则不产生差异
  assert.strictEqual(diffChanges(prev, prev).length, 0);
  // 0° 与 180° 等价，不产生差异
  assert.strictEqual(
    diffChanges({ OD: eye(-2, -1, 180), OS: eye(-2) }, { OD: eye(-2, -1, 0), OS: eye(-2) })
      .length,
    0,
  );
});

// ---- 轴位输入校验：只允许 0-180 整数 ----
ok("轴位校验：181/负数/小数/非数字全部拒绝，0 和 180 合法", () => {
  assert.strictEqual(axisError("181", true), "轴位只允许 0-180 度");
  assert.strictEqual(axisError("-1", true), "轴位只允许 0-180 度");
  assert.strictEqual(axisError("90.5", true), "轴位只允许 0-180 度的整数");
  assert.strictEqual(axisError("abc", true), "轴位只允许 0-180 度的整数");
  assert.strictEqual(axisError("0", true), null);
  assert.strictEqual(axisError("180", true), null);
  assert.strictEqual(axisError("", false), null);
  assert.strictEqual(axisError("", true), "有柱镜时必须填写轴位");
});

// ---- 版本链不可变 ----
ok("连续复查版本号递增、继承链完整、旧版本对象不被修改", () => {
  let current: PrescriptionVersion = v1;
  const snapshots = [structuredClone(v1)];
  const drafts: VersionDraft[] = [
    { ...initialDraft, rx: { OD: eye(-2.5), OS: eye(-2) }, reasons: {} },
    {
      ...initialDraft,
      rx: { OD: eye(-3.25), OS: eye(-2.25) },
      reasons: { "OD.sphere": "进展", "OS.sphere": "进展" },
    },
  ];
  drafts.forEach((d, i) => {
    current = buildFollowupVersion(current, d, { ...meta, id: `v${i + 2}` });
    snapshots.push(structuredClone(current));
  });
  assert.strictEqual(current.version, 3);
  assert.strictEqual(current.inheritedFromVersion, 2);
  assert.strictEqual(snapshots[0].version, 1);
  assert.deepStrictEqual(snapshots[0].rx, v1.rx);
  assert.strictEqual(snapshots[1].inheritedFromVersion, 1);
  // 旧 v1 对象本身引用未变
  assert.strictEqual(v1.version, 1);
  assert.strictEqual(v1.changes.length, 0);
});

ok("空处方不会产生幽灵差异", () => {
  assert.strictEqual(diffChanges(emptyPair(), emptyPair()).length, 0);
});

console.log(`\n全部 ${passed} 项通过`);
