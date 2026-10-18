"""ATC caption helpers: phrase cleanup, energy VAD, mount validation."""

from __future__ import annotations

import numpy as np
import pytest

from app.atc_transcribe import (
    FRAME,
    SAMPLE_RATE,
    MOUNT_RE,
    Segmenter,
    clean_text,
    collapse_repeats,
)


# --- cleanup -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("cleared to land, cleared to land, cleared to land, cleared to land", "cleared to land, cleared to land"),
        ("JetBlue nine fifty three, JetBlue nine fifty three.", "JetBlue nine fifty three, JetBlue nine fifty three."),
        ("  runway   three  one  left  ", "runway three one left"),
        ("thank you", ""),
        ("Thanks for watching.", ""),
        ("♪", ""),
        ("...", ""),
        ("", ""),
    ],
)
def test_clean_text(raw: str, expected: str) -> None:
    assert clean_text(raw) == expected


def test_collapse_repeats_keeps_two() -> None:
    assert collapse_repeats("a, a, a, b") == "a, a, b"


# --- segmenter ---------------------------------------------------------------------------


def _tone(seconds: float, freq: float = 400.0, amp: float = 0.2) -> np.ndarray:
    n = int(seconds * SAMPLE_RATE)
    t = np.arange(n, dtype=np.float32) / SAMPLE_RATE
    return (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def test_segmenter_cuts_on_squelch() -> None:
    segs: list[float] = []
    s = Segmenter(lambda seg: segs.append(seg.audio.size / SAMPLE_RATE))
    # 0.8 s silence + 1.2 s speech + 0.9 s silence + 0.6 s speech + 1.0 s silence
    s.push(np.concatenate([_silence(0.8), _tone(1.2), _silence(0.9), _tone(0.6), _silence(1.0)]))
    s.flush()
    assert len(segs) == 2
    # Pre-roll 0.2 + speech + post-roll 0.3, plus a bit of leftover silence inside the cut.
    assert 1.2 <= segs[0] <= 2.0
    assert 0.6 <= segs[1] <= 1.5


def test_segmenter_drops_clicks() -> None:
    segs: list[np.ndarray] = []
    s = Segmenter(lambda seg: segs.append(seg.audio))
    # 80 ms of tone is under min_speech_ms (400).
    s.push(np.concatenate([_silence(0.4), _tone(0.08), _silence(1.0)]))
    s.flush()
    assert segs == []


def test_segmenter_caps_long_transmission() -> None:
    segs: list[float] = []
    s = Segmenter(lambda seg: segs.append(seg.audio.size / SAMPLE_RATE), max_ms=2000)
    s.push(_tone(3.5))
    s.flush()
    assert len(segs) >= 1
    assert all(d <= 2.2 for d in segs)


def test_segmenter_adaptive_floor() -> None:
    segs: list[np.ndarray] = []
    s = Segmenter(lambda seg: segs.append(seg.audio), min_threshold=0.01)
    # Quiet hiss well below the default floor, then a louder transmission.
    hiss = (0.002 * np.random.default_rng(0).standard_normal(int(2.0 * SAMPLE_RATE))).astype(np.float32)
    s.push(np.concatenate([hiss, _tone(0.8, amp=0.15), _silence(1.0)]))
    s.flush()
    assert len(segs) == 1


# --- mount -------------------------------------------------------------------------------


@pytest.mark.parametrize("mount", ["klax3", "kjfk_twr", "klax4n_app_fin_n", "katl_app_fin_v"])
def test_mount_ok(mount: str) -> None:
    assert MOUNT_RE.match(mount)


@pytest.mark.parametrize("mount", ["", "KLAX3", "../etc", "klax 3", "x" * 60, "klax;rm"])
def test_mount_rejected(mount: str) -> None:
    assert not MOUNT_RE.match(mount)


def test_frame_size() -> None:
    assert FRAME == 320
    assert SAMPLE_RATE == 16000
