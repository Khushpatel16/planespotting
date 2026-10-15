"""Decode the operating airline from an ICAO flight callsign.

ATC/ADS-B callsigns are <3-letter ICAO airline designator><flight number/suffix>,
e.g. "UAE215" -> UAE -> Emirates. General-aviation callsigns are usually the
registration (start with a country prefix like N / G / D and don't match the table).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.data.airlines import AIRLINES

_PREFIX_RE = re.compile(r"^([A-Z]{3})\d")


@dataclass(frozen=True)
class OperatorInfo:
    code: str | None  # ICAO airline designator, e.g. "UAE"
    name: str | None  # "Emirates"
    country: str | None
    is_cargo: bool


UNKNOWN_OPERATOR = OperatorInfo(code=None, name=None, country=None, is_cargo=False)


def decode_operator(callsign: str | None) -> OperatorInfo:
    """Return operator info from a callsign, or UNKNOWN_OPERATOR if undecodable."""
    if not callsign:
        return UNKNOWN_OPERATOR
    cs = callsign.strip().upper()

    # A valid airline callsign is 3 letters followed by at least one digit.
    m = _PREFIX_RE.match(cs)
    if not m:
        return UNKNOWN_OPERATOR

    code = m.group(1)
    entry = AIRLINES.get(code)
    if entry is None:
        # Recognised structure but unknown airline; still surface the code.
        return OperatorInfo(code=code, name=None, country=None, is_cargo=False)

    name, country, cargo = entry
    return OperatorInfo(code=code, name=name, country=country, is_cargo=cargo)
