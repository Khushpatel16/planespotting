import { useEffect, useMemo, useState } from "react";
import type { AppConfig, Aircraft, Filters, Sighting, Stats, WatchRule } from "./types";
import { api } from "./api";
import { CAT } from "./lib/colors";
import { useSnapshot } from "./hooks/useSnapshot";
import { useNotifications } from "./hooks/useNotifications";
import { useWatchlist } from "./hooks/useWatchlist";
import { getBasemap, loadBasemapId, saveBasemapId } from "./lib/basemaps";
import { unlockAudio } from "./lib/chime";
import StatusBar from "./components/StatusBar";
import MapView from "./components/MapView";
import FilterBar from "./components/FilterBar";
import FlowPanel from "./components/FlowPanel";
import SpottingPanel from "./components/SpottingPanel";
import AlertsPanel from "./components/AlertsPanel";
import Watchlist from "./components/Watchlist";
import AircraftList from "./components/AircraftList";
import DetailPanel from "./components/DetailPanel";
import Logbook, { type Prefill } from "./components/Logbook";
import StatsDashboard from "./components/StatsDashboard";
import SkyView from "./components/SkyView";

const DEFAULT_FILTERS: Filters = {
  showTargets: true,
  showOtherHeavies: true,
  showAllTraffic: false,
  alertRadiusNm: 60,
  alertOn747: true,
  alertOnA380: true,
  alertOnHeavies: false,
};

