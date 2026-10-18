import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AtcPlayer } from "../hooks/useAtcAudio";
import type { FeedCaptionState } from "../hooks/useAtcTranscript";
import { findFeed } from "../lib/atcFeeds";
import type { CaptionLine } from "../types";

interface Props {
  players: AtcPlayer[];
  lines: CaptionLine[];
  feeds: FeedCaptionState[];
  available: boolean | undefined; // from /api/config; undefined while loading
  onClear: () => void;
}

// Phrases a spotter cares about: clearances, go-arounds, and the "heavy"/"super" suffix.
const KEYWORDS =
  /(cleared (?:to land|for take ?off|to cross|for the option)|go[- ]around|line up and wait|hold short|hold position|runway (?:(?:zero|one|two|three|four|five|six|seven|eight|niner?)\s*){1,2}(?:left|right|center)?|mayday|pan[- ]pan|emergency|wake turbulence|traffic alert|\bheavy\b|\bsuper\b)/gi;

const TAG_COLORS = ["#0a84ff", "#ff9500", "#34c759", "#af52de", "#ff375f", "#5ac8fa"];

function highlight(text: string): ReactNode {
  const parts = text.split(KEYWORDS);
  if (parts.length === 1) return text;
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className={`atc-kw ${/^(heavy|super)$/i.test(p) ? "heavy" : ""}`}>
        {p}
      </mark>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  );
}

