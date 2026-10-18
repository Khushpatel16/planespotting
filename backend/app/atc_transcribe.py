"""Live captions for ATC audio: pull a LiveATC stream server-side, decode it, cut it into
transmissions on squelch silence, and run each one through Whisper (faster-whisper).

Why server-side: the browser plays LiveATC fine, but the stream has no CORS headers, so
page JavaScript cannot tap the decoded audio. The backend fetches its own copy of the
stream (LiveATC only blocks requests without a browser-like User-Agent), so a feed that
is being captioned costs one extra listener connection.

Architecture (all per mount, all plain threads so the asyncio loop never blocks):

    downloader thread  -> bytes queue -> decoder thread (PyAV) -> 16 kHz mono PCM
                                                                -> Segmenter (energy VAD)
                                                                -> shared transcribe queue
    transcriber thread (one for the process; owns the Whisper model) -> TranscriptLine
                                                                       -> asyncio fan-out

Everything heavy is optional: if faster-whisper isn't installed the WebSocket simply
reports engine="unavailable" and the audio player keeps working.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import queue
import re
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Callable

import httpx
import numpy as np

from app.config import Settings

log = logging.getLogger("hwl.atc")

try:  # heavy optional deps
    import av  # type: ignore

    HAVE_AV = True
except Exception:  # noqa: BLE001
    av = None  # type: ignore
    HAVE_AV = False

try:
    from faster_whisper import WhisperModel  # type: ignore

    HAVE_WHISPER = True
except Exception:  # noqa: BLE001
    WhisperModel = None  # type: ignore
    HAVE_WHISPER = False

SAMPLE_RATE = 16000
FRAME_MS = 20
FRAME = SAMPLE_RATE * FRAME_MS // 1000  # 320 samples

MOUNT_RE = re.compile(r"^[a-z0-9_]{2,48}$")

# Whisper is a general model; priming it with ATC phraseology noticeably improves callsign
# and runway readbacks. The per-feed hint (airport / facility name) is appended.
BASE_PROMPT = (
    "Air traffic control radio. Tower, Ground, Approach, Departure, Center. "
    "Delta four five six heavy, United two twenty three, American nine eleven, Southwest, "
    "JetBlue, FedEx, UPS, Alaska, Skywest, Air Canada, Aeromexico. "
    "Runway two four left, runway two five right, runway three one left. "
    "Cleared to land, cleared for takeoff, line up and wait, hold short, taxi via, "
    "contact ground point six five, go around, wind two five zero at one zero, "
    "traffic, caution wake turbulence, climb and maintain, descend and maintain, "
    "turn left heading two seven zero, reduce speed, expect ILS approach."
)

# Things Whisper says when fed radio noise. Dropped outright.
_HALLUCINATIONS = {
    "you",
    "thank you",
    "thank you.",
    "thanks for watching",
    "thanks for watching.",
    "bye",
    "bye.",
    ".",
    "...",
    "uh",
    "um",
    "so",
    "the",
}
_HALLUCINATION_RE = re.compile(
    r"^(thank you( for watching)?|thanks for watching|subscribe|please subscribe|"
    r"www\.|http|♪|\[.*\]|\(.*\))",
    re.I,
)


@dataclass
class TranscriptLine:
    id: int
    mount: str
    t: float  # epoch seconds when the transmission ended
    duration: float  # seconds of audio
    text: str
    confidence: float  # 0..1 (exp of avg logprob)
    low: bool  # flag for the UI to dim doubtful lines
    latency: float  # seconds between end-of-audio and caption

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "mount": self.mount,
            "t": round(self.t, 3),
            "duration": round(self.duration, 2),
            "text": self.text,
            "confidence": round(self.confidence, 3),
            "low": self.low,
            "latency": round(self.latency, 1),
        }


# ----------------------------------------------------------------------------- text cleanup


def collapse_repeats(text: str, max_repeats: int = 2) -> str:
    """Whisper sometimes loops ("cleared to land, cleared to land, ..."). Keep at most
    `max_repeats` consecutive copies of any comma/period-separated phrase."""
    parts = re.split(r"([,.;!?]\s*)", text)
    # re.split with a capture group alternates [phrase, sep, phrase, sep, ...]
    phrases: list[tuple[str, str]] = []
    for i in range(0, len(parts), 2):
        phrase = parts[i].strip()
        sep = parts[i + 1] if i + 1 < len(parts) else ""
        if phrase:
            phrases.append((phrase, sep))
    out: list[tuple[str, str]] = []
    run = 0
    for phrase, sep in phrases:
        key = phrase.lower()
        if out and out[-1][0].lower() == key:
            run += 1
            if run >= max_repeats:
                continue
        else:
            run = 0
        out.append((phrase, sep))
    joined = "".join(p + (s if s else "") for p, s in out).strip()
    joined = re.sub(r"[,;]\s*$", "", joined)  # leftover sep after a dropped repeat
    return re.sub(r"\s+", " ", joined)


def clean_text(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", " ", text)
    if not text:
        return ""
    if text.lower().strip(" .") in _HALLUCINATIONS or _HALLUCINATION_RE.match(text):
        return ""
    if not re.search(r"[A-Za-z0-9]", text):
        return ""
    return collapse_repeats(text)


# ----------------------------------------------------------------------------- segmenter


@dataclass
class Segment:
    audio: np.ndarray
    ended_at: float  # wall-clock when the last sample arrived


class Segmenter:
    """Energy-based voice activity detection tuned for squelched radio audio.

    LiveATC feeds are near-digital-silence between transmissions, so a simple adaptive
    RMS threshold does a good job of cutting the stream into single transmissions. We
    deliberately do *not* use a neural VAD here: it runs on every frame of every feed,
    and the squelch makes it unnecessary. Whisper's own VAD still runs per segment.
    """

    def __init__(
        self,
        on_segment: Callable[[Segment], None],
        *,
        silence_ms: int = 700,
        max_ms: int = 20000,
        min_speech_ms: int = 400,
        pre_roll_ms: int = 200,
        post_roll_ms: int = 300,
        min_threshold: float = 0.01,
        floor_factor: float = 3.0,
    ) -> None:
        self._cb = on_segment
        self.silence_frames = silence_ms // FRAME_MS
        self.max_frames = max_ms // FRAME_MS
        self.min_speech_frames = min_speech_ms // FRAME_MS
        self.pre_roll = pre_roll_ms // FRAME_MS
        self.post_roll = post_roll_ms // FRAME_MS
        self.min_threshold = min_threshold
        self.floor_factor = floor_factor

        self._carry = np.zeros(0, dtype=np.float32)
        self._recent_rms: deque[float] = deque(maxlen=1500)  # 30 s of frames
        self._threshold = min_threshold
        self._frames_since_calib = 0

        self._pre: deque[np.ndarray] = deque(maxlen=self.pre_roll)
        self._active: list[np.ndarray] = []
        self._speech_frames = 0
        self._silence_run = 0
        self._tail = 0  # post-roll frames still to collect after speech ended

    @property
    def threshold(self) -> float:
        return self._threshold

    def _recalibrate(self) -> None:
        if len(self._recent_rms) >= 50:
            floor = float(np.percentile(np.fromiter(self._recent_rms, dtype=np.float32), 20))
            self._threshold = max(floor * self.floor_factor, self.min_threshold)

    def push(self, pcm: np.ndarray, now: float | None = None) -> None:
        """Feed any amount of 16 kHz mono float32 audio."""
        now = time.time() if now is None else now
        buf = np.concatenate([self._carry, pcm]) if self._carry.size else pcm
        n = buf.size // FRAME
        self._carry = buf[n * FRAME :]
        if n == 0:
            return
        frames = buf[: n * FRAME].reshape(n, FRAME)
        rms = np.sqrt((frames * frames).mean(axis=1))
        # Timestamp of each frame's end, counting back from "now" for the last one.
        frame_end_times = now - (n - 1 - np.arange(n)) * (FRAME_MS / 1000.0)
        for i in range(n):
            self._frame(frames[i], float(rms[i]), float(frame_end_times[i]))

    def _frame(self, frame: np.ndarray, rms: float, t_end: float) -> None:
        self._recent_rms.append(rms)
        self._frames_since_calib += 1
        if self._frames_since_calib >= 50:
            self._frames_since_calib = 0
            self._recalibrate()

        speech = rms > self._threshold
        if not self._active:
            if speech:
                self._active = list(self._pre) + [frame]
                self._speech_frames = 1
                self._silence_run = 0
                self._tail = 0
            else:
                self._pre.append(frame)
            return

        self._active.append(frame)
        if speech:
            self._speech_frames += 1
            self._silence_run = 0
        else:
            self._silence_run += 1

        too_long = len(self._active) >= self.max_frames
        ended = self._silence_run >= self.silence_frames
        if ended or too_long:
            self._finish(t_end)

    def _finish(self, t_end: float) -> None:
        active, self._active = self._active, []
        speech_frames, self._speech_frames = self._speech_frames, 0
        silence_run, self._silence_run = self._silence_run, 0
        if speech_frames < self.min_speech_frames:
            return
        # Trim trailing silence beyond the post-roll so Whisper isn't fed 0.7 s of nothing.
        drop = max(0, silence_run - self.post_roll)
        if drop:
            active = active[:-drop]
            t_end -= drop * FRAME_MS / 1000.0
        audio = np.concatenate(active).astype(np.float32, copy=False)
        self._cb(Segment(audio=audio, ended_at=t_end))

    def flush(self, now: float | None = None) -> None:
        if self._active:
            self._finish(time.time() if now is None else now)


# ----------------------------------------------------------------------------- stream reader


class _QueueReader:
    """File-like adapter: PyAV pulls bytes with read(); the downloader thread pushes them."""

    def __init__(self) -> None:
        self._q: queue.Queue[bytes | None] = queue.Queue(maxsize=512)
        self._buf = b""
        self._eof = False

    def feed(self, chunk: bytes) -> None:
        self._q.put(chunk)

    def close(self) -> None:
        try:
            self._q.put_nowait(None)
        except queue.Full:
            # Drain one and retry: the decoder is behind but we must deliver EOF.
            try:
                self._q.get_nowait()
            except queue.Empty:
                pass
            self._q.put(None)

    def read(self, n: int = -1) -> bytes:
        if self._eof:
            return b""
        while len(self._buf) < max(n, 1):
            chunk = self._q.get()
            if chunk is None:
                self._eof = True
                break
            self._buf += chunk
        if n < 0 or n >= len(self._buf):
            out, self._buf = self._buf, b""
        else:
            out, self._buf = self._buf[:n], self._buf[n:]
        return out


# ----------------------------------------------------------------------------- transcriber


@dataclass
class _Job:
    mount: str
    audio: np.ndarray
    ended_at: float
    prompt: str
    deliver: Callable[[TranscriptLine], None]


class WhisperWorker:
    """Single process-wide worker thread that owns the Whisper model.

    Jobs from every feed go through one queue so the model is loaded once and CPU use is
    bounded. If the queue backs up (several busy feeds at once), the oldest jobs are
    dropped so captions stay roughly live instead of drifting minutes behind.
    """

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.status = "idle" if HAVE_WHISPER else "unavailable"
        self.detail: str | None = None if HAVE_WHISPER else "faster-whisper is not installed"
        self.model_name = settings.atc_transcribe_model
        self._q: queue.Queue[_Job] = queue.Queue()
        self._model: Any = None
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._load_lock = threading.Lock()
        self._next_id = 1
        self.dropped = 0
        self.processed = 0
        self.busy_seconds = 0.0
        self.audio_seconds = 0.0
        self._on_status: list[Callable[[], None]] = []

    # -- lifecycle

    def ensure_started(self) -> None:
        if not HAVE_WHISPER:
            return
        with self._lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._run, name="hwl-whisper", daemon=True)
                self._thread.start()

    def add_status_listener(self, cb: Callable[[], None]) -> None:
        self._on_status.append(cb)

    def _set_status(self, status: str, detail: str | None = None) -> None:
        self.status = status
        self.detail = detail
        for cb in list(self._on_status):
            try:
                cb()
            except Exception:  # noqa: BLE001
                pass

    @property
    def backlog(self) -> int:
        return self._q.qsize()

    def submit(self, job: _Job) -> None:
        self.ensure_started()
        self._q.put(job)
        # Shed load: keep at most N pending transmissions.
        limit = self.settings.atc_transcribe_max_backlog
        while self._q.qsize() > limit:
            try:
                self._q.get_nowait()
                self.dropped += 1
            except queue.Empty:
                break

    # -- worker

    def _load(self) -> bool:
        """Load the model once; safe to call from several threads (preload + worker)."""
        with self._load_lock:
            if self._model is not None:
                return True
            if self.status == "error":
                return False
            self._set_status("loading", f"loading Whisper {self.model_name} (first run downloads it)")
            t0 = time.time()
            threads = self.settings.atc_transcribe_threads or min(8, os.cpu_count() or 4)
            try:
                self._model = WhisperModel(  # type: ignore[misc]
                    self.model_name,
                    device=self.settings.atc_transcribe_device,
                    compute_type=self.settings.atc_transcribe_compute,
                    cpu_threads=threads,
                )
            except Exception as e:  # noqa: BLE001
                log.exception("whisper model load failed")
                self._set_status("error", f"could not load Whisper {self.model_name}: {e}")
                return False
            log.info("whisper %s ready in %.1fs (%d threads)", self.model_name, time.time() - t0, threads)
            self._set_status("ready", None)
            return True

    def _run(self) -> None:
        if not self._load():
            # Drain so producers don't pile up memory; they'll see status=error.
            while True:
                job = self._q.get()
                self.dropped += 1
                del job
        while True:
            job = self._q.get()
            # Skip anything that went stale while waiting.
            if time.time() - job.ended_at > self.settings.atc_transcribe_max_lag_seconds:
                self.dropped += 1
                continue
            try:
                line = self._transcribe(job)
            except Exception:  # noqa: BLE001
                log.exception("transcription failed for %s", job.mount)
                continue
            if line is not None:
                job.deliver(line)

    def _transcribe(self, job: _Job) -> TranscriptLine | None:
        t0 = time.time()
        segments, _info = self._model.transcribe(
            job.audio,
            language="en",
            beam_size=self.settings.atc_transcribe_beam,
            initial_prompt=job.prompt,
            condition_on_previous_text=False,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 150},
            no_speech_threshold=0.6,
            compression_ratio_threshold=2.2,
            log_prob_threshold=-1.2,
        )
        texts: list[str] = []
        logprobs: list[float] = []
        for s in segments:
            if s.no_speech_prob > 0.75 and s.avg_logprob < -0.8:
                continue
            texts.append(s.text)
            logprobs.append(s.avg_logprob)
        dt = time.time() - t0
        self.processed += 1
        self.busy_seconds += dt
        self.audio_seconds += job.audio.size / SAMPLE_RATE
        text = clean_text(" ".join(texts))
        if not text:
            return None
        avg = sum(logprobs) / len(logprobs) if logprobs else -2.0
        conf = max(0.0, min(1.0, math.exp(avg)))
        with self._lock:
            lid = self._next_id
            self._next_id += 1
        return TranscriptLine(
            id=lid,
            mount=job.mount,
            t=job.ended_at,
            duration=job.audio.size / SAMPLE_RATE,
            text=text,
            confidence=conf,
            low=conf < 0.45,
            latency=time.time() - job.ended_at,
        )


# ----------------------------------------------------------------------------- feed session


class FeedSession:
    """One LiveATC mount being captioned: downloader + decoder threads, subscriber fan-out."""

    def __init__(self, mount: str, settings: Settings, worker: WhisperWorker, loop: asyncio.AbstractEventLoop) -> None:
        self.mount = mount
        self.settings = settings
        self.worker = worker
        self.loop = loop
        self.prompt = BASE_PROMPT
        self.stream_status = "connecting"
        self.stream_detail: str | None = None
        self.icy_name: str | None = None
        self.history: deque[dict[str, Any]] = deque(maxlen=settings.atc_transcribe_history)
        self.subscribers: set[asyncio.Queue[str]] = set()
        self.started_at = time.time()
        self.bytes_in = 0
        self.segments = 0
        self._stop = threading.Event()
        self._reader: _QueueReader | None = None
        self._threads: list[threading.Thread] = []
        self._idle_task: asyncio.Task[None] | None = None
        self._pcm_seconds = 0.0

    # -- lifecycle (called on the event loop)

    def start(self) -> None:
        self._threads = [
            threading.Thread(target=self._download_loop, name=f"hwl-atc-dl-{self.mount}", daemon=True),
        ]
        for t in self._threads:
            t.start()

    def stop(self) -> None:
        self._stop.set()
        if self._reader is not None:
            self._reader.close()

    def set_hint(self, hint: str | None) -> None:
        hint = re.sub(r"[^A-Za-z0-9 ,./()#'-]", "", hint or "")[:160].strip()
        self.prompt = f"{hint}. {BASE_PROMPT}" if hint else BASE_PROMPT

    # -- fan-out (event loop thread)

    def status_message(self) -> dict[str, Any]:
        return {
            "type": "atc_status",
            "mount": self.mount,
            "stream": self.stream_status,
            "detail": self.stream_detail or self.worker.detail,
            "icy_name": self.icy_name,
            "engine": self.worker.status,
            "model": self.worker.model_name,
            "backlog": self.worker.backlog,
            "listeners": len(self.subscribers),
        }

    def _broadcast(self, payload: dict[str, Any]) -> None:
        import json

        msg = json.dumps(payload, separators=(",", ":"))
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                pass

    def broadcast_status(self) -> None:
        self._broadcast(self.status_message())

    def _emit_from_thread(self, payload: dict[str, Any]) -> None:
        self.loop.call_soon_threadsafe(self._broadcast, payload)

    def _set_stream_status(self, status: str, detail: str | None = None) -> None:
        self.stream_status = status
        self.stream_detail = detail
        self.loop.call_soon_threadsafe(self.broadcast_status)

    def _deliver(self, line: TranscriptLine) -> None:
        d = line.to_dict()

        def _on_loop() -> None:
            self.history.append(d)
            self._broadcast({"type": "atc_line", "line": d})

        self.loop.call_soon_threadsafe(_on_loop)

    # -- threads

    def _on_segment(self, seg: Segment) -> None:
        self.segments += 1
        self.worker.submit(
            _Job(mount=self.mount, audio=seg.audio, ended_at=seg.ended_at, prompt=self.prompt, deliver=self._deliver)
        )

    def _download_loop(self) -> None:
        """Keep the stream open; on any drop, back off and reconnect until stopped."""
        backoff = 2.0
        headers = {
            "User-Agent": self.settings.atc_stream_user_agent,
            "Accept": "*/*",
            "Referer": "https://www.liveatc.net/",
        }
        url = f"{self.settings.atc_stream_base.rstrip('/')}/{self.mount}"
        while not self._stop.is_set():
            self._set_stream_status("connecting")
            reader = _QueueReader()
            self._reader = reader
            decoder = threading.Thread(
                target=self._decode_loop, args=(reader,), name=f"hwl-atc-dec-{self.mount}", daemon=True
            )
            decoder.start()
            try:
                with httpx.Client(timeout=httpx.Timeout(15.0, read=30.0), follow_redirects=True) as client:
                    with client.stream("GET", url, headers=headers) as r:
                        if r.status_code != 200:
                            raise RuntimeError(f"LiveATC answered HTTP {r.status_code}")
                        ctype = r.headers.get("content-type", "")
                        if not ctype.startswith("audio/") and "octet" not in ctype:
                            raise RuntimeError(f"not an audio stream ({ctype or 'no content-type'})")
                        self.icy_name = r.headers.get("icy-name")
                        self._set_stream_status("listening")
                        backoff = 2.0
                        for chunk in r.iter_bytes():
                            if self._stop.is_set():
                                break
                            self.bytes_in += len(chunk)
                            reader.feed(chunk)
            except Exception as e:  # noqa: BLE001
                if not self._stop.is_set():
                    log.warning("atc stream %s dropped: %s", self.mount, e)
                    self._set_stream_status("error", str(e))
            finally:
                reader.close()
                decoder.join(timeout=5.0)
            if self._stop.is_set():
                break
            self._stop.wait(backoff)
            backoff = min(backoff * 2, 30.0)
        self._set_stream_status("stopped")

    def _decode_loop(self, reader: _QueueReader) -> None:
        if not HAVE_AV:
            self._set_stream_status("error", "PyAV is not installed (pip install av)")
            return
        segmenter = Segmenter(self._on_segment)
        try:
            container = av.open(reader, mode="r")  # type: ignore[union-attr]
            stream = container.streams.audio[0]
            resampler = av.AudioResampler(format="flt", layout="mono", rate=SAMPLE_RATE)  # type: ignore[union-attr]
            for frame in container.decode(stream):
                if self._stop.is_set():
                    break
                for out in resampler.resample(frame):
                    pcm = out.to_ndarray().reshape(-1).astype(np.float32, copy=False)
                    self._pcm_seconds += pcm.size / SAMPLE_RATE
                    segmenter.push(pcm)
        except Exception as e:  # noqa: BLE001
            if not self._stop.is_set() and reader._eof is False:
                log.warning("atc decode %s failed: %s", self.mount, e)
        finally:
            segmenter.flush()


# ----------------------------------------------------------------------------- manager


class AtcTranscriber:
    """Owns the Whisper worker and the per-mount sessions; API for the WebSocket route."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.worker = WhisperWorker(settings)
        self.sessions: dict[str, FeedSession] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        self.worker.add_status_listener(self._on_worker_status)

    @property
    def available(self) -> bool:
        return self.settings.atc_transcribe_enabled and HAVE_WHISPER and HAVE_AV

    def start(self) -> None:
        self._loop = asyncio.get_running_loop()
        if self.available and self.settings.atc_transcribe_preload:
            # Load the model at boot so the first caption isn't a 30-80 s wait.
            self.worker.ensure_started()
            threading.Thread(target=self.worker._load, name="hwl-whisper-preload", daemon=True).start()

    def stop(self) -> None:
        for s in list(self.sessions.values()):
            s.stop()
        self.sessions.clear()

    def _on_worker_status(self) -> None:
        if self._loop is None:
            return
        for s in list(self.sessions.values()):
            self._loop.call_soon_threadsafe(s.broadcast_status)

    def status(self) -> dict[str, Any]:
        return {
            "enabled": self.settings.atc_transcribe_enabled,
            "available": self.available,
            "engine": self.worker.status,
            "detail": self.worker.detail,
            "model": self.worker.model_name,
            "backlog": self.worker.backlog,
            "processed": self.worker.processed,
            "dropped": self.worker.dropped,
            "realtime_factor": (
                round(self.worker.busy_seconds / self.worker.audio_seconds, 2) if self.worker.audio_seconds else None
            ),
            "sessions": [
                {
                    "mount": s.mount,
                    "stream": s.stream_status,
                    "listeners": len(s.subscribers),
                    "segments": s.segments,
                    "lines": len(s.history),
                    "kbytes_in": round(s.bytes_in / 1024),
                    "uptime_s": round(time.time() - s.started_at),
                }
                for s in self.sessions.values()
            ],
        }

    # -- subscriptions (event loop)

    def subscribe(self, mount: str, hint: str | None) -> tuple[FeedSession, asyncio.Queue[str]]:
        if self._loop is None:
            self._loop = asyncio.get_running_loop()
        session = self.sessions.get(mount)
        if session is None:
            if len(self.sessions) >= self.settings.atc_max_sessions:
                raise RuntimeError(f"at most {self.settings.atc_max_sessions} feeds can be captioned at once")
            session = FeedSession(mount, self.settings, self.worker, self._loop)
            session.set_hint(hint)
            self.sessions[mount] = session
            self.worker.ensure_started()
            session.start()
            log.info("atc captions started for %s", mount)
        elif hint and session.prompt == BASE_PROMPT:
            session.set_hint(hint)
        if session._idle_task is not None:
            session._idle_task.cancel()
            session._idle_task = None
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=256)
        session.subscribers.add(q)
        return session, q

    def unsubscribe(self, session: FeedSession, q: asyncio.Queue[str]) -> None:
        session.subscribers.discard(q)
        if session.subscribers:
            return

        async def _idle_stop() -> None:
            await asyncio.sleep(self.settings.atc_idle_stop_seconds)
            if not session.subscribers and self.sessions.get(session.mount) is session:
                session.stop()
                del self.sessions[session.mount]
                log.info("atc captions stopped for %s (no listeners)", session.mount)

        session._idle_task = asyncio.ensure_future(_idle_stop())
