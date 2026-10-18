import { useMemo, useState } from "react";
import type { AtcPlayer } from "../hooks/useAtcAudio";
import type { FeedCaptionState } from "../hooks/useAtcTranscript";
import type { CaptionLine } from "../types";
import AtcTranscript from "./AtcTranscript";
import {
  ATC_AIRPORTS,
  KIND_LABEL,
  findAirport,
  findFeed,
  groupFeeds,
  liveAtcAirportUrl,
  liveAtcPlayerUrl,
  runwayLabelForFlow,
  type AtcAirport,
  type AtcFeed,
} from "../lib/atcFeeds";

interface Props {
  flow: "west" | "east";
  players: AtcPlayer[];
  onToggle: (mount: string) => void;
  onStop: (mount: string) => void;
  onStopAll: () => void;
  onVolume: (mount: string, v: number) => void;
  onRetry: (mount: string) => void;
  captions: {
    lines: CaptionLine[];
    feeds: FeedCaptionState[];
    available: boolean | undefined;
    onClear: () => void;
  };
}

const ICAO_KEY = "hwl.atc.icao";

function loadIcao(): string {
  try {
    const v = localStorage.getItem(ICAO_KEY);
    if (v && findAirport(v)) return v;
  } catch {
    /* ignore */
  }
  return "KLAX";
}

// Handy LAX presets: the two tower frequencies are split by runway complex.
const LAX_PRESETS: { label: string; hint: string; mounts: string[] }[] = [
  { label: "North tower (24s)", hint: "24L/24R · 133.9", mounts: ["klax3"] },
  { label: "South tower (25s)", hint: "25L/25R · 120.95", mounts: ["klax4"] },
  { label: "Both towers", hint: "North + South", mounts: ["klax3", "klax4"] },
  { label: "Final approach", hint: "North + South finals", mounts: ["klax4n_app_fin_n", "klax3n_app_fin_s"] },
  { label: "Ground + Tower N", hint: "121.65 + 133.9", mounts: ["klax1", "klax3"] },
];

