// Selectable, key-less basemaps. All raster so they can be hot-swapped under the map's
// overlay layers. The chosen basemap also drives the whole app theme (light/dark).
//
// Note: CARTO's public raster endpoints (basemaps.cartocdn.com) now return "API KEY
// REQUIRED" placeholder tiles with HTTP 200, so they are no longer usable without a key.
// The providers below are free to use without one (see the README's attribution notes).

export type BaseTheme = "light" | "dark";

export interface Basemap {
  id: string;
  label: string;
  theme: BaseTheme;
  /** Base raster tiles (one URL per subdomain/mirror). */
  tiles: string[];
  /** Optional transparent label/reference raster drawn directly above the base. */
  labelTiles?: string[];
  attribution: string;
  maxzoom?: number;
}

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services";

export const BASEMAPS: Basemap[] = [
  {
    id: "osm",
    label: "Map",
    theme: "light",
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
  {
    id: "dark",
    label: "Dark",
    theme: "dark",
    tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
    labelTiles: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    attribution: "© Esri, HERE, Garmin, © OpenStreetMap contributors",
    maxzoom: 16,
  },
  {
    id: "satellite",
    label: "Satellite",
    theme: "dark",
    tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
];

const DEFAULT_BASEMAP = "osm";

// Ids from earlier builds that users may still have saved in localStorage.
const LEGACY_IDS: Record<string, string> = { voyager: "osm" };

export function getBasemap(id: string): Basemap {
  const resolved = LEGACY_IDS[id] ?? id;
  return BASEMAPS.find((b) => b.id === resolved) ?? BASEMAPS[0];
}

export function loadBasemapId(): string {
  try {
    const v = localStorage.getItem("hwl.basemap");
    if (v) {
      const resolved = LEGACY_IDS[v] ?? v;
      if (BASEMAPS.some((b) => b.id === resolved)) return resolved;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_BASEMAP;
}

export function saveBasemapId(id: string): void {
  try {
    localStorage.setItem("hwl.basemap", id);
  } catch {
    /* ignore */
  }
}
