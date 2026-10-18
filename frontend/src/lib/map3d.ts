import type maplibregl from "maplibre-gl";
import type { Map as MlMap } from "maplibre-gl";
import type { BaseTheme } from "./basemaps";

/** AWS Open Data Terrain Tiles (Mapzen Terrarium encoding). Public, no key. */
const TERRAIN_TILES = "/api/terrain/{z}/{x}/{y}";
/** OpenFreeMap planet (OpenMapTiles schema) — used only for 3D building extrusions. */
const BUILDING_TILES = "https://tiles.openfreemap.org/planet/{z}/{x}/{y}.pbf";

const TERRAIN_SRC = "terrain-dem";
const BUILD_SRC = "osm-buildings";
const BUILD_LAYER = "3d-buildings";
const HILL_LAYER = "hillshade";

function firstOverlay(map: MlMap): string | undefined {
  for (const id of ["centerline", "runways", "airport-dot", "ac-halo"]) {
    if (map.getLayer(id)) return id;
  }
  return undefined;
}

/**
 * Sky gradient for the pitched views. Light basemaps get a daytime sky; dark/satellite get
 * a dusk-blue one — a near-black sky read as a rendering bug.
 */
function skyFor(theme: BaseTheme): maplibregl.SkySpecification {
  if (theme === "light") {
    return {
      "sky-color": "#5fa9ee",
      "horizon-color": "#dbeafb",
      "fog-color": "#e9f1f8",
      "sky-horizon-blend": 0.55,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.4,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 10, 0.5, 14, 0.25],
    };
  }
  return {
    "sky-color": "#163463",
    "horizon-color": "#6d8db8",
    "fog-color": "#3a4a62",
    "sky-horizon-blend": 0.55,
    "horizon-fog-blend": 0.7,
    "fog-ground-blend": 0.35,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 10, 0.5, 14, 0.25],
  };
}

export function ensureTerrainSource(map: MlMap): void {
  if (map.getSource(TERRAIN_SRC)) return;
  map.addSource(TERRAIN_SRC, {
    type: "raster-dem",
    tiles: [TERRAIN_TILES],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: "Terrain © Mapzen / AWS Open Data",
  });
}

export function setMap3d(map: MlMap, on: boolean, theme: BaseTheme): void {
  if (on) {
    ensureTerrainSource(map);
    map.setTerrain({ source: TERRAIN_SRC, exaggeration: 1.55 });
    try {
      map.setSky(skyFor(theme));
    } catch {
      /* older MapLibre without sky */
    }

    const before = firstOverlay(map);
    if (!map.getLayer(HILL_LAYER)) {
      map.addLayer(
        {
          id: HILL_LAYER,
          type: "hillshade",
          source: TERRAIN_SRC,
          paint: {
            "hillshade-exaggeration": 0.45,
            "hillshade-shadow-color": theme === "light" ? "#5a5348" : "#0a0a0c",
            "hillshade-highlight-color": theme === "light" ? "#fff6e0" : "#8a9bb0",
            "hillshade-illumination-anchor": "viewport",
          },
        },
        before,
      );
    }

    if (!map.getSource(BUILD_SRC)) {
      map.addSource(BUILD_SRC, {
        type: "vector",
        tiles: [BUILDING_TILES],
        maxzoom: 14,
        attribution: "© OpenStreetMap contributors · OpenFreeMap",
      });
    }
    if (!map.getLayer(BUILD_LAYER)) {
      map.addLayer(
        {
          id: BUILD_LAYER,
          type: "fill-extrusion",
          source: BUILD_SRC,
          "source-layer": "building",
          minzoom: 13,
          filter: ["!=", ["get", "hide_3d"], true],
          paint: {
            "fill-extrusion-color": theme === "light" ? "#d4d0c8" : "#3a3a40",
            "fill-extrusion-opacity": 0.72,
            "fill-extrusion-height": [
              "coalesce",
              ["get", "render_height"],
              ["get", "height"],
              10,
            ],
            "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], ["get", "min_height"], 0],
          },
        },
        before,
      );
    }
  } else {
    try {
      map.setTerrain(null);
    } catch {
      /* ignore */
    }
    try {
      // @ts-expect-error sky can be cleared with undefined on some versions
      map.setSky(undefined);
    } catch {
      /* ignore */
    }
    if (map.getLayer(BUILD_LAYER)) map.removeLayer(BUILD_LAYER);
    if (map.getLayer(HILL_LAYER)) map.removeLayer(HILL_LAYER);
  }
}

/** Re-tint 3D overlays after a basemap theme change (layers already exist). */
export function restack3d(map: MlMap): void {
  const before = firstOverlay(map);
  if (map.getLayer(HILL_LAYER)) map.moveLayer(HILL_LAYER, before);
  if (map.getLayer(BUILD_LAYER)) map.moveLayer(BUILD_LAYER, before);
}

export function tintMap3d(map: MlMap, theme: BaseTheme): void {
  try {
    map.setSky(skyFor(theme));
  } catch {
    /* ignore */
  }
  if (map.getLayer(HILL_LAYER)) {
    map.setPaintProperty(
      HILL_LAYER,
      "hillshade-shadow-color",
      theme === "light" ? "#5a5348" : "#0a0a0c",
    );
    map.setPaintProperty(
      HILL_LAYER,
      "hillshade-highlight-color",
      theme === "light" ? "#fff6e0" : "#8a9bb0",
    );
  }
  if (map.getLayer(BUILD_LAYER)) {
    map.setPaintProperty("3d-buildings", "fill-extrusion-color", theme === "light" ? "#d4d0c8" : "#3a3a40");
  }
}
