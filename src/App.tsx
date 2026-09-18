import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import type { Category, InitialDraft, Patient, VersionDraft } from "./types";
import {
  CATEGORIES,
  buildFollowupVersion,
  buildInitialVersion,
  rxSummary,
  uid,
} from "./domain";
import { loadPatients, savePatients } from "./storage";
import RxForm from "./RxForm";
import PatientDetail from "./PatientDetail";

type View =
  | { name: "list" }
  | { name: "detail"; patientId: string }
  | { name: "form"; mode: { type: "initial" } | { type: "followup"; patientId: string } };

type Filter = "全部" | Category;
const FILTERS: Filter[] = ["全部", ...CATEGORIES];

const REMIND_DAYS = 90;

function MetricCard({
  label,
  value,
  hint,
  index,
}: {
  label: string;
  value: string | number;
  hint: string;
  index: number;
}) {
  const tone = ["status-ok", "status-watch", "status-danger", "status-ok"][index % 4];
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
      <i className={tone} />
    </article>
  );
}

export default function App() {
  const [patients, setPatients] = useState<Patient[]>(() => loadPatients());
  const [view, setView] = useState<View>({ name: "list" });
  const [filter, setFilter] = useState<Filter>("全部");
  const [keyword, setKeyword] = useState("");

  useEffect(() => {
    savePatients(patients);
  }, [patients]);

  const activePatientId =
    view.name === "detail" || (view.name === "form" && view.mode.type === "followup")
      ? view.name === "detail"
        ? view.patientId
        : view.mode.type === "followup"
          ? view.mode.patientId
          : undefined
      : undefined;
  const activePatient = activePatientId
    ? patients.find((p) => p.id === activePatientId)
    : undefined;

  const metrics = useMemo(() => {
    let progression = 0;
    let astigChange = 0;
    let totalVersions = 0;
    patients.forEach((p) => {
      totalVersions += p.versions.length;
      p.versions.forEach((v) => {
        if (v.changes.some((c) => c.field === "sphere" && c.exceedsThreshold)) progression += 1;
        if (v.changes.some((c) => (c.field === "cylinder" || c.field === "axis") && c.exceedsThreshold)) {
          astigChange += 1;
        }
      });
    });
    const now = Date.now();
    const due = patients.filter((p) => {
      const latest = p.versions[p.versions.length - 1];
      const t = new Date(`${latest.examDate}T00:00:00`).getTime();
      return Number.isFinite(t) && now - t > REMIND_DAYS * 86_400_000;
    }).length;
    return { progression, astigChange, due, totalVersions };
  }, [patients]);

  const visiblePatients = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return patients.filter((p) => {
      const latest = p.versions[p.versions.length - 1];
      if (filter !== "全部" && latest.category !== filter) return false;
      if (kw && !`${p.code} ${p.name}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [patients, filter, keyword]);

  function handleSubmitInitial(draft: InitialDraft): string | null {
    if (patients.some((p) => p.code.toLowerCase() === draft.code.toLowerCase())) {
      return "患者编号已存在，请直接对该患者新增复查。";
    }
    const createdAt = new Date().toISOString();
    const patient: Patient = {
      id: uid(),
      code: draft.code,
      name: draft.name,
      createdAt,
      // 初配 v1 同样走领域构建器，保证版本结构唯一来源
      versions: [buildInitialVersion(draft, { id: uid(), createdAt })],
    };
    setPatients((list) => [...list, patient]);
    setView({ name: "detail", patientId: patient.id });
    return null;
  }

  function handleSubmitFollowup(patientId: string, draft: VersionDraft) {
    setPatients((list) =>
      list.map((p) => {
        if (p.id !== patientId) return p;
        const prev = p.versions[p.versions.length - 1];
        // 不可变更新：旧版本对象原样保留，只 append 新版本；构建器内部再校验一次原因必填
        const next = buildFollowupVersion(prev, draft, {
          id: uid(),
          createdAt: new Date().toISOString(),
        });
        return { ...p, versions: [...p.versions, next] };
      }),
    );
    setView({ name: "detail", patientId });
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <p className="eyebrow">hxwl-11 · port 5111</p>
          <h1>眼科验光记录</h1>
          <p className="subtitle">
            视力、屈光参数与复查处方对比 —— 同患者复查自动继承上次处方，球镜/柱镜/轴位变化超过
            0.50 必填原因，轴位仅限 0-180 度；旧处方只读保留，版本链持久化，刷新不丢失。
          </p>
        </div>
        <div className="stack-card">
          <span>技术栈</span>
          <strong>React + Vite + TypeScript + localStorage 版本链</strong>
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard index={0} label="近视进展" value={metrics.progression} hint="含球镜变化 &gt; 0.50D 的复查版本" />
        <MetricCard index={1} label="散光变化" value={metrics.astigChange} hint="柱镜/轴位变化 &gt; 0.50 的复查版本" />
        <MetricCard index={2} label="复查提醒" value={metrics.due} hint={`最新检查超过 ${REMIND_DAYS} 天的患者数`} />
        <MetricCard index={3} label="处方数量" value={metrics.totalVersions} hint="全部不可变处方版本总数" />
      </section>

      {view.name === "form" && view.mode.type === "initial" && (
        <RxForm
          mode={{ type: "initial" }}
          onSubmitInitial={handleSubmitInitial}
          onSubmitFollowup={handleSubmitFollowup}
          onCancel={() => setView({ name: "list" })}
        />
      )}

      {view.name === "form" && view.mode.type === "followup" && activePatient && (
        <RxForm
          mode={{ type: "followup", patient: activePatient }}
          onSubmitInitial={handleSubmitInitial}
          onSubmitFollowup={handleSubmitFollowup}
          onCancel={() => setView({ name: "detail", patientId: activePatient.id })}
        />
      )}

      {view.name === "detail" && activePatient && (
        <section className="panel">
          <button className="back-btn" onClick={() => setView({ name: "list" })}>
            ← 返回患者列表
          </button>
          <PatientDetail
            patient={activePatient}
            onNewFollowup={() =>
              setView({ name: "form", mode: { type: "followup", patientId: activePatient.id } })
            }
          />
        </section>
      )}

      {view.name === "list" && (
        <section className="workspace">
          <aside className="panel narrow">
            <h2>分类筛选</h2>
            <div className="chips">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  className={filter === f ? "chip-active" : undefined}
                  onClick={() => setFilter(f)}
                >
                  {f}
                </button>
              ))}
            </div>
            <h2>角色</h2>
            <div className="chips muted">
              <span>验光师</span>
              <span>门店顾问</span>
              <span>复查医生</span>
            </div>
            <button
              className="primary-action wide"
              onClick={() => setView({ name: "form", mode: { type: "initial" } })}
            >
              + 新增患者初配
            </button>
          </aside>

          <section className="panel">
            <div className="section-heading">
              <div>
                <p>验光档案</p>
                <h2>患者列表</h2>
              </div>
              <input
                className="search-input"
                placeholder="搜索编号 / 姓名"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
            </div>
            <div className="record-list">
              {visiblePatients.map((p) => {
                const latest = p.versions[p.versions.length - 1];
                const examTime = new Date(`${latest.examDate}T00:00:00`).getTime();
                const due = Number.isFinite(examTime) && Date.now() - examTime > REMIND_DAYS * 86_400_000;
                return (
                  <article
                    key={p.id}
                    className="record-card clickable"
                    onClick={() => setView({ name: "detail", patientId: p.id })}
                  >
                    <div className="record-index">v{latest.version}</div>
                    <div className="record-main">
                      <h3>
                        {p.name} <span className="record-code">{p.code}</span>
                        {due && <span className="badge-danger">建议复查</span>}
                      </h3>
                      <p>
                        {latest.category} · 检查日 {latest.examDate} · {rxSummary(latest.rx)}
                      </p>
                    </div>
                    <button
                      className="followup-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setView({ name: "form", mode: { type: "followup", patientId: p.id } });
                      }}
                    >
                      新增复查
                    </button>
                  </article>
                );
              })}
              {visiblePatients.length === 0 && <p className="muted">没有符合条件的患者。</p>}
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
