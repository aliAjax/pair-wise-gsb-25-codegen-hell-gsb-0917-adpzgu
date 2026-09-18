import { useMemo, useState } from "react";
import "./styles.css";
import type { RxVersion } from "./types";
import { appendVersion, groupByPatient, loadVersions, makeVersionId, nextVersionNumber } from "./storage";
import { seedVersions } from "./seed";
import PrescriptionForm, { type RxPayload } from "./PrescriptionForm";
import VersionTimeline from "./VersionTimeline";

const PROJECT = {
  id: "hxwl-11",
  port: 5111,
  title: "眼科验光记录",
  subtitle: "视力、屈光参数与复查处方对比 · 复查继承上次处方，变更留痕，版本链永久保留",
  stack: "React + Vite + TypeScript + localStorage",
  domain: "眼视光",
  users: ["验光师", "门店顾问", "复查医生"],
  filters: ["全部", "儿童近视", "成人", "渐进片", "散光", "角膜塑形镜"],
  reviewIntervalDays: 90,
};

type FormMode = { kind: "initial" } | { kind: "review"; base: RxVersion } | null;

function initVersions(): RxVersion[] {
  const existing = loadVersions();
  if (existing.length > 0) return existing;
  // 首次使用：写入演示数据（已含可追溯的版本链）
  const seeded = seedVersions();
  seeded.forEach((v) => appendVersion(v));
  return loadVersions();
}

