// Selectable, key-less basemaps. All raster so they can be hot-swapped under the map's
// overlay layers. The chosen basemap also drives the whole app theme (light/dark).

export type BaseTheme = "light" | "dark";

export interface Basemap {
  id: string;
  label: string;
  theme: BaseTheme;
  tiles: string[];
  attribution: string;
  maxzoom?: number;
}

export const BASEMAPS: Basemap[] = [
  {
    id: "voyager",
    label: "Map",
    theme: "light",
    tiles: [
      "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap contributors, © CARTO",
  },
  {
    id: "dark",
    label: "Dark",
    theme: "dark",
    tiles: [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    attribution: "© OpenStreetMap contributors, © CARTO",
  },
  {
    id: "satellite",
    label: "Satellite",
    theme: "dark",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxzoom: 19,
  },
];

const DEFAULT_BASEMAP = "voyager";

export function getBasemap(id: string): Basemap {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export function loadBasemapId(): string {
  try {
    const v = localStorage.getItem("hwl.basemap");
    if (v && BASEMAPS.some((b) => b.id === v)) return v;
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
