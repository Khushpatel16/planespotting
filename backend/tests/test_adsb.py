import httpx
import pytest

from app.config import get_settings
from app.sources.adsb import AdsbClient, _normalize_adsbexchange

SETTINGS = get_settings()


def _client() -> AdsbClient:
    return AdsbClient(SETTINGS, client=httpx.AsyncClient())


def test_normalize_ground_and_fields():
    raw = {
        "hex": "ABC123", "flight": "UAE215  ", "r": "A6-EUA", "t": "A388",
        "lat": 33.9, "lon": -118.4, "alt_baro": "ground", "gs": 12.5, "track": 250.1,
        "baro_rate": None, "geom_rate": -64, "squawk": "2200", "seen": 0.4,
    }
    ac = _normalize_adsbexchange(raw, "adsbfi")
    assert ac is not None
    assert ac.hex == "abc123"
    assert ac.callsign == "UAE215"
    assert ac.on_ground and ac.altitude_ft == 0.0
    assert ac.vertical_rate_fpm == -64  # falls back to geom_rate
    assert ac.source == "adsbfi"


def test_normalize_requires_hex():
    assert _normalize_adsbexchange({"flight": "X"}, "adsblol") is None


def test_aircraft_list_accepts_both_schemas():
    assert AdsbClient._aircraft_list({"ac": [{"hex": "1"}]}) == [{"hex": "1"}]
    assert AdsbClient._aircraft_list({"aircraft": [{"hex": "2"}]}) == [{"hex": "2"}]
    assert AdsbClient._aircraft_list({}) == []


def test_check_403_sets_long_cooldown():
    c = _client()
    with pytest.raises(RuntimeError, match="access denied"):
        c._check("airplaneslive", httpx.Response(403, json={"error": "contact us"}))
    assert c._cooling_down("airplaneslive")


def test_check_429_honours_retry_after():
    c = _client()
    with pytest.raises(RuntimeError, match="rate-limited"):
        c._check("adsblol", httpx.Response(429, headers={"retry-after": "12"}))
    assert c._cooling_down("adsblol")
    # Cooldown roughly matches Retry-After (12 s), not the default 30 s.
    import time
    remaining = c._cooldown_until["adsblol"] - time.monotonic()
    assert 10 < remaining <= 12.5


def test_check_200_passes():
    c = _client()
    req = httpx.Request("GET", "https://api.adsb.lol/v2/x")
    c._check("adsblol", httpx.Response(200, json={"ac": []}, request=req))
    assert not c._cooling_down("adsblol")


async def test_fetch_falls_through_to_next_source():
    """403 from the first source -> second source's aircraft are returned, status reflects both."""
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.host)
        if "adsb.lol" in request.url.host:
            return httpx.Response(403, json={"error": "nope"})
        return httpx.Response(200, json={"aircraft": [{"hex": "abc", "t": "B744", "lat": 34.0, "lon": -118.0}]})

    c = AdsbClient(SETTINGS, client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    aircraft, status = await c.fetch(33.9, -118.4, 250)
    assert [a.hex for a in aircraft] == ["abc"]
    assert aircraft[0].source == "adsbfi"
    assert status["adsblol"].startswith("error")
    assert status["adsbfi"] == "ok (1)"
    assert "airplaneslive" not in status  # first success wins; later sources not called

    # Second call: adsb.lol is cooling down so it is skipped without a request.
    calls.clear()
    aircraft, status = await c.fetch(33.9, -118.4, 250)
    assert status["adsblol"] == "cooling-down"
    assert all("adsb.lol" not in h for h in calls)
