import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MlMap, Marker, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Aircraft, AppConfig } from "../types";
import { categoryColor, aircraftLabel, fmtAlt, fmtSpeed, fmtVrate } from "../lib/format";
import { CAT } from "../lib/colors";
import { destinationPoint, FT_TO_M, haversineNm } from "../lib/geo";
import { NEARBY_AIRPORTS, type AirportKind } from "../lib/airports";
import { BASEMAPS, getBasemap, type Basemap, type BaseTheme } from "../lib/basemaps";
import { MotionField } from "../lib/motion";
import { restack3d, setMap3d, tintMap3d } from "../lib/map3d";
import {
  applyCockpitCamera,
  cockpitCandidates,
  flightPhase,
  setMapInteractive,
  type FlightPhase,
} from "../lib/cockpit";

interface Props {
  aircraft: Aircraft[];
  config: AppConfig | null;
  flow: "west" | "east";
  selectedHex: string | null;
  onSelect: (hex: string | null) => void;
  focus: { lat: number; lon: number; zoom?: number } | null;
  watchedHexes?: Set<string>;
  basemapId: string;
  onBasemapChange: (id: string) => void;
  /** Jump into this aircraft's cockpit (from the detail panel). */
  cockpitRequest: string | null;
  onCockpitRequestHandled: () => void;
}

const KLAX = { lat: 33.9416, lon: -118.4085 };

// Quick view presets (top-right, under the basemap switcher).
const VIEWS: { id: string; label: string; center: [number, number]; zoom: number }[] = [
  { id: "lax", label: "LAX", center: [KLAX.lon, KLAX.lat], zoom: 9 },
  { id: "socal", label: "SoCal", center: [-117.6, 34.0], zoom: 6.4 },
  { id: "west", label: "West", center: [-115.0, 39.5], zoom: 4.6 },
  { id: "na", label: "N. America", center: [-98.5, 43.0], zoom: 3.1 },
];

// Empty base style; the chosen basemap is added as the bottom layer on load. A keyless
// glyph endpoint is provided so the airport label symbols can render text.
//
// Use a SINGLE font in `text-font`: MapLibre joins a font stack into one comma-separated
// request ("A,B/0-255.pbf"), and public glyph servers answer that with an HTML error page,
// which MapLibre then fails to parse ("Unimplemented type: 4") and no labels render.
const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
const LABEL_FONT = ["Noto Sans Regular"];
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {},
  layers: [],
};

/** Idempotently add (or refresh) the nearby-airport source + layers, kept beneath traffic. */
function ensureAirportLayers(map: MlMap, radiusNm: number, theme: BaseTheme) {
  const data = airportFeatures(radiusNm);
  const src = map.getSource("airports") as maplibregl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
  } else {
    map.addSource("airports", { type: "geojson", data });
  }
  const before = map.getLayer("ac-halo") ? "ac-halo" : undefined;
  if (!map.getLayer("airport-dot")) {
    map.addLayer(
      {
        id: "airport-dot",
        type: "circle",
        source: "airports",
        paint: {
          "circle-radius": ["get", "radius"],
          "circle-color": "#30b0c7",
          "circle-opacity": 0.9,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.4,
        },
      },
      before,
    );
  }
  if (!map.getLayer("airport-label")) {
    map.addLayer(
      {
        id: "airport-label",
        type: "symbol",
        source: "airports",
        layout: {
          "text-field": ["get", "code"],
          "text-size": ["match", ["get", "kind"], "major", 11, 10],
          "text-offset": [0, 0.9],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-optional": true,
          "symbol-sort-key": ["get", "rank"],
          "text-font": LABEL_FONT,
        },
        paint: {
          "text-color": "#0b6b7a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.6,
        },
      },
      before,
    );
  }
  setAirportTheme(map, theme);
}

/** Flip the airport label colours so they stay legible on light vs dark/satellite bases. */
function setAirportTheme(map: MlMap, theme: BaseTheme) {
  if (!map.getLayer("airport-label")) return;
  map.setPaintProperty("airport-label", "text-color", theme === "light" ? "#0b6b7a" : "#7fe7f5");
  map.setPaintProperty(
    "airport-label",
    "text-halo-color",
    theme === "light" ? "#ffffff" : "rgba(0,0,0,0.75)",
  );
}

