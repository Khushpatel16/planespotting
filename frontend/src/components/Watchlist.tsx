import { useState } from "react";
import type { WatchRule } from "../types";
import type { WatchMatch } from "../hooks/useWatchlist";
import { ruleHasCriteria } from "../hooks/useWatchlist";
import { fmtDist, fmtEta } from "../lib/format";

interface Props {
  rules: WatchRule[];
  matches: WatchMatch[];
  onChange: (rules: WatchRule[]) => void;
  onSelect: (hex: string) => void;
}

const FAMILIES: { value: WatchRule["family"]; label: string }[] = [
  { value: "any", label: "Any type" },
  { value: "A380", label: "A380" },
  { value: "747", label: "747" },
  { value: "heavy", label: "Other heavy" },
  { value: "other", label: "Other" },
];

function emptyRule(): WatchRule {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `r${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    enabled: true,
    operator: "",
    family: "any",
    typeCode: "",
    registration: "",
    callsign: "",
    destination: "",
    inboundOnly: false,
  };
}

function summarize(r: WatchRule): string {
  const parts: string[] = [];
  if (r.operator.trim()) parts.push(r.operator.trim());
  if (r.family !== "any") parts.push(r.family);
  if (r.typeCode.trim()) parts.push(r.typeCode.trim().toUpperCase());
  if (r.registration.trim()) parts.push(`reg ${r.registration.trim().toUpperCase()}`);
  if (r.callsign.trim()) parts.push(`c/s ${r.callsign.trim().toUpperCase()}`);
  if (r.destination.trim()) parts.push(`→ ${r.destination.trim().toUpperCase()}`);
  if (r.inboundOnly) parts.push("inbound only");
  return parts.join(" · ") || "anything";
}

export default function Watchlist({ rules, matches, onChange, onSelect }: Props) {
  const [draft, setDraft] = useState<WatchRule>(emptyRule);
  const [open, setOpen] = useState(false);

  const set = (patch: Partial<WatchRule>) => setDraft((d) => ({ ...d, ...patch }));
  const canAdd = ruleHasCriteria(draft);

  function addRule() {
    if (!canAdd) return;
    const label = draft.label.trim() || summarize(draft);
    onChange([{ ...draft, label }, ...rules]);
    setDraft(emptyRule());
    setOpen(false);
  }

  function toggleRule(id: string) {
    onChange(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  }

  function deleteRule(id: string) {
    onChange(rules.filter((r) => r.id !== id));
  }

  return (
    <div className="panel watchlist">
      <div className="panel-head">
        <h3>
          Watchlist {matches.length > 0 && <span className="badge live">{matches.length}</span>}
        </h3>
        <button className="mini" onClick={() => setOpen((v) => !v)}>
          {open ? "Cancel" : "+ Add alert"}
        </button>
      </div>

      {open && (
        <div className="watch-form">
          <div className="form-grid">
            <label className="field full">
              Name (optional)
              <input
                value={draft.label}
                placeholder="e.g. Lufthansa 100yrs A380"
                onChange={(e) => set({ label: e.target.value })}
              />
            </label>
            <label className="field">
              Airline / operator
              <input
                value={draft.operator}
                placeholder="Lufthansa or DLH"
                onChange={(e) => set({ operator: e.target.value })}
              />
            </label>
            <label className="field">
              Type
              <select
                value={draft.family}
                onChange={(e) => set({ family: e.target.value as WatchRule["family"] })}
              >
                {FAMILIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Registration (tail)
              <input
                value={draft.registration}
                placeholder="D-AIMB"
                onChange={(e) => set({ registration: e.target.value })}
              />
            </label>
            <label className="field">
              Callsign
              <input
                value={draft.callsign}
                placeholder="DLH456"
                onChange={(e) => set({ callsign: e.target.value })}
              />
            </label>
            <label className="field">
              ICAO type code
              <input
                value={draft.typeCode}
                placeholder="A388"
                onChange={(e) => set({ typeCode: e.target.value })}
              />
            </label>
            <label className="field">
              Destination
              <input
                value={draft.destination}
                placeholder="KJFK"
                onChange={(e) => set({ destination: e.target.value })}
              />
            </label>
            <label className="field full watch-inbound">
              <input
                type="checkbox"
                checked={draft.inboundOnly}
                onChange={(e) => set({ inboundOnly: e.target.checked })}
              />
              Only alert when inbound to LAX
            </label>
          </div>
          <button className="btn-primary" disabled={!canAdd} onClick={addRule}>
            Save alert
          </button>
          {!canAdd && <div className="watch-hint">Set at least one criterion above.</div>}
        </div>
      )}

      {matches.length > 0 && (
        <div className="alert-list watch-matches">
          {matches.map((m) => (
            <button key={m.ac.hex} className="alert-card watch-match" onClick={() => onSelect(m.ac.hex)}>
              <div className="alert-top">
                <span className="alert-type watch-type">
                  {m.ac.type.family === "A380" ? "A380" : m.ac.type.friendly_name}
                </span>
                {m.ac.is_inbound && m.ac.eta_minutes != null ? (
                  <span className="alert-eta">{fmtEta(m.ac.eta_minutes)} out</span>
                ) : (
                  <span className="alert-eta muted">{fmtDist(m.ac.distance_nm)}</span>
                )}
              </div>
              <div className="alert-cs">
                {m.ac.callsign || m.ac.registration || m.ac.hex.toUpperCase()} ·{" "}
                {m.ac.operator.name || m.ac.operator.code || "Unknown"}
              </div>
              <div className="alert-meta">★ {m.rule.label}</div>
            </button>
          ))}
        </div>
      )}

      {rules.length === 0 ? (
        !open && (
          <div className="empty">
            No watchlist alerts yet. Add one to get pinged for a specific airline, type, or tail
            number — e.g. an Etihad A380 or a one-off livery.
          </div>
        )
      ) : (
        <div className="watch-rules">
          {rules.map((r) => (
            <div key={r.id} className={`watch-rule ${r.enabled ? "" : "off"}`}>
              <label className="watch-rule-toggle">
                <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id)} />
              </label>
              <div className="watch-rule-body">
                <div className="watch-rule-label">{r.label}</div>
                <div className="watch-rule-sum">{summarize(r)}</div>
              </div>
              <button className="watch-rule-del" aria-label="delete" onClick={() => deleteRule(r.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