export default function App() {
  const [versions, setVersions] = useState<RxVersion[]>(initVersions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState("全部");
  const [formMode, setFormMode] = useState<FormMode>(null);

  const patients = useMemo(() => groupByPatient(versions), [versions]);
  const categories = useMemo(
    () => Array.from(new Set(patients.map((p) => p.category))),
    [patients]
  );

  const visiblePatients = useMemo(
    () => (categoryFilter === "全部" ? patients : patients.filter((p) => p.category === categoryFilter)),
    [patients, categoryFilter]
  );

  const selectedPatient = patients.find((p) => p.id === selectedId) ?? null;

  const metrics = useMemo(() => {
    const changeCount = versions.reduce((sum, v) => sum + v.changes.length, 0);
    const now = Date.now();
    const overdue = patients.filter((p) => {
      const latest = p.versions[p.versions.length - 1];
      return now - new Date(latest.createdAt).getTime() > PROJECT.reviewIntervalDays * 86400_000;
    }).length;
    return [
      { label: "处方版本总数", value: String(versions.length) },
      { label: "建档患者", value: String(patients.length) },
      { label: "超阈值变更留痕", value: String(changeCount) },
      { label: `复查提醒（>${PROJECT.reviewIntervalDays}天）`, value: String(overdue) },
    ];
  }, [versions, patients]);

  const startInitial = () => {
    setSelectedId(null);
    setFormMode({ kind: "initial" });
  };

  const startReview = (patientId: string) => {
    const p = patients.find((x) => x.id === patientId);
    if (!p) return;
    setSelectedId(patientId);
    setFormMode({ kind: "review", base: p.versions[p.versions.length - 1] });
  };

  const submit = (payload: RxPayload) => {
    if (formMode?.kind === "review") {
      const base = formMode.base;
      const version: RxVersion = {
        id: makeVersionId(),
        patientId: base.patientId,
        patientName: payload.patientName,
        category: payload.category,
        version: nextVersionNumber(versions, base.patientId),
        kind: "review",
        createdAt: new Date().toISOString(),
        right: payload.right,
        left: payload.left,
        vision: payload.vision,
        pd: payload.pd,
        changes: payload.changes,
        note: payload.note,
      };
      setVersions(appendVersion(version));
      setSelectedId(base.patientId);
    } else {
      // 避免与种子/已有编号冲突
      const used = new Set(patients.map((p) => Number(p.id.replace(/^Patient-/, ""))));
      let n = 145;
      while (used.has(n)) n += 1;
      const id = `Patient-${String(n).padStart(3, "0")}`;
      const version: RxVersion = {
        id: makeVersionId(),
        patientId: id,
        patientName: payload.patientName,
        category: payload.category,
        version: 1,
        kind: "initial",
        createdAt: new Date().toISOString(),
        right: payload.right,
        left: payload.left,
        vision: payload.vision,
        pd: payload.pd,
        changes: [],
        note: payload.note,
      };
      setVersions(appendVersion(version));
      setSelectedId(id);
    }
    setFormMode(null);
  };

  const statusColors = ["status-ok", "status-watch", "status-danger"];

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">
            {PROJECT.id} · port {PROJECT.port}
          </p>
          <h1>{PROJECT.title}</h1>
          <p className="subtitle">{PROJECT.subtitle}</p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>{PROJECT.stack}</strong>
        </div>
      </section>

      <section className="metrics-grid">
        {metrics.map((m, index) => (
          <article className="metric-card" key={m.label}>
            <span>{m.label}</span>
            <strong>{m.value}</strong>
            <i className={statusColors[index % statusColors.length]} />
          </article>
        ))}
      </section>

      {formMode ? (
        <PrescriptionForm
          mode={formMode}
          categories={PROJECT.filters.filter((f) => f !== "全部")}
          onCancel={() => setFormMode(null)}
          onSubmit={submit}
        />
      ) : (
        <section className="workspace">
          <aside className="panel narrow">
            <h2>角色</h2>
            <div className="chips">
              {PROJECT.users.map((u) => (
                <span key={u}>{u}</span>
              ))}
            </div>
            <h2>分类筛选</h2>
            <div className="chips muted filter-chips">
              {PROJECT.filters.map((f) => (
                <button
                  key={f}
                  className={categoryFilter === f ? "chip-active" : ""}
                  onClick={() => setCategoryFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <button className="primary-action full-width" onClick={startInitial}>
              + 新患者初配
            </button>
          </aside>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>{PROJECT.domain}</p>
                <h2>患者档案</h2>
              </div>
            </div>
            <div className="patient-list">
              {visiblePatients.map((p) => {
                const latest = p.versions[p.versions.length - 1];
                const days = Math.floor((Date.now() - new Date(latest.createdAt).getTime()) / 86400_000);
                const overdue = days > PROJECT.reviewIntervalDays;
                return (
                  <article
                    key={p.id}
                    className={`patient-card ${selectedId === p.id ? "selected" : ""}`}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <div className="patient-main">
                      <h3>
                        {p.name}
                        <span className="patient-id">{p.id}</span>
                        <span className="category-tag">{p.category}</span>
                      </h3>
                      <p className="patient-rx">
                        右 {latest.right.sphere.toFixed(2)}DS / {latest.right.cylinder.toFixed(2)}DC×{latest.right.axis}° ·
                        左 {latest.left.sphere.toFixed(2)}DS / {latest.left.cylinder.toFixed(2)}DC×{latest.left.axis}°
                      </p>
                    </div>
                    <div className="patient-side">
                      <span className="version-count">v{latest.version} · {p.versions.length} 个版本</span>
                      <span className={overdue ? "overdue-flag" : "fresh-flag"}>
                        {overdue ? `距上次 ${days} 天，建议复查` : `${days} 天前`}
                      </span>
                      <button
                        className="primary-action small"
                        onClick={(e) => {
                          e.stopPropagation();
                          startReview(p.id);
                        }}
                      >
                        新增复查
                      </button>
                    </div>
                  </article>
                );
              })}
              {visiblePatients.length === 0 && <p className="empty-hint">该分类下暂无患者。</p>}
            </div>
          </section>
        </section>
      )}

      {!formMode && selectedPatient && (
        <VersionTimeline patient={selectedPatient} onReview={() => startReview(selectedPatient.id)} />
      )}

      {!formMode && !selectedPatient && (
        <section className="panel records">
          <div className="section-heading">
            <div>
              <p>操作指引</p>
              <h2>验光复查闭环</h2>
            </div>
          </div>
          <ol className="guide-list">
            <li>在左侧选择分类筛选，或点击「新患者初配」建立 v1 处方。</li>
            <li>选择患者后可查看完整版本链；点击「新增复查」将自动继承其最新处方的全部数值。</li>
            <li>
              复查时球镜或柱镜变化<strong>超过 0.50D</strong>、轴位变化<strong>超过 0.50°</strong>
              ，必须填写变更原因；轴位只允许填写 0-180 的整数。
            </li>
            <li>提交只追加新版本：旧处方、旧值、变更原因与时间戳原样保留，刷新页面后版本链不丢失。</li>
          </ol>
        </section>
      )}
    </main>
  );
}