/** Swap the basemap raster source/layer(s) in place, keeping all overlay layers on top. */
function applyBasemap(map: MlMap, bm: Basemap) {
  for (const id of ["basemap-labels", "basemap"]) {
    if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(id)) map.removeSource(id);
  }
  // Keep the basemap beneath everything else (insert before the first overlay if present).
  const before = map.getLayer("centerline") ? "centerline" : undefined;
  map.addSource("basemap", {
    type: "raster",
    tiles: bm.tiles,
    tileSize: 256,
    attribution: bm.attribution,
    maxzoom: bm.maxzoom ?? 20,
  });
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, before);
  // Some providers split place/road labels into a transparent "reference" layer.
  if (bm.labelTiles) {
    map.addSource("basemap-labels", {
      type: "raster",
      tiles: bm.labelTiles,
      tileSize: 256,
      maxzoom: bm.maxzoom ?? 20,
    });
    map.addLayer({ id: "basemap-labels", type: "raster", source: "basemap-labels" }, before);
  }

  // Overlay colours that need to flip with the basemap theme.
  if (map.getLayer("runways")) {
    map.setPaintProperty("runways", "line-color", bm.theme === "light" ? "#1d1d1f" : "#f2f2f5");
  }
  setAirportTheme(map, bm.theme);
  const canvas = map.getContainer();
  canvas.classList.toggle("map-dark", bm.theme === "dark");
  if (map.getTerrain()) {
    restack3d(map);
    tintMap3d(map, bm.theme);
  }
}

type IconKind = "a380" | "b747" | "heavy" | "other";

// Per-category icon definitions. Each draws a recognizable top-down airliner silhouette:
// engine count and proportions distinguish the families (A380 / 747 are quads; other
// heavies + the rest are twins). Colors match the shared category palette.
const PLANE_ICONS: { id: string; kind: IconKind; color: string }[] = [
  { id: "plane-a380", kind: "a380", color: CAT.a380 },
  { id: "plane-747", kind: "b747", color: CAT.b747 },
  { id: "plane-heavy", kind: "heavy", color: CAT.heavy },
  { id: "plane-other", kind: "other", color: CAT.other },
];

// kind -> shape parameters (fractions of the canvas; nose points north / up). Tuned to
// read like the familiar top-down "live traffic" silhouettes: swept wings with engine
// pods (4 for A380/747, 2 for heavies, none for small jets) plus tailplanes.
interface Shape {
  bodyHalf: number; // fuselage half-width
  noseY: number;
  tailY: number;
  spanX: number; // wing half-span
  leadRootY: number; // wing leading edge at root
  leadTipY: number; // wing leading edge at tip (sweep = tip - root)
  chordRoot: number;
  chordTip: number;
  tailSpan: number;
  engineT: number[]; // engine pod positions along each wing (0=root .. 1=tip)
  podLen: number; // pod length (fraction of size)
  podWide: number; // pod half-width
}

const SHAPE: Record<IconKind, Shape> = {
  // A380: very wide, low-swept wings, fat fuselage, four pods.
  a380: { bodyHalf: 0.072, noseY: 0.06, tailY: 0.95, spanX: 0.48, leadRootY: 0.40, leadTipY: 0.50, chordRoot: 0.17, chordTip: 0.045, tailSpan: 0.22, engineT: [0.34, 0.66], podLen: 0.12, podWide: 0.03 },
  // 747: slender, more-swept wings, four pods.
  b747: { bodyHalf: 0.052, noseY: 0.05, tailY: 0.96, spanX: 0.44, leadRootY: 0.40, leadTipY: 0.60, chordRoot: 0.15, chordTip: 0.035, tailSpan: 0.18, engineT: [0.36, 0.66], podLen: 0.11, podWide: 0.028 },
  // Twin widebody (777/787/A330…): two big underwing pods.
  heavy: { bodyHalf: 0.05, noseY: 0.06, tailY: 0.95, spanX: 0.41, leadRootY: 0.42, leadTipY: 0.58, chordRoot: 0.13, chordTip: 0.03, tailSpan: 0.17, engineT: [0.46], podLen: 0.12, podWide: 0.03 },
  // Everything else: small narrowbody, pods drawn small/integrated.
  other: { bodyHalf: 0.042, noseY: 0.1, tailY: 0.93, spanX: 0.3, leadRootY: 0.46, leadTipY: 0.57, chordRoot: 0.1, chordTip: 0.028, tailSpan: 0.12, engineT: [0.5], podLen: 0.07, podWide: 0.022 },
};

