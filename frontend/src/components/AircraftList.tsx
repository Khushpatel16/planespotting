import type { Aircraft } from "../types";
import { fmtAlt, fmtDist, categoryColor, aircraftLabel } from "../lib/format";

interface Props {
  aircraft: Aircraft[];
  selectedHex: string | null;
  onSelect: (hex: string) => void;
}

export default function AircraftList({ aircraft, selectedHex, onSelect }: Props) {
  const list = aircraft.filter((a) => a.type.is_heavy);
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Heavies in range <span className="badge">{list.length}</span></h3>
      </div>
      {list.length === 0 ? (
        <div className="empty">No widebodies in range right now.</div>
      ) : (
        <div className="ac-list">
          {list.map((a) => (
            <button
              key={a.hex}
              className={`ac-row ${selectedHex === a.hex ? "selected" : ""}`}
              onClick={() => onSelect(a.hex)}
            >
              <span className="dot" style={{ background: categoryColor(a) }} />
              <span className="ac-cs">{aircraftLabel(a)}</span>
              <span className="ac-type">{a.type.family === "A380" ? "A380" : a.type.friendly_name}</span>
              <span className="ac-op">{a.operator.name || a.operator.code || ""}</span>
              <span className="ac-num">{fmtAlt(a.altitude_ft)}</span>
              <span className="ac-num">{fmtDist(a.distance_nm)}</span>
              {a.is_inbound && <span className="badge inbound">IN</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
