import type { Alert } from "../types";
import { fmtDist, fmtEta } from "../lib/format";

interface Props {
  alerts: Alert[];
  notifPerm: NotificationPermission | "unsupported";
  notifEnabled: boolean;
  soundEnabled: boolean;
  onToggleNotif: () => void;
  onToggleSound: () => void;
  onRequestNotif: () => void;
  onSelect: (hex: string) => void;
}

export default function AlertsPanel({
  alerts,
  notifPerm,
  notifEnabled,
  soundEnabled,
  onToggleNotif,
  onToggleSound,
  onRequestNotif,
  onSelect,
}: Props) {
  return (
    <div className="panel alerts">
      <div className="panel-head">
        <h3>Inbound heavies {alerts.length > 0 && <span className="badge live">{alerts.length}</span>}</h3>
        <div className="alert-controls">
          <button
            className={`sound-toggle ${soundEnabled ? "on" : ""}`}
            onClick={onToggleSound}
            title={soundEnabled ? "Alert chime on" : "Alert chime off"}
            aria-label="toggle alert sound"
          >
            {soundEnabled ? "🔊" : "🔇"}
          </button>
          {notifPerm === "granted" ? (
            <label className="notif-toggle">
              <input type="checkbox" checked={notifEnabled} onChange={onToggleNotif} /> notify
            </label>
          ) : notifPerm === "unsupported" ? (
            <span className="muted small">no notifications</span>
          ) : (
            <button className="mini" onClick={onRequestNotif}>
              Enable alerts
            </button>
          )}
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="empty">No 747/A380 on approach right now. Watching live…</div>
      ) : (
        <div className="alert-list">
          {alerts.map((a) => (
            <button key={a.hex} className="alert-card" onClick={() => onSelect(a.hex)}>
              <div className="alert-top">
                <span className="alert-type">{a.type_label}</span>
                <span className="alert-eta">{fmtEta(a.eta_minutes)} out</span>
              </div>
              <div className="alert-cs">
                {a.callsign || a.hex} · {a.operator_label}
              </div>
              <div className="alert-meta">
                {a.runway ? `Likely ${a.runway}` : "Runway TBD"} · {fmtDist(a.distance_nm)}
                {a.spot_name ? ` · → ${a.spot_name}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