function fuselagePath(s: number, cx: number, cfg: Shape): Path2D {
  const bh = s * cfg.bodyHalf;
  const noseY = s * cfg.noseY;
  const tailY = s * cfg.tailY;
  const p = new Path2D();
  p.moveTo(cx, noseY);
  p.bezierCurveTo(cx + bh, noseY + bh * 0.5, cx + bh, noseY + bh * 1.4, cx + bh, noseY + bh * 2.4);
  p.lineTo(cx + bh, tailY - bh * 1.6);
  p.quadraticCurveTo(cx + bh, tailY, cx, tailY);
  p.quadraticCurveTo(cx - bh, tailY, cx - bh, tailY - bh * 1.6);
  p.lineTo(cx - bh, noseY + bh * 2.4);
  p.bezierCurveTo(cx - bh, noseY + bh * 1.4, cx - bh, noseY + bh * 0.5, cx, noseY);
  p.closePath();
  return p;
}

function wingPath(
  cx: number,
  sign: number,
  rootX: number,
  span: number,
  leadRoot: number,
  trailRoot: number,
  leadTip: number,
  trailTip: number,
): Path2D {
  const p = new Path2D();
  p.moveTo(cx + sign * rootX, leadRoot);
  p.lineTo(cx + sign * span, leadTip);
  p.lineTo(cx + sign * span, trailTip);
  p.lineTo(cx + sign * rootX, trailRoot);
  p.closePath();
  return p;
}

function podPath(x: number, y: number, halfW: number, len: number): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, halfW, len / 2, 0, 0, Math.PI * 2);
  return p;
}

/** Build the list of sub-shapes that make up a type-specific airliner silhouette. */
function planeShapes(s: number, cx: number, cfg: Shape): Path2D[] {
  const shapes: Path2D[] = [fuselagePath(s, cx, cfg)];

  const span = s * cfg.spanX;
  const rootX = s * cfg.bodyHalf * 0.9;
  const leadRoot = s * cfg.leadRootY;
  const leadTip = s * cfg.leadTipY;
  for (const sign of [1, -1]) {
    shapes.push(
      wingPath(cx, sign, rootX, span, leadRoot, leadRoot + s * cfg.chordRoot, leadTip, leadTip + s * cfg.chordTip),
    );
  }

  const tailY = s * cfg.tailY;
  const tlead = tailY - s * 0.13;
  const trootX = s * cfg.bodyHalf * 0.7;
  for (const sign of [1, -1]) {
    shapes.push(
      wingPath(cx, sign, trootX, s * cfg.tailSpan, tlead, tlead + s * 0.055, tlead + s * 0.03, tlead + s * 0.06),
    );
  }

  // Engine pods straddle the wing leading edge, protruding slightly forward.
  for (const sign of [1, -1]) {
    for (const t of cfg.engineT) {
      const px = cx + sign * (rootX + t * (span - rootX));
      const py = leadRoot + t * (leadTip - leadRoot) + s * 0.005;
      shapes.push(podPath(px, py, s * cfg.podWide, s * cfg.podLen));
    }
  }
  return shapes;
}

/** Render a type-specific airliner silhouette (pointing north) in the given color. */
function planeImage(kind: IconKind, color: string, size = 80, pixelRatio = 2) {
  const s = size * pixelRatio;
  const c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, s, s);
  const cx = s / 2;

  const shapes = planeShapes(s, cx, SHAPE[kind]);

  // Pass 1: a single dark outline by stroking+filling every sub-shape dark (expands each
  // by half the line width). Pass 2: fill each with colour, which covers the interior and
  // all the internal seams, leaving only a clean outer rim — pods read as wing bumps.
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = "rgba(20,22,28,0.9)";
  ctx.fillStyle = "rgba(20,22,28,0.9)";
  for (const p of shapes) {
    ctx.stroke(p);
    ctx.fill(p);
  }
  ctx.fillStyle = color;
  for (const p of shapes) ctx.fill(p);

  const img = ctx.getImageData(0, 0, s, s);
  return { width: s, height: s, data: new Uint8Array(img.data.buffer) };
}

