import type { ChangeEntry, Patient, PrescriptionVersion } from "./types";
import { formatDateTime, formatD, formatAxis, thresholdText } from "./domain";

interface Props {
  patient: Patient;
  onNewFollowup: () => void;
}

function RxTable({ version }: { version: PrescriptionVersion }) {
  const eyes = [
    { key: "OD" as const, label: "右眼" },
    { key: "OS" as const, label: "左眼" },
  ];
  return (
    <table className="rx-table">
      <thead>
        <tr>
          <th>眼别</th>
          <th>球镜(DS)</th>
          <th>柱镜(DC)</th>
          <th>轴位</th>
          <th>矫正视力</th>
        </tr>
      </thead>
      <tbody>
        {eyes.map(({ key, label }) => {
          const rx = version.rx[key];
          return (
            <tr key={key}>
              <td>{label}</td>
              <td>{formatD(rx.sphere)}</td>
              <td>{rx.cylinder === 0 ? "—" : formatD(rx.cylinder)}</td>
              <td>{formatAxis(rx.axis)}</td>
              <td>{rx.correctedVA || "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChangeLine({ change }: { change: ChangeEntry }) {
  return (
    <div className={change.exceedsThreshold ? "timeline-change exceeds" : "timeline-change"}>
      <div className="timeline-change-head">
        <strong>{change.label}</strong>
        <span>
          {change.fromText} → {change.toText}
        </span>
        <em>{change.deltaText}</em>
        {change.exceedsThreshold ? (
          <span className="badge-danger">&gt; {thresholdText(change.field)}</span>
        ) : (
          <span className="badge-muted">未超阈值</span>
        )}
      </div>
      {change.exceedsThreshold && (
        <p className="reason-text">
          <span>变更原因（已随版本固化）：</span>
          {change.reason}
        </p>
      )}
    </div>
  );
}

export default function PatientDetail({ patient, onNewFollowup }: Props) {
  const latest = patient.versions[patient.versions.length - 1];
  const ordered = [...patient.versions].reverse();

  return (
    <div>
      <div className="section-heading">
        <div>
          <p>{patient.code}</p>
          <h2>{patient.name}</h2>
          <p className="muted">
            共 {patient.versions.length} 个处方版本 · 最新 v{latest.version}（{latest.kind === "initial" ? "初配" : "复查"}，检查日 {latest.examDate}）
          </p>
        </div>
        <button className="primary-action" onClick={onNewFollowup}>
          新增复查（继承 v{latest.version}）
        </button>
      </div>

      <ol className="version-chain">
        {ordered.map((version, index) => {
          const isLatest = index === 0;
          return (
            <li key={version.id} className={isLatest ? "version-card latest" : "version-card"}>
              <div className="version-head">
                <div className="version-badge">v{version.version}</div>
                <div>
                  <h3>
                    {version.kind === "initial" ? "初配处方" : `复查处方（继承自 v${version.inheritedFromVersion}）`}
                    {isLatest && <span className="badge-ok latest-badge">当前版本</span>}
                  </h3>
                  <p className="muted">
                    检查日期 {version.examDate} · 提交时间 {formatDateTime(version.createdAt)} ·{" "}
                    {version.optometrist} · {version.category}
                    {version.pd !== null && ` · 瞳距 ${version.pd}mm`}
                  </p>
                </div>
              </div>

              <RxTable version={version} />

              {version.changes.length > 0 && (
                <div className="version-changes">
                  <h4>相对 v{version.inheritedFromVersion} 的变更（旧值与原因已保留）</h4>
                  {version.changes.map((change, i) => (
                    <ChangeLine key={`${change.eye}-${change.field}-${i}`} change={change} />
                  ))}
                </div>
              )}
              {version.kind === "followup" && version.changes.length === 0 && (
                <p className="muted">本版与 v{version.inheritedFromVersion} 处方一致，无参数变更。</p>
              )}

              {version.note && <p className="version-note">备注：{version.note}</p>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
