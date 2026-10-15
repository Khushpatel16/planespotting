import { useEffect, useState } from "react";
import type { Aircraft } from "../types";

interface Rec {
  flow: string;
  phase: string;
  side: string | null;
  appears_from: string;
  altitude_hint: string;
  reason: string;
  primary: { id: string; name: string; notes: string; lat: number; lon: number };
  alternates: { id: string; name: string }[];
}

interface Props {
  flow: "west" | "east";
  selected: Aircraft | null;
  onFocusSpot: (lat: number, lon: number) => void;
}

async function fetchRec(
  flow: string,
  phase: string,
  side?: string | null,
  distance?: number | null,
): Promise<Rec> {
  const q = new URLSearchParams({ flow, phase });
  if (side) q.set("side", side);
  if (distance != null) q.set("distance_nm", String(distance));
  const r = await fetch(`/api/recommend?${q.toString()}`);
  return (await r.json()) as Rec;
}

function RecCard({
  title,
  rec,
  highlight,
  onFocusSpot,
}: {
  title: string;
  rec: Rec | null;
  highlight?: boolean;
  onFocusSpot: (lat: number, lon: number) => void;
}) {
  if (!rec) return null;
  return (
    <div className={`rec-card ${highlight ? "highlight" : ""}`}>
      <div className="rec-title">{title}</div>
      <button className="rec-spot" onClick={() => onFocusSpot(rec.primary.lat, rec.primary.lon)}>
        📍 {rec.primary.name}
      </button>
      <div className="rec-meta">
        Appears from the <b>{rec.appears_from}</b> · {rec.altitude_hint}
      </div>
      <div className="rec-notes">{rec.primary.notes}</div>
      {rec.alternates.length > 0 && (
        <div className="rec-alts">
          Also good: {rec.alternates.map((a) => a.name).join(", ")}
        </div>
      )}
    </div>
  );
}

export default function SpottingPanel({ flow, selected, onFocusSpot }: Props) {
  const [arr, setArr] = useState<Rec | null>(null);
  const [dep, setDep] = useState<Rec | null>(null);
  const [forSel, setForSel] = useState<Rec | null>(null);

  useEffect(() => {
    let live = true;
    fetchRec(flow, "arrival").then((r) => live && setArr(r));
    fetchRec(flow, "departure").then((r) => live && setDep(r));
    return () => {
      live = false;
    };
  }, [flow]);

  const selInbound = selected?.is_inbound && selected.runway;
  useEffect(() => {
    let live = true;
    if (selInbound && selected?.runway) {
      fetchRec(flow, "arrival", selected.runway.complex, selected.distance_nm ?? undefined).then(
        (r) => live && setForSel(r),
      );
    } else {
      setForSel(null);
    }
    return () => {
      live = false;
    };
  }, [flow, selInbound, selected?.runway?.complex, selected?.distance_nm]);

  return (
    <div className="panel">
      <div className="panel-head">
        <h3>Where to stand</h3>
      </div>
      {forSel && selected && (
        <RecCard
          title={`For ${selected.callsign || selected.hex} → likely ${selected.runway?.runway}`}
          rec={forSel}
          highlight
          onFocusSpot={onFocusSpot}
        />
      )}
      <RecCard title="Best for arrivals" rec={arr} onFocusSpot={onFocusSpot} />
      <RecCard title="Best for departures" rec={dep} onFocusSpot={onFocusSpot} />
    </div>
  );
}
