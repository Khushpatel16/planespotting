import type { Filters } from "../types";

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  counts: Record<string, number>;
}

export default function FilterBar({ filters, onChange, counts }: Props) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Filters</h3>
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
  );
}
