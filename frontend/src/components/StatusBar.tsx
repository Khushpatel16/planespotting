import type { Snapshot } from "../types";
import type { ConnState } from "../hooks/useSnapshot";
import { timeAgo } from "../lib/format";
import { CAT } from "../lib/colors";

interface Props {
  snapshot: Snapshot | null;
  conn: ConnState;
  wideCount?: number | null; // aircraft in the North-America layer (beyond LAX radius)
  atcCount?: number; // live ATC feeds currently playing
}

export default function StatusBar({ snapshot, conn, wideCount = null, atcCount = 0 }: Props) {
  const stale =
    snapshot && Object.values(snapshot.sources_status).some((s) => s.startsWith("stale"));
  const c = snapshot?.counts ?? {};
  return (
    <header className="statusbar">
      <div className="brand">
        <span className="logo">🛬</span>
        <div>
          <div className="title">Heavy Watch LAX</div>
          <div className="subtitle">747 &amp; A380 spotter radar · KLAX</div>
        </div>
      </div>

      <div className="status-metrics">
        <Metric label="A380" value={c.a380 ?? 0} accent={CAT.a380} />
        <Metric label="747" value={c.b747 ?? 0} accent={CAT.b747} />
        <Metric label="Heavies" value={c.heavies ?? 0} accent={CAT.heavy} />
        <Metric label="Inbound" value={c.inbound_targets ?? 0} accent={CAT.approach} />
        <Metric label="In range" value={c.total ?? 0} accent="var(--text)" />
        {wideCount !== null && <Metric label="N. America" value={wideCount} accent="var(--text-2)" />}
      </div>

      <div className="conn">
        {atcCount > 0 && (
          <span className="atc-onair" title={`${atcCount} live ATC feed${atcCount > 1 ? "s" : ""} playing`}>
            🎧 {atcCount}
          </span>
        )}
        <span className={`conn-dot ${conn}`} />
        <div className="conn-text">
          <span>{conn === "open" ? (stale ? "live (cached)" : "live") : conn}</span>
          {snapshot && <span className="muted small">updated {timeAgo(snapshot.generated_at)}</span>}
        </div>
      </div>
    </header>
  );
}

function Metric({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="metric">
      <div className="metric-val" style={{ color: accent }}>
        {value}
      </div>
      <div className="metric-lbl">{label}</div>
    </div>
  );
}
