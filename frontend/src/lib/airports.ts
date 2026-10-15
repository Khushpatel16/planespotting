// Curated airfields within ~250 nm of KLAX (the ADS-B search radius), so an aircraft that
// suddenly shows "on ground" can be placed at a real field instead of looking like a glitch.
// Coordinates are approximate field reference points (public data). KLAX itself is drawn
// separately as the home airport, so it's intentionally omitted here.

export type AirportKind = "major" | "regional" | "military" | "ga";

export interface NearbyAirport {
  icao: string;
  code: string; // short label shown on the map (IATA where it exists, else ICAO)
  name: string;
  lat: number;
  lon: number;
  kind: AirportKind;
}

export const NEARBY_AIRPORTS: NearbyAirport[] = [
  // --- LA basin commercial ---
  { icao: "KBUR", code: "BUR", name: "Hollywood Burbank", lat: 34.2007, lon: -118.359, kind: "major" },
  { icao: "KLGB", code: "LGB", name: "Long Beach", lat: 33.8177, lon: -118.1516, kind: "major" },
  { icao: "KSNA", code: "SNA", name: "John Wayne / Orange County", lat: 33.6757, lon: -117.8682, kind: "major" },
  { icao: "KONT", code: "ONT", name: "Ontario Intl", lat: 34.056, lon: -117.6012, kind: "major" },
  // --- Other commercial within radius ---
  { icao: "KSAN", code: "SAN", name: "San Diego Intl", lat: 32.7338, lon: -117.1933, kind: "major" },
  { icao: "KSBA", code: "SBA", name: "Santa Barbara", lat: 34.4262, lon: -119.8403, kind: "major" },
  { icao: "KPSP", code: "PSP", name: "Palm Springs", lat: 33.8297, lon: -116.5067, kind: "major" },
  { icao: "KLAS", code: "LAS", name: "Las Vegas Harry Reid", lat: 36.084, lon: -115.1537, kind: "major" },
  { icao: "KSBP", code: "SBP", name: "San Luis Obispo", lat: 35.2368, lon: -120.6424, kind: "regional" },
  { icao: "KBFL", code: "BFL", name: "Bakersfield Meadows", lat: 35.4336, lon: -119.0568, kind: "regional" },
  { icao: "KCRQ", code: "CRQ", name: "McClellan-Palomar (Carlsbad)", lat: 33.1283, lon: -117.28, kind: "regional" },
  { icao: "KYUM", code: "YUM", name: "Yuma Intl", lat: 32.6566, lon: -114.606, kind: "regional" },
  { icao: "MMTJ", code: "TIJ", name: "Tijuana Intl (MX)", lat: 32.5411, lon: -116.97, kind: "major" },
  // --- Cargo / storage / widebody-relevant ---
  { icao: "KVCV", code: "VCV", name: "So. California Logistics (Victorville)", lat: 34.5975, lon: -117.3831, kind: "regional" },
  { icao: "KPMD", code: "PMD", name: "Palmdale / Plant 42", lat: 34.6294, lon: -118.0846, kind: "regional" },
  // --- Military ---
  { icao: "KEDW", code: "EDW", name: "Edwards AFB", lat: 34.9054, lon: -117.8838, kind: "military" },
  { icao: "KRIV", code: "RIV", name: "March ARB", lat: 33.8807, lon: -117.2592, kind: "military" },
  { icao: "KNTD", code: "NTD", name: "Point Mugu NAS", lat: 34.1203, lon: -119.1212, kind: "military" },
  { icao: "KNFG", code: "NFG", name: "Camp Pendleton MCAS", lat: 33.3013, lon: -117.355, kind: "military" },
  { icao: "KNKX", code: "NKX", name: "Miramar MCAS", lat: 32.8684, lon: -117.1426, kind: "military" },
  // --- Busy GA / reliever fields ---
  { icao: "KVNY", code: "VNY", name: "Van Nuys", lat: 34.2098, lon: -118.4898, kind: "ga" },
  { icao: "KSMO", code: "SMO", name: "Santa Monica", lat: 34.0158, lon: -118.4513, kind: "ga" },
  { icao: "KHHR", code: "HHR", name: "Hawthorne", lat: 33.9228, lon: -118.3352, kind: "ga" },
  { icao: "KTOA", code: "TOA", name: "Zamperini (Torrance)", lat: 33.8034, lon: -118.3396, kind: "ga" },
  { icao: "KCNO", code: "CNO", name: "Chino", lat: 33.9747, lon: -117.6368, kind: "ga" },
  { icao: "KCMA", code: "CMA", name: "Camarillo", lat: 34.2137, lon: -119.0944, kind: "ga" },
  { icao: "KEMT", code: "EMT", name: "San Gabriel Valley (El Monte)", lat: 34.086, lon: -118.035, kind: "ga" },
  { icao: "KFUL", code: "FUL", name: "Fullerton", lat: 33.872, lon: -117.9799, kind: "ga" },
  { icao: "KPOC", code: "POC", name: "Brackett (La Verne)", lat: 34.0916, lon: -117.7817, kind: "ga" },
  { icao: "KSEE", code: "SEE", name: "Gillespie (San Diego)", lat: 32.8262, lon: -117.0453, kind: "ga" },
  { icao: "KAVX", code: "AVX", name: "Catalina", lat: 33.4049, lon: -118.4159, kind: "ga" },
];
