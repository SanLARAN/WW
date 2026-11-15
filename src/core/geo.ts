export const EARTH_R_KM = 6371;
export const DEG = Math.PI / 180;

export interface LatLon { lat: number; lon: number }

/** Unit-sphere position. Matches THREE.SphereGeometry UV layout (u=(lon+180)/360, v=(lat+90)/180). */
export function toXYZ(lat: number, lon: number, r = 1): [number, number, number] {
  const la = lat * DEG, lo = lon * DEG;
  const c = Math.cos(la);
  return [r * c * Math.cos(lo), r * Math.sin(la), -r * c * Math.sin(lo)];
}

export function fromXYZ(x: number, y: number, z: number): LatLon {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: Math.asin(Math.max(-1, Math.min(1, y / r))) / DEG, lon: Math.atan2(-z, x) / DEG };
}

export function distKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG, dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Great-circle interpolation, t in [0,1]. */
export function gcLerp(lat1: number, lon1: number, lat2: number, lon2: number, t: number): LatLon {
  const a = toXYZ(lat1, lon1), b = toXYZ(lat2, lon2);
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return { lat: lat1, lon: lon1 };
  const s = Math.sin(om), k1 = Math.sin((1 - t) * om) / s, k2 = Math.sin(t * om) / s;
  return fromXYZ(a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2);
}

/** Move from (lat,lon) toward (lat2,lon2) by km, clamped to the target. */
export function stepToward(lat: number, lon: number, lat2: number, lon2: number, km: number): LatLon & { arrived: boolean } {
  const d = distKm(lat, lon, lat2, lon2);
  if (d <= km || d < 1e-6) return { lat: lat2, lon: lon2, arrived: true };
  return { ...gcLerp(lat, lon, lat2, lon2, km / d), arrived: false };
}

export const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
