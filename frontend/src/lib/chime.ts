// Tiny Web Audio chime for inbound/watchlist alerts. No asset files; a two-tone
// "ding-dong" synthesized on the fly. Browsers keep AudioContexts suspended until a
// user gesture, so `unlockAudio()` is called from the sound-toggle click.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  return ctx;
}

/** Call from a user gesture (e.g. enabling the sound toggle) to allow playback. */
export function unlockAudio(): void {
  const c = getCtx();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

function tone(c: AudioContext, freq: number, start: number, dur: number, peak: number) {
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Two-tone doorbell chime; `kind` shifts the pitch so watchlist hits sound distinct. */
export function playChime(kind: "inbound" | "watchlist" = "inbound"): void {
  const c = getCtx();
  if (!c || c.state !== "running") return;
  const t = c.currentTime + 0.01;
  const base = kind === "watchlist" ? 880 : 660; // A5 vs E5
  tone(c, base, t, 0.5, 0.18);
  tone(c, base * 0.75, t + 0.22, 0.7, 0.16);
}
