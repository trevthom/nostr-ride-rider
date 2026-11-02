// ════════════════════════════════════════════════════════════
//  ROUTING — Get a real driving route between points. Normal routes use the
//  public OSRM demo server; toll-free routes use the public Valhalla server,
//  because the OSRM demo server rejects exclude=toll. Both return the same
//  fields: coordinates, distanceMeters and durationSeconds.
//
//  NOTE: the public servers are demos (rate-limited, no uptime guarantee).
//  For production, self-host OSRM and Valhalla or use a paid routing API
//  (Mapbox Directions, GraphHopper, Google) — keep this same return shape.
// ════════════════════════════════════════════════════════════

import { OSRM_URL, VALHALLA_URL } from "../config/services.js";

const ENDPOINT = `${OSRM_URL}/route/v1/driving`;
const VALHALLA_ENDPOINT = `${VALHALLA_URL}/route`;

// The map and the screens both ask for the same route; remember answers
// (by ~1 m coordinates) so each route is fetched once. Failures are not kept.
const cache = new Map();
const CACHE_MAX = 60;

// points: [{ lat, lng }, ...] (need at least 2).
// `avoidTolls` asks Valhalla for a toll-free route. There is no fallback to a
// toll route: if no toll-free route is available, null is returned so the
// caller can ask the rider to uncheck the box.
// Returns { coordinates: [[lng,lat],...], distanceMeters, durationSeconds }.
export function getDrivingRoute(points, { avoidTolls = false } = {}) {
  if (!points || points.length < 2) return Promise.resolve(null);
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  const key = coords + (avoidTolls ? "|no-tolls" : "");
  if (cache.has(key)) return cache.get(key);
  const job = avoidTolls ? fetchTollFreeRoute(points) : fetchOsrmRoute(coords);
  cache.set(key, job);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  job.catch(() => cache.delete(key));
  return job;
}

async function fetchOsrmRoute(coords) {
  const url = `${ENDPOINT}/${coords}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Routing request failed");
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route) return null;
  return {
    coordinates: route.geometry.coordinates,
    distanceMeters: route.distance,
    durationSeconds: route.duration,
  };
}

// Valhalla's native route response has the toll summary, so a route that still
// uses a toll is rejected instead of shown as toll-free. Its shape is a
// polyline encoded with 6 digits.
async function fetchTollFreeRoute(points) {
  const res = await fetch(VALHALLA_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      locations: points.map((p) => ({ lat: p.lat, lon: p.lng })),
      costing: "auto",
      costing_options: { auto: { use_tolls: 0 } },
      directions_options: { units: "miles" },
    }),
  });
  if (!res.ok) throw new Error("Toll-free routing request failed");
  const data = await res.json();
  const trip = data.trip;
  if (!trip || trip.summary?.has_toll === true) return null;
  const coordinates = (trip.legs || []).flatMap((leg) => decodePolyline(leg.shape, 6));
  if (!coordinates.length) return null;
  const miles = Number(trip.summary?.length);
  const seconds = Number(trip.summary?.time);
  if (!Number.isFinite(miles) || !Number.isFinite(seconds)) return null;
  return { coordinates, distanceMeters: miles * 1609.344, durationSeconds: seconds };
}

// Decode a Google/Valhalla polyline into [[lng,lat],...].
export function decodePolyline(encoded, precision = 6) {
  if (typeof encoded !== "string" || !encoded) return [];
  const factor = 10 ** precision;
  const out = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do {
      if (index >= encoded.length) return out;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      if (index >= encoded.length) return out;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    out.push([lng / factor, lat / factor]);
  }
  return out;
}

// Convenience: driving distance in miles (or null if it fails).
export function metersToMiles(meters) {
  return meters / 1609.344;
}