export default function AtcPanel({ flow, players, onToggle, onStop, onStopAll, onVolume, onRetry, captions }: Props) {
  const [icao, setIcao] = useState<string>(loadIcao);
  const [query, setQuery] = useState("");
  const [custom, setCustom] = useState("");
  const airport = findAirport(icao) ?? ATC_AIRPORTS[0];
  const playing = useMemo(() => new Set(players.map((p) => p.mount)), [players]);

  function pick(code: string) {
    setIcao(code);
    try {
      localStorage.setItem(ICAO_KEY, code);
    } catch {
      /* ignore */
    }
  }

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const feeds = q
      ? airport.feeds.filter(
          (f) =>
            f.name.toLowerCase().includes(q) ||
            f.freqs.some((fr) => fr.mhz.includes(q) || fr.facility.toLowerCase().includes(q)) ||
            f.runways.some((r) => r.toLowerCase().includes(q)),
        )
      : airport.feeds;
    return groupFeeds(feeds);
  }, [airport, query]);

  const byCountry = useMemo(() => {
    const groups = new Map<string, AtcAirport[]>();
    for (const a of ATC_AIRPORTS) {
      const key = a.country || "Other";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(a);
    }
    return Array.from(groups.entries());
  }, []);

  const customIcao = custom.trim().toUpperCase();

  return (
    <div className="atc">
      <div className="panel">
        <div className="panel-head">
          <h3>
            Live ATC{" "}
            {players.length > 0 && <span className="badge live">{players.length} on air</span>}
          </h3>
          {players.length > 0 && (
            <button className="mini" onClick={onStopAll}>
              Stop all
            </button>
          )}
        </div>

        {players.length > 0 && (
          <div className="atc-now">
            {players.map((p) => {
              const hit = findFeed(p.mount);
              return (
                <div key={p.mount} className={`atc-now-row ${p.status}`}>
                  <span className={`atc-dot ${p.status}`} />
                  <div className="atc-now-body">
                    <div className="atc-now-name">{hit?.feed.name ?? p.mount}</div>
                    <div className="atc-now-sub">
                      {p.status === "connecting" && "connecting…"}
                      {p.status === "playing" && (hit?.feed.freqs[0]?.mhz ? `${hit.feed.freqs[0].mhz} MHz` : "live")}
                      {p.status === "error" && (
                        <>
                          {p.error ?? "error"} ·{" "}
                          <button className="linklike" onClick={() => onRetry(p.mount)}>
                            retry
                          </button>
                          {hit && (
                            <>
                              {" · "}
                              <a href={liveAtcPlayerUrl(p.mount, hit.airport.icao)} target="_blank" rel="noreferrer">
                                LiveATC player ↗
                              </a>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  <input
                    className="atc-vol"
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={p.volume}
                    onChange={(e) => onVolume(p.mount, Number(e.target.value))}
                    title="Volume"
                  />
                  <button className="x" onClick={() => onStop(p.mount)} title="Stop">
                    ■
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="atc-pick">
          <label className="field">
            Airport
            <select value={airport.icao} onChange={(e) => pick(e.target.value)}>
              {byCountry.map(([country, list]) => (
                <optgroup key={country} label={country}>
                  {list.map((a) => (
                    <option key={a.icao} value={a.icao}>
                      {a.icao} · {a.name}
                      {a.region ? ` (${a.region})` : ""} · {a.feeds.length} feeds
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="field">
            Find a feed
            <input
              placeholder="tower, 133.9, 24L, approach…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>

        {airport.icao === "KLAX" && !query && (
          <div className="atc-presets">
            {LAX_PRESETS.map((p) => {
              const allOn = p.mounts.every((m) => playing.has(m));
              return (
                <button
                  key={p.label}
                  className={`chip ${allOn ? "on target" : ""}`}
                  title={p.hint}
                  onClick={() => {
                    if (allOn) p.mounts.forEach((m) => onStop(m));
                    else p.mounts.forEach((m) => !playing.has(m) && onToggle(m));
                  }}
                >
                  {allOn ? "■" : "▶"} {p.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="atc-airport-meta">
          <b>{airport.icao}</b> · {airport.name}
          {airport.city ? ` · ${airport.city}` : ""}
          {airport.region ? `, ${airport.region}` : ""}
          {" · "}
          <a href={liveAtcAirportUrl(airport.icao)} target="_blank" rel="noreferrer">
            on LiveATC ↗
          </a>
        </div>
      </div>

      <AtcTranscript
        players={players}
        lines={captions.lines}
        feeds={captions.feeds}
        available={captions.available}
        onClear={captions.onClear}
      />

      {grouped.length === 0 && (
        <div className="panel">
          <div className="empty">No feeds match “{query}”.</div>
        </div>
      )}

      {grouped.map((g) => (
        <div className="panel" key={g.kind}>
          <div className="panel-head">
            <h3>
              {KIND_LABEL[g.kind]} <span className="badge">{g.feeds.length}</span>
            </h3>
          </div>
          <div className="atc-feeds">
            {g.feeds.map((f) => (
              <FeedRow
                key={f.mount}
                feed={f}
                icao={airport.icao}
                flow={flow}
                player={players.find((p) => p.mount === f.mount)}
                onToggle={() => onToggle(f.mount)}
              />
            ))}
          </div>
        </div>
      ))}

      <div className="panel atc-other">
        <div className="panel-head">
          <h3>Another airport?</h3>
        </div>
        <p className="muted small">
          This catalog covers {ATC_AIRPORTS.length} North American airports. LiveATC lists feeds for
          hundreds more - enter an ICAO code to open its page.
        </p>
        <div className="atc-custom">
          <input
            placeholder="e.g. KSMF"
            maxLength={4}
            value={custom}
            onChange={(e) => setCustom(e.target.value.toUpperCase())}
          />
          <a
            className={`mini ${customIcao.length === 4 ? "" : "disabled"}`}
            href={customIcao.length === 4 ? liveAtcAirportUrl(customIcao) : undefined}
            target="_blank"
            rel="noreferrer"
          >
            Open on LiveATC ↗
          </a>
        </div>
      </div>

      <div className="atc-note">
        <b>About these feeds.</b> The FAA does not publish live ATC audio - there is no government
        stream. All live ATC on the internet comes from <a href="https://www.liveatc.net" target="_blank" rel="noreferrer">LiveATC.net</a>,
        a volunteer network of scanner receivers (feed status and quality vary; some go offline).
        Playback here streams from LiveATC directly into your browser for personal listening.
        LiveATC's terms don't allow their streams in third-party products, so if you publish this
        app, swap the in-app player for the “LiveATC player ↗” links.
      </div>
    </div>
  );
}

function FeedRow({
  feed,
  icao,
  flow,
  player,
  onToggle,
}: {
  feed: AtcFeed;
  icao: string;
  flow: "west" | "east";
  player: AtcPlayer | undefined;
  onToggle: () => void;
}) {
  const on = !!player;
  // Trim the airport prefix - the panel header already says which airport this is.
  const name = feed.name.replace(new RegExp(`^${icao}\\s+`, "i"), "");
  return (
    <div className={`atc-feed ${on ? "on" : ""} ${player?.status ?? ""}`}>
      <button className={`atc-play ${on ? "on" : ""}`} onClick={onToggle} title={on ? "Stop" : "Listen"}>
        {on ? "■" : "▶"}
      </button>
      <div className="atc-feed-body">
        <div className="atc-feed-name">
          {name}
          {feed.runways.length > 0 && (
            <span className="atc-rwys">
              {feed.runways.map((r) => (
                <i key={r}>{runwayLabelForFlow(r, flow)}</i>
              ))}
            </span>
          )}
        </div>
        <div className="atc-feed-freqs">
          {feed.freqs.length === 0 && <span className="muted">frequency not published</span>}
          {feed.freqs.slice(0, 4).map((fr) => (
            <span key={`${fr.facility}-${fr.mhz}`} className="atc-freq" title={fr.facility}>
              {fr.mhz}
            </span>
          ))}
          {feed.freqs.length > 4 && <span className="muted">+{feed.freqs.length - 4}</span>}
          {feed.freqs[0] && <span className="atc-facility">{feed.freqs[0].facility}</span>}
        </div>
      </div>
      <a
        className="atc-ext"
        href={liveAtcPlayerUrl(feed.mount, icao)}
        target="_blank"
        rel="noreferrer"
        title="Open in LiveATC's player"
      >
        ↗
      </a>
    </div>
  );
}
