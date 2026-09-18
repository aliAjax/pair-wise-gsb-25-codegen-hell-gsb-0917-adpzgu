import type { EyeSide, FieldChange, PatientSummary, RxField, RxVersion } from "./types";
import { EYE_LABEL, FIELD_RULES, formatDelta, formatRxValue } from "./rules";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function ChangeRow({ change }: { change: FieldChange }) {
  return (
    <li className="change-row">
      <div className="change-head">
        <span className="change-tag">
          {EYE_LABEL[change.eye]} · {FIELD_RULES[change.field].label}
        </span>
        <span className="change-values">
          旧值 {formatRxValue(change.field, change.oldValue)}
          <b> → </b>
          新值 {formatRxValue(change.field, change.newValue)}
        </span>
        <span className="delta-badge delta-breach">
          {formatDelta(change.field, change.oldValue, change.newValue)}
        </span>
      </div>
      <p className="change-reason">
        <i>变更原因</i>
        {change.reason}
      </p>
    </li>
  );
}

function VersionCard({ version, isLatest }: { version: RxVersion; isLatest: boolean }) {
  return (
    <article className={`version-card ${isLatest ? "is-latest" : ""}`}>
      <header className="version-head">
        <div className="version-no">v{version.version}</div>
        <div className="version-meta">
          <h3>
            {version.kind === "initial" ? "初次处方" : "复查处方"}
            {isLatest && <span className="latest-pill">当前版本</span>}
          </h3>
          <time>{formatDateTime(version.createdAt)}</time>
        </div>
      </header>

      <div className="version-eyes">
        {(["OD", "OS"] as EyeSide[]).map((eye) => {
          const rx = eye === "OD" ? version.right : version.left;
          const v = version.vision[eye];
          return (
            <div key={eye} className="version-eye">
              <h4>{EYE_LABEL[eye]}</h4>
              <p>
                {(["sphere", "cylinder", "axis"] as RxField[]).map((f) => (
                  <span key={f} className="rx-pill">
                    {FIELD_RULES[f].label} {formatRxValue(f, rx[f])}
                  </span>
                ))}
              </p>
              <p className="vision-line">
                裸眼 {v.unaided} · 矫正 {v.corrected}
              </p>
            </div>
          );
        })}
      </div>

      {version.pd != null && <p className="version-pd">瞳距 PD {version.pd}mm</p>}

      {version.changes.length > 0 ? (
        <ul className="change-list">
          {version.changes.map((c) => (
            <ChangeRow key={`${c.eye}-${c.field}`} change={c} />
          ))}
        </ul>
      ) : (
        version.kind === "review" && <p className="no-change-hint">本次复查各项参数均未超过阈值，无需变更原因。</p>
      )}

      {version.note && <p className="version-note">备注：{version.note}</p>}
    </article>
  );
}

export default function VersionTimeline({ patient, onReview }: { patient: PatientSummary; onReview: () => void }) {
  const latest = patient.versions[patient.versions.length - 1];
  return (
    <section className="panel timeline-panel">
      <div className="section-heading">
        <div>
          <p>版本链 · 只追加不可覆盖</p>
          <h2>
            {patient.name} <small>{patient.id}</small>
          </h2>
        </div>
        <button className="primary-action" onClick={onReview}>
          新增复查（继承 v{latest.version}）
        </button>
      </div>
      <div className="timeline">
        {patient.versions.map((v, i) => (
          <div className="timeline-item" key={v.id}>
            <VersionCard version={v} isLatest={i === patient.versions.length - 1} />
            {i < patient.versions.length - 1 && <div className="timeline-link" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </section>
  );
}
