from app.sources.photos import parse_photo_response
from app.sources.routes import parse_route_record


def test_parse_route_record_simple():
    cs, route = parse_route_record({"callsign": "UAE215", "airport_codes": "OMDB-KLAX"})
    assert cs == "UAE215"
    assert route.origin == "OMDB"
    assert route.destination == "KLAX"


def test_parse_route_record_multi_leg_uses_first_and_last():
    cs, route = parse_route_record({"callsign": "QFA12", "airport_codes": "YSSY-KLAX-KJFK"})
    assert cs == "QFA12"
    assert route.origin == "YSSY"
    assert route.destination == "KJFK"


def test_parse_route_record_unknown_codes():
    cs, route = parse_route_record({"callsign": "N12AB", "airport_codes": "unknown"})
    assert cs == "N12AB"
    assert route.origin is None and route.destination is None


def test_parse_route_record_missing_callsign():
    assert parse_route_record({"airport_codes": "KSFO-KJFK"}) is None


def test_parse_route_record_strips_unknown_leg():
    # A leg tagged unknown collapses the route below two usable codes.
    _, route = parse_route_record({"callsign": "ABC1", "airport_codes": "XXXX-KLAX"})
    assert route.destination is None


def test_parse_photo_response():
    payload = parse_photo_response(
        {
            "photos": [
                {
                    "id": "123",
                    "thumbnail": {"src": "https://t.example/small.jpg"},
                    "thumbnail_large": {"src": "https://t.example/large.jpg"},
                    "link": "https://www.planespotters.net/photo/123",
                    "photographer": "Jane Spotter",
                }
            ]
        }
    )
    assert payload == {
        "url": "https://t.example/large.jpg",
        "photographer": "Jane Spotter",
        "link": "https://www.planespotters.net/photo/123",
    }


def test_parse_photo_response_empty():
    assert parse_photo_response({"photos": []}) is None
    assert parse_photo_response({}) is None


def test_parse_photo_response_falls_back_to_small_thumbnail():
    payload = parse_photo_response(
        {"photos": [{"thumbnail": {"src": "https://t.example/s.jpg"}, "photographer": "X"}]}
    )
    assert payload is not None and payload["url"] == "https://t.example/s.jpg"
