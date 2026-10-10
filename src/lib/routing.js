// ════════════════════════════════════════════════════════════
//  ROUTING — Get a real driving route between points, using the
//  public OSRM demo server. Returns the route geometry plus its
//  distance and duration.
//
//  NOTE: router.project-osrm.org is a demo server (rate-limited, no
//  uptime guarantee). For production, self-host OSRM or use a paid
//  routing API (Mapbox Directions, GraphHopper, Google) — keep this
//  same return shape.
// ════════════════════════════════════════════════════════════

import { OSRM_URL } from "../config/services.js";

const ENDPOINT = `${OSRM_URL}/route/v1/driving`;

// The map and the screens both ask for the same route; remember answers
// (by ~1 m coordinates) so each route is fetched once. Failures are not kept.
const cache = new Map();
const CACHE_MAX = 60;

// points: [{ lat, lng }, ...] (need at least 2).
// Returns { coordinates: [[lng,lat],...], distanceMeters, durationSeconds }.
export function getDrivingRoute(points) {
  if (!points || points.length < 2) return Promise.resolve(null);
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(";");
  if (cache.has(coords)) return cache.get(coords);
  const job = fetchRoute(coords);
  cache.set(coords, job);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  job.catch(() => cache.delete(coords));
  return job;
}

async function fetchRoute(coords) {
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

// Convenience: driving distance in miles (or null if it fails).
export function metersToMiles(meters) {
  return meters / 1609.344;
}
