import type { AppConfig, CountryFilter, Filters, WideSnapshot } from "../types";
import type { WideState } from "../hooks/useWide";
import { timeAgo } from "../lib/format";

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  counts: Record<string, number>; // local (LAX radius) snapshot counts
  wide: WideSnapshot | null;
  wideState: WideState;
  config: AppConfig | null;
  shown: number; // aircraft currently drawn on the map after all filters
  onReset: () => void;
}

const COUNTRY_LABEL: Record<CountryFilter, string> = {
  any: "Any country",
  USA: "United States",
  CAN: "Canada",
  MEX: "Mexico",
};

// Fallback vocab so the panel renders before /api/config arrives.
const FALLBACK_CATEGORIES: AppConfig["traffic_categories"] = [
  { id: "all", label: "All Traffic", group: "General" },
  { id: "passenger", label: "Passenger", group: "General" },
  { id: "cargo", label: "Cargo", group: "General" },
];

export default function FilterBar({ filters, onChange, counts, wide, wideState, config, shown, onReset }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const categories = config?.traffic_categories ?? FALLBACK_CATEGORIES;
  const states = config?.us_states ?? [];
  const groups = Array.from(new Set(categories.map((c) => c.group)));
  const tiersActive = filters.traffic === "all";

  // Per-category tallies = local snapshot + (filtered) wide layer.
  const catCount = (id: string) => {
    const local = counts[`cat:${id}`] ?? 0;
    const far = filters.showWide ? (wide?.counts[`cat:${id}`] ?? 0) : 0;
    return local + far;
  };
  const countryCount = (code: string) => {
    const local = counts[`country:${code}`] ?? 0;
    const far = filters.showWide ? (wide?.counts[`country:${code}`] ?? 0) : 0;
    return local + far;
  };

  const isDefault =
    filters.country === "any" && filters.state === "" && filters.traffic === "all";

  return (
    <div className="panel filters">
      <div className="panel-head">
        <h3>
          Filters <span className="badge">{shown} shown</span>
        </h3>
        {!isDefault && (
          <button className="mini" onClick={onReset}>
            Reset
          </button>
        )}
      </div>

      {/* ---- Coverage ---- */}
      <div className="filter-section">
        <div className="filter-sub">Coverage</div>
        <div className="seg">
          <button className={!filters.showWide ? "active" : ""} onClick={() => set({ showWide: false })}>
            LAX · {config?.defaults.search_radius_nm ?? 250} nm
          </button>
          <button className={filters.showWide ? "active" : ""} onClick={() => set({ showWide: true })}>
            + North America
          </button>
        </div>
        {filters.showWide && (
          <div className="filter-hint">
            {wideState === "ok" && wide && (
              <>
                NA sweep: <b>{wide.counts.total ?? 0}</b> aircraft beyond LAX · updated {timeAgo(wide.generated_at)}
                {wide.coverage.last_sweep_seconds != null && ` · ${wide.coverage.tiles} tiles / ${Math.round(wide.coverage.last_sweep_seconds)} s`}
                {wide.stale && " · stale"}
              </>
            )}
            {wideState === "loading" && "Loading the North America layer…"}
            {wideState === "waiting" && "First continental sweep in progress (takes ~2 min)…"}
            {wideState === "error" && "North America layer unavailable right now."}
          </div>
        )}
      </div>

      {/* ---- Region ---- */}
      <div className="filter-section">
        <div className="filter-sub">Region</div>
        <div className="filter-grid">
          <label className="field">
            Country
            <select
              value={filters.country}
              onChange={(e) => {
                const c = e.target.value as CountryFilter;
                set({ country: c, state: c === "USA" || c === "any" ? filters.state : "" });
              }}
            >
              {(Object.keys(COUNTRY_LABEL) as CountryFilter[]).map((c) => (
                <option key={c} value={c}>
                  {COUNTRY_LABEL[c]}
                  {c !== "any" ? ` (${countryCount(c)})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            US state
            <select
              value={filters.state}
              disabled={filters.country === "CAN" || filters.country === "MEX"}
              onChange={(e) => {
                const s = e.target.value;
                set({ state: s, country: s ? "USA" : filters.country });
              }}
            >
              <option value="">{filters.country === "USA" || filters.country === "any" ? "Any state" : "—"}</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* ---- Traffic class ---- */}
      <div className="filter-section">
        <div className="filter-sub">Traffic</div>
        <label className="field">
          <select value={filters.traffic} onChange={(e) => set({ traffic: e.target.value })}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {categories
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} ({catCount(c.id)})
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </label>
      </div>

      {/* ---- Tiers (original quick toggles) ---- */}
      <div className={`filter-section ${tiersActive ? "" : "dim"}`}>
        <div className="filter-sub">
          Show {tiersActive ? "" : <span className="filter-hint-inline">(a traffic class is selected - it decides what is shown)</span>}
        </div>
        <div className="filter-chips">
          <button
            className={`chip target ${filters.showTargets ? "on" : ""}`}
            onClick={() => set({ showTargets: !filters.showTargets })}
          >
            747 / A380 <span className="chip-count">{counts.targets ?? 0}</span>
          </button>
          <button
            className={`chip heavy ${filters.showOtherHeavies ? "on" : ""}`}
            onClick={() => set({ showOtherHeavies: !filters.showOtherHeavies })}
          >
            Other heavies <span className="chip-count">{(counts.heavies ?? 0) - (counts.targets ?? 0)}</span>
          </button>
          <button
            className={`chip all ${filters.showAllTraffic ? "on" : ""}`}
            onClick={() => set({ showAllTraffic: !filters.showAllTraffic })}
          >
            All traffic <span className="chip-count">{counts.total ?? 0}</span>
          </button>
        </div>
      </div>

      {/* ---- Alerts (LAX inbound) ---- */}
      <div className="filter-section">
        <div className="filter-radius">
          <label className="filter-sub" htmlFor="alert-radius">
            Alert radius: <b>{filters.alertRadiusNm} nm</b>
          </label>
          <input
            id="alert-radius"
            type="range"
            min={10}
            max={60}
            step={5}
            value={filters.alertRadiusNm}
            onChange={(e) => set({ alertRadiusNm: Number(e.target.value) })}
          />
        </div>

        <div className="filter-alerts">
          <div className="filter-sub">Alert me on:</div>
          <label>
            <input type="checkbox" checked={filters.alertOnA380} onChange={() => set({ alertOnA380: !filters.alertOnA380 })} />
            A380
          </label>
          <label>
            <input type="checkbox" checked={filters.alertOn747} onChange={() => set({ alertOn747: !filters.alertOn747 })} />
            747
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.alertOnHeavies}
              onChange={() => set({ alertOnHeavies: !filters.alertOnHeavies })}
            />
            other heavies
          </label>
        </div>
      </div>
    </div>
  );
}