function aircraftFeatures(
  aircraft: Aircraft[],
  watchedHexes?: Set<string>,
  hideHex?: string | null,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const a of aircraft) {
    if (a.lat === null || a.lon === null) continue;
    if (hideHex && a.hex === hideHex) continue;
    const icon =
      a.type.family === "A380"
        ? "plane-a380"
        : a.type.family === "747"
          ? "plane-747"
          : a.type.is_heavy
            ? "plane-heavy"
            : "plane-other";
    const size =
      a.type.family === "A380"
        ? 1.05
        : a.type.family === "747"
          ? 0.95
          : a.type.is_heavy
            ? 0.74
            : 0.56;
    // Positions from the slow continental sweep can be a minute or two old: fade them so
    // the eye reads "approximate" without hiding them.
    const age = a.seen_seconds ?? 0;
    const opacity = age > 240 ? 0.4 : age > 90 ? 0.6 : 0.98;
    const elev = Math.max(0, (a.altitude_ft ?? 0) * FT_TO_M);
    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lon, a.lat, elev] },
      properties: {
        hex: a.hex,
        track: a.track_deg ?? 0,
        color: categoryColor(a),
        icon,
        size,
        opacity,
        isTarget: a.type.is_target,
        isHeavy: a.type.is_heavy,
        inbound: a.is_inbound,
        watched: watchedHexes?.has(a.hex) ?? false,
        label: aircraftLabel(a),
        sub: `${a.type.friendly_name} · ${fmtAlt(a.altitude_ft)}${age > 60 ? ` · fix ${Math.round(age)} s old` : ""}`,
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const AIRPORT_RANK: Record<AirportKind, number> = { major: 0, regional: 1, military: 2, ga: 3 };

function airportFeatures(radiusNm: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: NEARBY_AIRPORTS.filter(
      (a) => haversineNm(a.lat, a.lon, KLAX.lat, KLAX.lon) <= radiusNm,
    ).map((a) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [a.lon, a.lat] },
      properties: {
        code: a.code,
        name: a.name,
        kind: a.kind,
        rank: AIRPORT_RANK[a.kind],
        radius: a.kind === "major" ? 5 : a.kind === "regional" ? 4 : 3,
      },
    })),
  };
}

function runwayFeatures(config: AppConfig): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: config.runways.map((r) => {
      const ends = Object.values(r.ends);
      return {
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [ends[0].lon, ends[0].lat],
            [ends[1].lon, ends[1].lat],
          ],
        },
        properties: { pair: r.pair },
      };
    }),
  };
}

function centerlineFeature(flow: "west" | "east"): GeoJSON.FeatureCollection {
  // West flow: arrivals approach from the EAST -> extended centerline runs east (070).
  // East flow: arrivals approach from the WEST -> extended centerline runs west (250).
  const bearing = flow === "west" ? 70.7 : 250.7;
  const far = destinationPoint(KLAX.lat, KLAX.lon, bearing, 35);
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "LineString", coordinates: [[KLAX.lon, KLAX.lat], far] },
        properties: {},
      },
    ],
  };
}

interface Hud {
  hex: string;
  label: string;
  type: string;
  phase: FlightPhase;
  alt: string;
  gs: string;
  hdg: string;
  vs: string;
  rwy: string;
  idx: number;
  total: number;
}