function loadFilters(): Filters {
  try {
    const raw = localStorage.getItem("hwl.filters");
    if (raw) return { ...DEFAULT_FILTERS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return DEFAULT_FILTERS;
}

function loadRules(): WatchRule[] {
  try {
    const raw = localStorage.getItem("hwl.watchlist");
    if (raw) return JSON.parse(raw) as WatchRule[];
  } catch {
    /* ignore */
  }
  return [];
}

type Tab = "live" | "logbook" | "stats";

export default function App() {
  const { snapshot, conn } = useSnapshot();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [selectedHex, setSelectedHex] = useState<string | null>(null);
  const [override, setOverride] = useState<"west" | "east" | null>(null);
  const [tab, setTab] = useState<Tab>("live");
  const [focus, setFocus] = useState<{ lat: number; lon: number; zoom?: number } | null>(null);
  const [skyOpen, setSkyOpen] = useState(false);

  const [notifEnabled, setNotifEnabled] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("hwl.sound") === "1",
  );
  const [basemapId, setBasemapId] = useState<string>(loadBasemapId);
  const [rules, setRules] = useState<WatchRule[]>(loadRules);

  function toggleSound() {
    setSoundEnabled((v) => {
      const next = !v;
      if (next) unlockAudio(); // user gesture: allow the AudioContext to run
      try {
        localStorage.setItem("hwl.sound", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);

  // Bootstrap config + current flow override.
  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
    fetch("/api/health")
      .then((r) => r.json())
      .then((h) => setOverride(h.flow_override ?? null))
      .catch(() => {});
    refreshLogbook();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("hwl.filters", JSON.stringify(filters));
    } catch {
      /* ignore */
    }
  }, [filters]);

  useEffect(() => {
    try {
      localStorage.setItem("hwl.watchlist", JSON.stringify(rules));
    } catch {
      /* ignore */
    }
  }, [rules]);

  // The whole UI follows the basemap: light UI on the light map, dark radar UI otherwise.
  const theme = getBasemap(basemapId).theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    saveBasemapId(basemapId);
  }, [basemapId, theme]);

  function refreshLogbook() {
    api.listSightings().then(setSightings).catch(() => {});
    api.getStats().then(setStats).catch(() => {});
  }

  async function onSetFlow(flow: "west" | "east" | null) {
    setOverride(flow);
    try {
      await api.setFlow(flow);
    } catch {
      /* ignore */
    }
  }

  const flow = snapshot?.flow.flow ?? "west";
  const alerts = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.alerts.filter((a) => (a.distance_nm ?? 999) <= filters.alertRadiusNm);
  }, [snapshot, filters.alertRadiusNm]);

  const { perm, request } = useNotifications(alerts, filters, notifEnabled, soundEnabled);
  const { matches: watchMatches, matchedHexes } = useWatchlist(
    snapshot,
    rules,
    notifEnabled,
    perm,
    soundEnabled,
  );

  const displayed: Aircraft[] = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.aircraft.filter((a) => {
      if (a.type.is_target) return filters.showTargets;
      if (a.type.is_heavy) return filters.showOtherHeavies;
      return filters.showAllTraffic;
    });
  }, [snapshot, filters]);

  const selected = useMemo(
    () => snapshot?.aircraft.find((a) => a.hex === selectedHex) ?? null,
    [snapshot, selectedHex],
  );

  function selectAndFocus(hex: string) {
    setSelectedHex(hex);
    const ac = snapshot?.aircraft.find((a) => a.hex === hex);
    if (ac?.lat != null && ac?.lon != null) setFocus({ lat: ac.lat, lon: ac.lon, zoom: 9.5 });
  }

  function watchAircraft(ac: Aircraft) {
    const reg = ac.registration?.trim();
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `r${Date.now()}`;
    const label = reg
      ? `${ac.operator.name || ac.operator.code || ac.type.friendly_name} ${reg}`
      : ac.operator.name || ac.operator.code || ac.type.friendly_name;
    const rule: WatchRule = {
      id,
      label,
      enabled: true,
      // A specific tail is the most precise match; otherwise watch this operator + family.
      operator: reg ? "" : ac.operator.name || ac.operator.code || "",
      family: reg ? "any" : ac.type.family,
      typeCode: "",
      registration: reg || "",
      callsign: "",
      destination: "",
      inboundOnly: false,
    };
    setRules((rs) => [rule, ...rs]);
    setTab("live");
  }

  function onLog(ac: Aircraft) {
    setPrefill({
      type_code: ac.type_code,
      type_label: ac.type.family === "A380" ? "A380" : ac.type.friendly_name,
      variant: ac.type.variant,
      registration: ac.registration,
      operator: ac.operator.name || ac.operator.code,
      callsign: ac.callsign,
      hex: ac.hex,
      flow,
      runway: ac.runway?.runway ?? null,
    });
    setTab("logbook");
  }

  return (
    <div className="app">
      <StatusBar snapshot={snapshot} conn={conn} />

      <div className="main">
        <div className="map-wrap">
          <MapView
            aircraft={displayed}
            config={config}
            flow={flow}
            selectedHex={selectedHex}
            onSelect={setSelectedHex}
            focus={focus}
            watchedHexes={matchedHexes}
            basemapId={basemapId}
            onBasemapChange={setBasemapId}
          />
          <div className="map-legend">
            <span><i className="sw" style={{ background: CAT.a380 }} /> A380</span>
            <span><i className="sw" style={{ background: CAT.b747 }} /> 747</span>
            <span><i className="sw" style={{ background: CAT.heavy }} /> heavy</span>
            <span><i className="sw" style={{ background: CAT.other }} /> other</span>
            <span><i className="sw ring" style={{ borderColor: "#af52de" }} /> watchlist</span>
            <span><i className="sw" style={{ background: "#30b0c7" }} /> airports</span>
            <span><i className="sw line" style={{ background: CAT.approach }} /> approach</span>
          </div>
          {selected && (
            <DetailPanel
              ac={selected}
              onClose={() => setSelectedHex(null)}
              onLog={onLog}
              onWatch={watchAircraft}
            />
          )}
          <button className="sky-open" onClick={() => setSkyOpen(true)} title="Point your camera at the sky to identify aircraft">
            🔭 Sky View
          </button>
        </div>

        <aside className="rail">
          <nav className="tabs">
            <button className={tab === "live" ? "active" : ""} onClick={() => setTab("live")}>
              Live
            </button>
            <button
              className={tab === "logbook" ? "active" : ""}
              onClick={() => {
                setTab("logbook");
                refreshLogbook();
              }}
            >
              Logbook
            </button>
            <button
              className={tab === "stats" ? "active" : ""}
              onClick={() => {
                setTab("stats");
                refreshLogbook();
              }}
            >
              Stats
            </button>
          </nav>

          <div className="rail-body">
            {tab === "live" && (
              <>
                <AlertsPanel
                  alerts={alerts}
                  notifPerm={perm}
                  notifEnabled={notifEnabled}
                  soundEnabled={soundEnabled}
                  onToggleNotif={() => setNotifEnabled((v) => !v)}
                  onToggleSound={toggleSound}
                  onRequestNotif={request}
                  onSelect={selectAndFocus}
                />
                <Watchlist
                  rules={rules}
                  matches={watchMatches}
                  onChange={setRules}
                  onSelect={selectAndFocus}
                />
                {snapshot && (
                  <FlowPanel
                    flow={snapshot.flow}
                    metar={snapshot.metar}
                    override={override}
                    onSetFlow={onSetFlow}
                  />
                )}
                <SpottingPanel
                  flow={flow}
                  selected={selected}
                  onFocusSpot={(lat, lon) => setFocus({ lat, lon, zoom: 12 })}
                />
                <FilterBar filters={filters} onChange={setFilters} counts={snapshot?.counts ?? {}} />
                <AircraftList aircraft={displayed} selectedHex={selectedHex} onSelect={selectAndFocus} />
              </>
            )}

            {tab === "logbook" && config && (
              <Logbook spots={config.spots} prefill={prefill} sightings={sightings} onChanged={refreshLogbook} />
            )}

            {tab === "stats" && <StatsDashboard stats={stats} />}
          </div>
        </aside>
      </div>

      {skyOpen && (
        <SkyView
          aircraft={snapshot?.aircraft ?? []}
          generatedAt={snapshot?.generated_at ?? null}
          onClose={() => setSkyOpen(false)}
          onShowOnMap={selectAndFocus}
        />
      )}
    </div>
  );
}
