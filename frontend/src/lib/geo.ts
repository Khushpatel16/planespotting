// Tiny great-circle helpers (port of the backend geo math) for drawing the approach
// centerline and runway diagram on the client.
const R_NM = 3440.065;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export const NM_TO_M = 1852;
export const FT_TO_M = 0.3048;

/** Initial true bearing (deg, [0,360)) of the great circle from point 1 to point 2. */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dl = toRad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest signed difference a-b between two bearings, in [-180, 180]. */
export function angleDelta(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180;
}

export function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const dp = toRad(lat2 - lat1);
  const dl = toRad(lon2 - lon1);
  const a =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distNm: number,
): [number, number] {
  const ang = distNm / R_NM;
  const brg = toRad(bearingDeg);
  const p1 = toRad(lat);
  const l1 = toRad(lon);
  const p2 = Math.asin(
    Math.sin(p1) * Math.cos(ang) + Math.cos(p1) * Math.sin(ang) * Math.cos(brg),
  );
  const l2 =
    l1 +
    Math.atan2(
      Math.sin(brg) * Math.sin(ang) * Math.cos(p1),
      Math.cos(ang) - Math.sin(p1) * Math.sin(p2),
    );
  return [((toDeg(l2) + 540) % 360) - 180, toDeg(p2)]; // [lon, lat] for GeoJSON
}
