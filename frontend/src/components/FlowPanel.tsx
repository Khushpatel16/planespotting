import type { FlowInfo, MetarInfo } from "../types";
import RunwayDiagram from "./RunwayDiagram";

interface Props {
  flow: FlowInfo;
  metar: MetarInfo | null;
  override: "west" | "east" | null;
  onSetFlow: (flow: "west" | "east" | null) => void;
}

function windText(m: MetarInfo | null): string {
  if (!m) return "no METAR";
  if (m.wind_variable) return `variable @ ${m.wind_speed_kt ?? 0} kt`;
  if (m.wind_dir_deg === null) return "calm";
  const gust = m.wind_gust_kt ? ` G${Math.round(m.wind_gust_kt)}` : "";
  return `${Math.round(m.wind_dir_deg)}° @ ${Math.round(m.wind_speed_kt ?? 0)}${gust} kt`;
}

export default function FlowPanel({ flow, metar, override, onSetFlow }: Props) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Flow & spotting setup</h3>
        <span className={`flow-chip ${flow.flow}`}>{flow.flow.toUpperCase()} FLOW</span>
      </div>

      <RunwayDiagram flow={flow.flow} />

      <div className="kv">
        <div>
          <span className="k">Wind</span>
          <span className="v">{windText(metar)}</span>
        </div>
        <div>
          <span className="k">Inference</span>
          <span className="v">
            {flow.source === "manual" ? "manual override" : flow.reason}
            {flow.source !== "manual" && (
              <em className={`conf ${flow.confidence}`}> ({flow.confidence} confidence)</em>
            )}
          </span>
        </div>
        {metar && (
          <div>
            <span className="k">METAR</span>
            <span className="v metar-raw">{metar.raw || "—"}</span>
          </div>
        )}
      </div>

      <div className="seg">
        <span className="seg-label">Flow:</span>
        <button className={override === null ? "active" : ""} onClick={() => onSetFlow(null)}>
          Auto
        </button>
        <button className={override === "west" ? "active" : ""} onClick={() => onSetFlow("west")}>
          Force West
        </button>
        <button className={override === "east" ? "active" : ""} onClick={() => onSetFlow("east")}>
          Force East
        </button>
      </div>
    </div>
  );
}