function fmtTime(t: number): string {
  const d = new Date(t * 1000);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function shortFeedName(mount: string, multiAirport: boolean): string {
  const hit = findFeed(mount);
  if (!hit) return mount;
  const name = hit.feed.name.replace(new RegExp(`^${hit.airport.icao}\\s+`, "i"), "");
  return multiAirport ? `${hit.airport.icao} ${name}` : name;
}

function engineLabel(f: FeedCaptionState | undefined): { text: string; tone: string } {
  if (!f) return { text: "connecting…", tone: "wait" };
  if (f.engine === "unavailable") return { text: "captions unavailable", tone: "off" };
  if (f.engine === "error") return { text: "engine error", tone: "bad" };
  if (f.engine === "loading") return { text: `loading Whisper ${f.model ?? ""}…`, tone: "wait" };
  if (f.stream === "socket") return { text: "connecting…", tone: "wait" };
  if (f.stream === "connecting") return { text: "tuning in…", tone: "wait" };
  if (f.stream === "error") return { text: "stream dropped - retrying", tone: "bad" };
  if (f.stream === "stopped") return { text: "stopped", tone: "off" };
  if ((f.backlog ?? 0) > 3) return { text: `listening · ${f.backlog} queued`, tone: "warn" };
  return { text: "listening", tone: "ok" };
}

export default function AtcTranscript({ players, lines, feeds, available, onClear }: Props) {
  const [follow, setFollow] = useState(true);
  const [only, setOnly] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const playingMounts = useMemo(() => players.map((p) => p.mount), [players]);
  const allMounts = useMemo(() => {
    const s = new Set<string>(playingMounts);
    for (const l of lines) s.add(l.mount);
    return Array.from(s);
  }, [playingMounts, lines]);

  const multiAirport = useMemo(() => {
    const icaos = new Set(allMounts.map((m) => findFeed(m)?.airport.icao ?? m));
    return icaos.size > 1;
  }, [allMounts]);

  const colorOf = useMemo(() => {
    const map = new Map<string, string>();
    allMounts.forEach((m, i) => map.set(m, TAG_COLORS[i % TAG_COLORS.length]));
    return (m: string) => map.get(m) ?? TAG_COLORS[0];
  }, [allMounts]);

  const visible = useMemo(() => (only ? lines.filter((l) => l.mount === only) : lines), [lines, only]);

  // Auto-scroll while following; stop following if the user scrolls up.
  useEffect(() => {
    const el = listRef.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [visible, follow]);

  function onScroll() {
    const el = listRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom !== follow) setFollow(atBottom);
  }

  async function copyAll() {
    const text = visible
      .map((l) => `[${fmtTime(l.t)}] ${shortFeedName(l.mount, true)}: ${l.text}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked; nothing to do */
    }
  }

  const anyPlaying = players.length > 0;
  const firstFeed = feeds[0];
  const headline = engineLabel(anyPlaying ? firstFeed : undefined);
  const unavailable = available === false || feeds.some((f) => f.engine === "unavailable");
  const detail = feeds.find((f) => f.detail)?.detail;

  return (
    <div className="panel atc-tx">
      <div className="panel-head">
        <h3>
          Live transcript{" "}
          {lines.length > 0 && <span className="badge">{visible.length}</span>}
        </h3>
        <div className="atc-tx-actions">
          {!follow && visible.length > 0 && (
            <button className="mini" onClick={() => setFollow(true)}>
              ↓ Latest
            </button>
          )}
          {visible.length > 0 && (
            <button className="mini" onClick={copyAll} title="Copy transcript">
              {copied ? "Copied" : "Copy"}
            </button>
          )}
          {lines.length > 0 && (
            <button className="mini" onClick={onClear}>
              Clear
            </button>
          )}
        </div>
      </div>

      {anyPlaying && (
        <div className="atc-tx-status">
          <span className={`atc-tx-engine ${headline.tone}`}>
            <i />
            {headline.text}
          </span>
          {feeds.some((f) => f.engine === "ready") && firstFeed?.model && (
            <span className="muted">Whisper {firstFeed.model}</span>
          )}
          {allMounts.length > 1 && (
            <div className="atc-tx-feeds">
              <button className={`atc-tag ${only === null ? "on" : ""}`} onClick={() => setOnly(null)}>
                All
              </button>
              {allMounts.map((m) => {
                const f = feeds.find((x) => x.mount === m);
                const live = playingMounts.includes(m);
                return (
                  <button
                    key={m}
                    className={`atc-tag ${only === m ? "on" : ""} ${live ? "" : "ended"}`}
                    style={{ ["--tag" as string]: colorOf(m) }}
                    onClick={() => setOnly(only === m ? null : m)}
                    title={f ? engineLabel(f).text : "stopped"}
                  >
                    <b />
                    {shortFeedName(m, multiAirport)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {unavailable && (
        <div className="atc-tx-note warn">
          Captions need the speech engine on the backend:{" "}
          <code>pip install faster-whisper av</code> in <code>backend/</code>, then restart.
          {detail ? ` (${detail})` : ""}
        </div>
      )}
      {!unavailable && feeds.some((f) => f.engine === "error") && detail && (
        <div className="atc-tx-note warn">{detail}</div>
      )}

      {!anyPlaying && lines.length === 0 ? (
        <div className="empty">Play a feed above and its transmissions will be captioned here.</div>
      ) : visible.length === 0 ? (
        <div className="empty">
          {feeds.some((f) => f.engine === "loading")
            ? "Loading the speech model - the first run downloads it (about 1.5 GB), later starts take a second."
            : "Listening… each transmission is captioned a few seconds after it ends."}
        </div>
      ) : (
        <div className="atc-tx-list" ref={listRef} onScroll={onScroll}>
          {visible.map((l) => (
            <div key={l.id} className={`atc-tx-line ${l.low ? "low" : ""}`} title={`confidence ${(l.confidence * 100).toFixed(0)}% · ${l.duration.toFixed(1)} s · captioned ${l.latency.toFixed(0)} s after`}>
              <span className="atc-tx-time">{fmtTime(l.t)}</span>
              {allMounts.length > 1 && (
                <span className="atc-tx-tag" style={{ ["--tag" as string]: colorOf(l.mount) }}>
                  {shortFeedName(l.mount, multiAirport)}
                </span>
              )}
              <span className="atc-tx-text">{highlight(l.text)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="atc-tx-foot">
        Machine captions (Whisper, running on this server from the same LiveATC stream). Callsigns and numbers
        are often wrong and whole transmissions get missed in noise - for following along only, never for
        anything operational. Dimmed lines are low confidence.
      </div>
    </div>
  );
}
