import type { Stats } from "../types";
import { CAT } from "../lib/colors";

interface Props {
  stats: Stats | null;
}

function BarChart({ data, color }: { data: Record<string, number>; color: string }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return <div className="empty">No data yet.</div>;
  return (
    <div className="bars">
      {entries.map(([k, v]) => (
        <div className="bar-row" key={k}>
          <span className="bar-label" title={k}>{k}</span>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${(v / max) * 100}%`, background: color }} />
          </div>
          <span className="bar-val">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Heatmap({ hours }: { hours: Record<string, number> }) {
  const vals = Array.from({ length: 24 }, (_, h) => hours[String(h)] ?? 0);
  const max = Math.max(1, ...vals);
  return (
    <div className="heatmap">
      {vals.map((v, h) => (
        <div key={h} className="heat-cell-wrap" title={`${h}:00 — ${v} sighting(s)`}>
          <div
            className="heat-cell"
            style={{ background: v === 0 ? "var(--track-bg)" : `rgba(10,132,255,${0.18 + 0.82 * (v / max)})` }}
          />
          {h % 6 === 0 && <span className="heat-tick">{h}</span>}
        </div>
      ))}
    </div>
  );
}

function Timeline({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <div className="empty">No data yet.</div>;
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return (
    <div className="timeline">
      {entries.map(([d, v]) => (
        <div className="tl-col" key={d} title={`${d} — ${v}`}>
          <div className="tl-bar" style={{ height: `${(v / max) * 100}%` }} />
          <span className="tl-label">{d.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function StatsDashboard({ stats }: Props) {
  if (!stats) return <div className="panel"><div className="empty">Loading stats…</div></div>;
  if (stats.total === 0)
    return (
      <div className="panel">
        <div className="panel-head"><h3>Stats</h3></div>
        <div className="empty">No sightings logged yet. Your stats will appear here.</div>
      </div>
    );

  return (
    <div className="stats">
      <div className="stat-cards">
        <StatCard label="Total catches" value={stats.total} />
        <StatCard label="A380s" value={stats.by_family["A380"] ?? 0} color={CAT.a380} />
        <StatCard label="747s" value={stats.by_family["747"] ?? 0} color={CAT.b747} />
        <StatCard label="Operators" value={Object.keys(stats.by_operator).length} color={CAT.heavy} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>A380s by operator</h3></div>
        <BarChart data={stats.a380_by_operator} color={CAT.a380} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>747 variants caught</h3></div>
        <BarChart data={stats.b747_variants} color={CAT.b747} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>By operator</h3></div>
        <BarChart data={stats.by_operator} color={CAT.heavy} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Rarest catches</h3></div>
        <div className="rarest">
          {stats.rarest.map((s) => (
            <div key={s.id} className="rarest-item">
              <span className="r-type">{s.type_label || s.type_code}</span>
              <span className="r-op">{s.operator || "—"}</span>
              <span className="r-reg">{s.registration || ""}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Sightings over time</h3></div>
        <Timeline data={stats.over_time} />
      </div>

      <div className="panel">
        <div className="panel-head"><h3>When heavies show up (local hour)</h3></div>
        <Heatmap hours={stats.hour_heatmap} />
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="stat-card">
      <div className="stat-val" style={{ color: color ?? "var(--text)" }}>{value}</div>
      <div className="stat-lbl">{label}</div>
    </div>
  );
}
