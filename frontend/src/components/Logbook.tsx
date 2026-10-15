import { useEffect, useState, type FormEvent } from "react";
import type { Sighting, Spot } from "../types";
import { api } from "../api";

export interface Prefill {
  type_code?: string | null;
  type_label?: string | null;
  variant?: string | null;
  registration?: string | null;
  operator?: string | null;
  callsign?: string | null;
  hex?: string | null;
  flow?: string | null;
  runway?: string | null;
}

interface Props {
  spots: Spot[];
  prefill: Prefill | null;
  sightings: Sighting[];
  onChanged: () => void;
}

const EMPTY = {
  type_code: "",
  type_label: "",
  variant: "",
  registration: "",
  operator: "",
  callsign: "",
  hex: "",
  flow: "",
  runway: "",
  spot_id: "",
  notes: "",
};

export default function Logbook({ spots, prefill, sightings, onChanged }: Props) {
  const [form, setForm] = useState({ ...EMPTY });
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (prefill) {
      setForm((f) => ({
        ...f,
        type_code: prefill.type_code ?? "",
        type_label: prefill.type_label ?? "",
        variant: prefill.variant ?? "",
        registration: prefill.registration ?? "",
        operator: prefill.operator ?? "",
        callsign: prefill.callsign ?? "",
        hex: prefill.hex ?? "",
        flow: prefill.flow ?? "",
        runway: prefill.runway ?? "",
      }));
    }
  }, [prefill]);

  const upd = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(form)) if (v !== "") payload[k] = v;
      const created = await api.createSighting(payload);
      if (photo) await api.uploadPhoto(created.id, photo);
      setForm({ ...EMPTY });
      setPhoto(null);
      setMsg("Logged! ✈️");
      onChanged();
    } catch (err) {
      setMsg(`Error: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    await api.deleteSighting(id);
    onChanged();
  }

  return (
    <div className="logbook">
      <form className="panel logform" onSubmit={submit}>
        <div className="panel-head">
          <h3>Log a sighting</h3>
          {msg && <span className="form-msg">{msg}</span>}
        </div>
        <div className="form-grid">
          <Field label="Type code" v={form.type_code} on={(v) => upd("type_code", v)} placeholder="A388" />
          <Field label="Variant" v={form.variant} on={(v) => upd("variant", v)} placeholder="A380-800" />
          <Field label="Registration" v={form.registration} on={(v) => upd("registration", v)} placeholder="A6-EUA" />
          <Field label="Operator" v={form.operator} on={(v) => upd("operator", v)} placeholder="Emirates" />
          <Field label="Callsign" v={form.callsign} on={(v) => upd("callsign", v)} placeholder="UAE215" />
          <Field label="Runway" v={form.runway} on={(v) => upd("runway", v)} placeholder="25L" />
          <label className="field">
            <span>Flow</span>
            <select value={form.flow} onChange={(e) => upd("flow", e.target.value)}>
              <option value="">—</option>
              <option value="west">west</option>
              <option value="east">east</option>
            </select>
          </label>
          <label className="field">
            <span>Spot</span>
            <select value={form.spot_id} onChange={(e) => upd("spot_id", e.target.value)}>
              <option value="">—</option>
              {spots.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field full">
          <span>Notes</span>
          <textarea value={form.notes} onChange={(e) => upd("notes", e.target.value)} rows={2} />
        </label>
        <label className="field full">
          <span>Photo</span>
          <input type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
        <button className="btn-primary" disabled={saving} type="submit">
          {saving ? "Saving…" : "Save sighting"}
        </button>
      </form>

      <div className="panel">
        <div className="panel-head">
          <h3>Logbook <span className="badge">{sightings.length}</span></h3>
        </div>
        {sightings.length === 0 ? (
          <div className="empty">No sightings yet. Catch a heavy and log it!</div>
        ) : (
          <div className="sighting-list">
            {sightings.map((s) => (
              <div key={s.id} className="sighting">
                {s.photo_url && <img className="sighting-photo" src={s.photo_url} alt="" />}
                <div className="sighting-body">
                  <div className="sighting-title">
                    {s.type_label || s.type_code || "?"}
                    {s.operator ? ` · ${s.operator}` : ""}
                    {s.family && <span className={`fam-badge fam-${s.family}`}>{s.family}</span>}
                  </div>
                  <div className="sighting-meta">
                    {s.registration || "—"} · {new Date(s.seen_at).toLocaleString()}
                    {s.runway ? ` · ${s.runway}` : ""}
                  </div>
                  {s.notes && <div className="sighting-notes">{s.notes}</div>}
                </div>
                <button className="x" onClick={() => remove(s.id)} aria-label="delete">
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  v,
  on,
  placeholder,
}: {
  label: string;
  v: string;
  on: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} placeholder={placeholder} />
    </label>
  );
}
