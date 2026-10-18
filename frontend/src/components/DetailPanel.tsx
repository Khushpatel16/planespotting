import { useEffect, useState, type ReactNode } from "react";
import type { Aircraft } from "../types";
import { api, type AircraftPhoto } from "../api";
import { fmtAlt, fmtDist, fmtEta, fmtSpeed, fmtVrate, roleBadge } from "../lib/format";

interface Props {
  ac: Aircraft;
  onClose: () => void;
  onLog: (ac: Aircraft) => void;
  onWatch?: (ac: Aircraft) => void;
  onCockpit?: (ac: Aircraft) => void;
}

// Session-level cache so re-selecting an aircraft doesn't refetch its photo.
const photoCache = new Map<string, AircraftPhoto | null>();

function usePhoto(hex: string, reg: string | null): AircraftPhoto | null {
  const [photo, setPhoto] = useState<AircraftPhoto | null>(photoCache.get(hex) ?? null);
  useEffect(() => {
    if (photoCache.has(hex)) {
      setPhoto(photoCache.get(hex) ?? null);
      return;
    }
    setPhoto(null);
    let live = true;
    api
      .getPhoto(hex, reg)
      .then((p) => {
        photoCache.set(hex, p);
        if (live) setPhoto(p);
      })
      .catch(() => {
        photoCache.set(hex, null);
      });
    return () => {
      live = false;
    };
  }, [hex, reg]);
  return photo;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="drow">
      <span className="dk">{label}</span>
      <span className="dv">{value}</span>
    </div>
  );
}

export default function DetailPanel({ ac, onClose, onLog, onWatch, onCockpit }: Props) {
  const role = roleBadge(ac.role);
  const photo = usePhoto(ac.hex, ac.registration);
  return (
    <div className="detail-panel">
      <div className="detail-head">
        <div>
          <div className="detail-title">{ac.callsign || ac.registration || ac.hex.toUpperCase()}</div>
          <div className="detail-sub">
            {ac.type.friendly_name}
            {ac.type.family === "A380" ? " (A380)" : ""}
            {role && <span className={`role-badge ${ac.role}`}>{role}</span>}
          </div>
        </div>
        <button className="x" onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      {photo && (
        <a className="ac-photo" href={photo.link} target="_blank" rel="noreferrer">
          <img src={photo.url} alt={`${ac.registration || ac.hex} photo`} loading="lazy" />
          <span className="ac-photo-credit">© {photo.photographer} · Planespotters.net</span>
        </a>
      )}

      {ac.is_inbound && (
        <div className="inbound-banner">
          ✈ Inbound · {fmtEta(ac.eta_minutes)} out
          {ac.runway && ` · likely ${ac.runway.runway} (${ac.runway.complex})`}
        </div>
      )}

      <Row label="Operator" value={ac.operator.name || ac.operator.code || "—"} />
      <Row label="Registration" value={ac.registration || "—"} />
      <Row label="Type" value={`${ac.type.icao_type} · ${ac.type.variant}`} />
      <Row label="Altitude" value={fmtAlt(ac.altitude_ft)} />
      <Row label="Ground speed" value={fmtSpeed(ac.ground_speed_kt)} />
      <Row label="Vertical rate" value={fmtVrate(ac.vertical_rate_fpm)} />
      <Row label="Track" value={ac.track_deg !== null ? `${Math.round(ac.track_deg)}°` : "—"} />
      <Row label="Distance to KLAX" value={fmtDist(ac.distance_nm)} />
      {ac.squawk && <Row label="Squawk" value={ac.squawk} />}
      {(ac.origin || ac.destination) && (
        <Row label="Route" value={`${ac.origin || "?"} → ${ac.destination || "?"}`} />
      )}
      {(ac.country || ac.state) && (
        <Row
          label="Over"
          value={[ac.state, ac.country === "USA" ? "USA" : ac.country === "CAN" ? "Canada" : ac.country === "MEX" ? "Mexico" : null]
            .filter(Boolean)
            .join(", ")}
        />
      )}
      {ac.desc && <Row label="Airframe" value={ac.desc} />}
      {(ac.categories ?? []).filter((c) => c !== "all").length > 0 && (
        <Row
          label="Class"
          value={(ac.categories ?? [])
            .filter((c) => c !== "all")
            .map((c) => c.replace(/_/g, " ").toUpperCase())
            .join(" · ")}
        />
      )}
      <Row
        label="Source"
        value={`${ac.source}${ac.seen_seconds != null && ac.seen_seconds > 60 ? ` · fix ${Math.round(ac.seen_seconds)} s old` : ""}`}
      />

      {onCockpit && ac.lat != null && (
        <button className="btn-secondary" onClick={() => onCockpit(ac)}>
          Cockpit view
        </button>
      )}
      <button className="btn-primary log-btn" onClick={() => onLog(ac)}>
        + Log this sighting
      </button>
      {onWatch && (
        <button className="btn-secondary" onClick={() => onWatch(ac)}>
          ★ Watch this {ac.registration ? "aircraft" : "operator"}
        </button>
      )}
    </div>
  );
}