export default function MapView({
  aircraft,
  config,
  flow,
  selectedHex,
  onSelect,
  focus,
  watchedHexes,
  basemapId,
  onBasemapChange,
  cockpitRequest,
  onCockpitRequestHandled,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const loadedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const popupRef = useRef<Popup | null>(null);
  const spotMarkersRef = useRef<Marker[]>([]);
  const [mapError, setMapError] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [cockpitHex, setCockpitHex] = useState<string | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const noteTimerRef = useRef(0);
  const basemapRef = useRef(basemapId);
  const threeDRef = useRef(false);
  const cockpitHexRef = useRef<string | null>(null);
  const aircraftRef = useRef(aircraft);
  const watchedRef = useRef(watchedHexes);
  const configRef = useRef(config);
  const motionRef = useRef(new MotionField());
  const savedCamRef = useRef<{ center: [number, number]; zoom: number; pitch: number; bearing: number } | null>(null);
  const lastHudRef = useRef(0);
  const exitCockpitRef = useRef<() => void>(() => {});
  const auto3dRef = useRef(false);
  const mouseRef = useRef<[number, number] | null>(null);
  basemapRef.current = basemapId;
  threeDRef.current = threeD;
  cockpitHexRef.current = cockpitHex;
  aircraftRef.current = aircraft;
  watchedRef.current = watchedHexes;
  configRef.current = config;
  onSelectRef.current = onSelect;

  // Apply basemap swaps triggered from the switcher (or restored preference changes).
  useEffect(() => {
    const map = mapRef.current;
    if (map && loadedRef.current) applyBasemap(map, getBasemap(basemapId));
  }, [basemapId]);

  // Init map once. Guarded: a WebGL failure must not crash the rest of the app.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: STYLE,
        center: [KLAX.lon, KLAX.lat],
        zoom: 9,
        pitch: 0,
        maxPitch: 85,
        attributionControl: { compact: true },
      });
    } catch (e) {
      console.error("MapLibre init failed (WebGL unavailable?)", e);
      setMapError(true);
      return;
    }
    map.on("error", (e) => console.warn("map error", e?.error?.message ?? e));
    map.on("webglcontextlost", () => console.warn("map: WebGL context lost"));
    mapRef.current = map;
    if (import.meta.env.DEV) (window as unknown as { __hwlMap?: MlMap }).__hwlMap = map; // dev console aid
    // Top-left under the Sky View button: bottom-right belongs to the detail panel + attribution.
    map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-left");

    map.on("load", () => {
      applyBasemap(map, getBasemap(basemapRef.current));

      for (const { id, kind, color } of PLANE_ICONS) {
        if (!map.hasImage(id)) map.addImage(id, planeImage(kind, color), { pixelRatio: 2 });
      }

      map.addSource("centerline", { type: "geojson", data: centerlineFeature(flow) });
      map.addLayer({
        id: "centerline",
        type: "line",
        source: "centerline",
        paint: {
          "line-color": CAT.approach,
          "line-width": 2.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.85,
        },
      });

      map.addSource("runways", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "runways",
        type: "line",
        source: "runways",
        paint: {
          "line-color": getBasemap(basemapRef.current).theme === "light" ? "#1d1d1f" : "#f2f2f5",
          "line-width": 3,
          "line-opacity": 0.8,
        },
      });

      ensureAirportLayers(
        map,
        configRef.current?.defaults.search_radius_nm ?? 250,
        getBasemap(basemapRef.current).theme,
      );

      map.addSource("aircraft", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "ac-halo",
        type: "circle",
        source: "aircraft",
        filter: ["any", ["==", ["get", "isTarget"], true], ["==", ["get", "inbound"], true]],
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["zoom"],
            3, ["case", ["==", ["get", "inbound"], true], 9, 6],
            8, ["case", ["==", ["get", "inbound"], true], 19, 14],
          ],
          "circle-color": ["get", "color"],
          "circle-opacity": 0.16,
          "circle-stroke-color": ["get", "color"],
          "circle-stroke-width": ["case", ["==", ["get", "inbound"], true], 2.5, 1],
          "circle-stroke-opacity": 0.7,
        },
      });
      map.addLayer({
        id: "ac-selected",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "hex"], ""],
        paint: {
          "circle-radius": 22,
          "circle-color": "rgba(0,113,227,0.08)",
          "circle-stroke-color": CAT.accent,
          "circle-stroke-width": 2.5,
        },
      });
      map.addLayer({
        id: "ac-watch",
        type: "circle",
        source: "aircraft",
        filter: ["==", ["get", "watched"], true],
        paint: {
          "circle-radius": 17,
          "circle-color": "rgba(175,82,222,0.10)",
          "circle-stroke-color": "#af52de",
          "circle-stroke-width": 3,
          "circle-stroke-opacity": 0.95,
        },
      });
      map.addLayer({
        id: "ac-icons",
        type: "symbol",
        source: "aircraft",
        layout: {
          "icon-image": ["get", "icon"],
          "icon-rotate": ["get", "track"],
          "icon-rotation-alignment": "map",
          // Shrink icons as the view zooms out so the continental picture doesn't become a
          // wall of silhouettes; full size from the SoCal zoom level inwards.
          // (["zoom"] is only legal as the input of a top-level interpolate/step.)
          "icon-size": [
            "interpolate",
            ["linear"],
            ["zoom"],
            2, ["*", ["get", "size"], 0.3],
            4, ["*", ["get", "size"], 0.45],
            6, ["*", ["get", "size"], 0.7],
            8, ["get", "size"],
          ],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-opacity": ["get", "opacity"] },
      });

      // Interaction: hover popup + click to select.
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
      popupRef.current = popup;
      map.on("mouseenter", "ac-icons", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "ac-icons", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("mousemove", "ac-icons", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        popup
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`<div class="map-tip"><b>${p.label}</b><br/>${p.sub}</div>`)
          .addTo(map);
      });
      map.on("click", "ac-icons", (e) => {
        const f = e.features?.[0];
        if (f) onSelectRef.current((f.properties as { hex: string }).hex);
        popup.remove(); // the detail panel takes over; a hover tip left behind goes stale as the plane moves
      });
      map.on("mousemove", (e) => {
        mouseRef.current = [e.point.x, e.point.y];
      });
      map.on("mouseout", () => {
        mouseRef.current = null;
      });
      map.on("mouseenter", "airport-dot", () => (map.getCanvas().style.cursor = "help"));
      map.on("mouseleave", "airport-dot", () => {
        map.getCanvas().style.cursor = "";
        popup.remove();
      });
      map.on("mousemove", "airport-dot", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        popup
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(`<div class="map-tip"><b>${p.code}</b> · ${p.name}</div>`)
          .addTo(map);
      });
      map.on("click", (e) => {
        if (!map.getLayer("ac-icons")) return;
        const hits = map.queryRenderedFeatures(e.point, { layers: ["ac-icons"] });
        if (hits.length === 0) onSelectRef.current(null);
      });

      loadedRef.current = true;
      if (threeDRef.current) {
        setMap3d(map, true, getBasemap(basemapRef.current).theme);
      }
      // Push any data that arrived before load (read through refs: the closure's props are
      // from the first render, and config usually lands before the style finishes loading).
      (map.getSource("aircraft") as maplibregl.GeoJSONSource)?.setData(
        aircraftFeatures(aircraftRef.current, watchedRef.current),
      );
      const cfg = configRef.current;
      if (cfg) {
        (map.getSource("runways") as maplibregl.GeoJSONSource)?.setData(runwayFeatures(cfg));
        addSpotMarkers(map, cfg);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addSpotMarkers(map: MlMap, cfg: AppConfig) {
    spotMarkersRef.current.forEach((m) => m.remove());
    spotMarkersRef.current = [];
    // Airport
    const apEl = document.createElement("div");
    apEl.className = "map-airport";
    apEl.innerHTML = `<span class="dot"></span><span class="lbl">KLAX</span>`;
    spotMarkersRef.current.push(
      new maplibregl.Marker({ element: apEl, anchor: "left" }).setLngLat([KLAX.lon, KLAX.lat]).addTo(map),
    );
    for (const s of cfg.spots) {
      const el = document.createElement("div");
      el.className = "map-spot";
      el.title = s.notes;
      el.innerHTML = `<span class="pin">📍</span><span class="lbl">${s.name.split(" /")[0]}</span>`;
      spotMarkersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "left" }).setLngLat([s.lon, s.lat]).addTo(map),
      );
    }
  }

  // Ingest each ADS-B snapshot into the motion field (the rAF loop paints the coast).
  useEffect(() => {
    motionRef.current.ingest(aircraft, performance.now());
  }, [aircraft]);

  // Drive icons + cockpit camera from one rAF loop so planes keep flying between polls.
  // The GeoJSON source is re-pushed at a cadence that matches what the eye can see at the
  // current zoom (continental view: ~1 Hz; airport view: ~20 Hz) — re-tiling ~4,000 features
  // 60 times a second buys nothing and burns the battery.
  useEffect(() => {
    let raf = 0;
    let lastPush = 0;
    let lostSince = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const map = mapRef.current;
      if (!map || !loadedRef.current) return;
      const follow = cockpitHexRef.current;
      const zoom = map.getZoom();
      const cadence = follow ? 50 : zoom < 5.5 ? 1000 : zoom < 8 ? 150 : 50;
      let posed: Aircraft[] | null = null;
      if (now - lastPush >= cadence) {
        lastPush = now;
        posed = motionRef.current.applyTo(aircraftRef.current, now);
        (map.getSource("aircraft") as maplibregl.GeoJSONSource | undefined)?.setData(
          aircraftFeatures(posed, watchedRef.current, follow),
        );
        // Icons fly out from under a resting cursor: drop the hover tip once nothing is there.
        const popup = popupRef.current;
        const pt = mouseRef.current;
        if (popup?.isOpen() && pt && map.getLayer("ac-icons")) {
          const under = map.queryRenderedFeatures(pt, { layers: ["ac-icons", "airport-dot"] });
          if (under.length === 0) popup.remove();
        }
      }
      if (!follow) {
        lostSince = 0;
        return;
      }
      // Cockpit: the camera moves every frame; the HUD text 5×/s.
      const ac = aircraftRef.current.find((a) => a.hex === follow);
      const pose =
        motionRef.current.pose(follow, now) ??
        (ac?.lat != null && ac.lon != null
          ? { lat: ac.lat, lon: ac.lon, alt: ac.altitude_ft, track: ac.track_deg ?? 0 }
          : null);
      if (!ac || !pose) {
        // Target dropped out of the feed (landed, filtered, out of range): give it a few
        // seconds to come back, then step back out rather than freezing on a stale view.
        if (!lostSince) lostSince = now;
        else if (now - lostSince > 6000) exitCockpitRef.current();
        return;
      }
      lostSince = 0;
      try {
        applyCockpitCamera(map, pose, ac, configRef.current);
      } catch {
        /* camera animation in progress */
      }
      if (now - lastHudRef.current > 200) {
        lastHudRef.current = now;
        const list = cockpitCandidates(posed ?? aircraftRef.current);
        const idx = list.findIndex((a) => a.hex === follow);
        setHud({
          hex: follow,
          label: aircraftLabel(ac),
          type: ac.type.friendly_name,
          phase: flightPhase({ ...ac, altitude_ft: pose.alt }),
          alt: fmtAlt(pose.alt),
          gs: fmtSpeed(ac.ground_speed_kt),
          hdg: `${Math.round(pose.track)}°`,
          vs: fmtVrate(ac.vertical_rate_fpm),
          rwy: ac.runway?.runway ? `${ac.runway.runway} · ${ac.distance_nm?.toFixed(1) ?? "—"} nm` : "",
          idx,
          total: list.length,
        });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Update runways + spots when config arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !config) return;
    (map.getSource("runways") as maplibregl.GeoJSONSource)?.setData(runwayFeatures(config));
    addSpotMarkers(map, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // Ensure the nearby-airport layers exist + are current. Kept separate (and idempotent)
  // so they survive hot-reloads and re-appear if the style was rebuilt.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    ensureAirportLayers(map, config?.defaults.search_radius_nm ?? 250, getBasemap(basemapId).theme);
  }, [config, basemapId]);

  // Update approach centerline on flow change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource("centerline") as maplibregl.GeoJSONSource)?.setData(centerlineFeature(flow));
  }, [flow]);

  // Update selected highlight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter("ac-selected", ["==", ["get", "hex"], selectedHex ?? ""]);
  }, [selectedHex]);

  // Fly to a focus target (e.g. clicked aircraft / spot). Only a *new* focus should fly —
  // toggling 3D or leaving the cockpit must not re-run the last flight.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || cockpitHexRef.current) return;
    map.flyTo({
      center: [focus.lon, focus.lat],
      zoom: focus.zoom ?? Math.max(map.getZoom(), 10),
      pitch: threeDRef.current ? Math.max(map.getPitch(), 50) : map.getPitch(),
      speed: 0.8,
    });
  }, [focus]);

  function enable3d() {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    setMap3d(map, true, getBasemap(basemapRef.current).theme);
    if (map.getPitch() < 40) {
      map.easeTo({ pitch: 58, duration: 800 });
    }
    setThreeD(true);
  }

  function disable3d() {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    // Leaving 3D from the cockpit: restore where the user was, but flat.
    const saved = cockpitHexRef.current ? savedCamRef.current : null;
    exitCockpit(false);
    setMap3d(map, false, getBasemap(basemapRef.current).theme);
    map.easeTo({
      ...(saved ? { center: saved.center, zoom: saved.zoom } : {}),
      pitch: 0,
      bearing: 0,
      duration: 600,
    });
    setThreeD(false);
  }

  function enterCockpit(hex: string) {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    if (!cockpitHexRef.current) {
      // Remember whether 3D was the user's choice or ours, so Exit lands them back where
      // they were (flat map stays flat).
      auto3dRef.current = !threeDRef.current;
      savedCamRef.current = {
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      };
    }
    if (!threeDRef.current) {
      setMap3d(map, true, getBasemap(basemapRef.current).theme);
      threeDRef.current = true;
      setThreeD(true);
    }
    cockpitHexRef.current = hex; // let the very next frame pick it up
    setCockpitHex(hex);
    onSelect(hex);
    popupRef.current?.remove();
    try {
      map.stop();
      setMapInteractive(map, false);
    } catch {
      /* ignore */
    }
  }

  function exitCockpit(restoreCamera = true) {
    const map = mapRef.current;
    if (!cockpitHexRef.current) return;
    cockpitHexRef.current = null;
    setCockpitHex(null);
    setHud(null);
    if (map) {
      setMapInteractive(map, true);
      const saved = savedCamRef.current;
      savedCamRef.current = null;
      if (auto3dRef.current) {
        // We switched 3D on for the ride; switch it back off.
        auto3dRef.current = false;
        setMap3d(map, false, getBasemap(basemapRef.current).theme);
        threeDRef.current = false;
        setThreeD(false);
      }
      if (saved && restoreCamera) {
        map.stop();
        map.easeTo({ ...saved, duration: 700 });
      }
    }
  }
  exitCockpitRef.current = exitCockpit;

  function cycleCockpit(dir: 1 | -1) {
    const list = cockpitCandidates(aircraftRef.current);
    if (list.length === 0) return;
    const cur = cockpitHexRef.current;
    const i = Math.max(0, list.findIndex((a) => a.hex === cur));
    enterCockpit(list[(i + dir + list.length) % list.length].hex);
  }

  function startCockpit() {
    if (cockpitHex) {
      exitCockpit();
      return;
    }
    const list = cockpitCandidates(aircraft);
    const selected = aircraft.find((a) => a.hex === selectedHex && a.lat != null);
    const pick = selected || list[0];
    if (pick) enterCockpit(pick.hex);
    else flashNote("No approach or departure to ride along with right now — pick any aircraft and use “Cockpit view”.");
  }

  function flashNote(text: string) {
    setNote(text);
    window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => setNote(null), 3500);
  }

  // Detail-panel "Cockpit view" button.
  useEffect(() => {
    if (!cockpitRequest) return;
    enterCockpit(cockpitRequest);
    onCockpitRequestHandled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cockpitRequest]);

  return (
    <>
      <div ref={containerRef} className="map-container" />
      {!mapError && (
        <div className={`map-controls${cockpitHex ? " in-cockpit" : ""}`}>
          <div className="map-controls-row">
            <div className="basemap-switch mode-switch" title="3D terrain and cockpit">
              <button
                className={threeD ? "active" : ""}
                onClick={() => (threeD ? disable3d() : enable3d())}
                title={threeD ? "Back to the flat map" : "Tilt the map over 3D terrain"}
              >
                3D
              </button>
              <button
                className={cockpitHex ? "active" : ""}
                onClick={startCockpit}
                title={cockpitHex ? "Leave the cockpit" : "Ride along on an approach or departure"}
              >
                Cockpit
              </button>
            </div>
            <div className="basemap-switch">
              {BASEMAPS.map((b) => (
                <button
                  key={b.id}
                  className={b.id === basemapId ? "active" : ""}
                  onClick={() => onBasemapChange(b.id)}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="basemap-switch view-switch" title="Jump to a region">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => {
                  if (cockpitHex) exitCockpit(false);
                  mapRef.current?.flyTo({
                    center: v.center,
                    zoom: v.zoom,
                    pitch: threeD ? (v.id === "lax" ? 60 : v.id === "socal" ? 50 : 35) : 0,
                    bearing: threeD && v.id === "lax" ? (flow === "west" ? 250 : 70) : 0,
                    speed: 1.1,
                  });
                }}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {note && !cockpitHex && <div className="map-note">{note}</div>}
      {cockpitHex && (
        <div className="cockpit-hud">
          {!hud ? (
            <div className="cockpit-top">
              <div>
                <div className="cockpit-call">Climbing aboard…</div>
                <div className="cockpit-sub">Waiting for the next position fix</div>
              </div>
              <button className="mini" onClick={() => exitCockpit()}>
                Exit
              </button>
            </div>
          ) : (
            <>
              <div className="cockpit-top">
                <div>
                  <div className="cockpit-call">{hud.label}</div>
                  <div className="cockpit-sub">
                    {hud.type}
                    <span className={`cockpit-phase ${hud.phase}`}>{hud.phase}</span>
                    {hud.rwy && <span> · {hud.rwy}</span>}
                  </div>
                </div>
                <button className="mini" onClick={() => exitCockpit()}>
                  Exit
                </button>
              </div>
              <div className="cockpit-dials">
                <div>
                  <em>ALT</em>
                  <b>{hud.alt}</b>
                </div>
                <div>
                  <em>GS</em>
                  <b>{hud.gs}</b>
                </div>
                <div>
                  <em>HDG</em>
                  <b>{hud.hdg}</b>
                </div>
                <div>
                  <em>VS</em>
                  <b>{hud.vs}</b>
                </div>
              </div>
              {hud.total > 0 && (
                <div className="cockpit-nav">
                  <button className="mini" onClick={() => cycleCockpit(-1)} disabled={hud.total < 2 && hud.idx >= 0}>
                    ◀ Prev
                  </button>
                  <span>
                    {hud.idx >= 0
                      ? `${hud.idx + 1} of ${hud.total} arriving / departing LAX`
                      : `${hud.total} arriving / departing LAX`}
                  </span>
                  <button className="mini" onClick={() => cycleCockpit(1)} disabled={hud.total < 2 && hud.idx >= 0}>
                    Next ▶
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {mapError && (
        <div className="map-fallback">
          <div>
            <strong>Map unavailable</strong>
            <p>Your browser couldn't start WebGL. The live data, alerts, and recommendations still work in the panel.</p>
          </div>
        </div>
      )}
    </>
  );
}
