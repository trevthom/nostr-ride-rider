// ════════════════════════════════════════════════════════════
//  GEOCODE — Turn typed text into real places, using Photon
//  (photon.komoot.io), an OpenStreetMap geocoder BUILT for search-as-
//  you-type. (Nominatim's usage policy forbids client-side
//  autocomplete, so we don't use it here.) Results can be biased
//  toward a point near the user.
//
//  Returns [{ name, fullName, area, lat, lng }]. `area` is a coarse,
//  shareable label (e.g. "Downtown, Lexington") that ride requests
//  publish instead of the exact address (see lib/privacy.js).
//
//  NOTE: the public Photon server is for fair, light use. For
//  production, self-host Photon or use a paid geocoder — keep this same
//  return shape and nothing else needs to change.
// ════════════════════════════════════════════════════════════

import { PHOTON_URL } from "../config/services.js";

const ENDPOINT = `${PHOTON_URL}/api/`;
const REVERSE = `${PHOTON_URL}/reverse`;
const uniq = (parts) => [...new Set(parts.filter(Boolean))];

// Short name for cards, e.g. "Rupp Arena, Lexington" or "430 W Vine St, Lexington".
function shortName(p) {
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const first = p.name || street;
  return uniq([first, first === p.name ? street : "", p.city || p.county]).slice(0, 2).join(", ");
}

// A coarse label for where a place is — never the street.
function areaOf(p) {
  return uniq([p.district || p.locality || p.city || p.county, p.city || p.county]).join(", ") || p.state || "";
}

// Name a GPS position ("430 West Vine Street, Lexington"). The position is
// rounded to ~10 m. Returns { name, fullName, area, lat, lng } or null.
export async function reverseGeocode(lat, lng) {
  const params = new URLSearchParams({ lat: lat.toFixed(4), lon: lng.toFixed(4), lang: "en", limit: "1" });
  const res = await fetch(`${REVERSE}?${params}`);
  if (!res.ok) throw new Error("Address lookup failed");
  const f = (await res.json()).features?.[0];
  if (!f) return null;
  const p = f.properties || {};
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const name = shortName(p);
  if (!name) return null;
  return {
    name,
    fullName: uniq([p.name, street, p.postcode, p.city || p.county, p.state, p.country]).join(", "),
    area: areaOf(p),
    lat,
    lng,
  };
}

// near: optional { lat, lng } to rank close results first. It's rounded
// to ~1 km so the geocoder never sees the user's exact position.
export async function searchAddress(query, { near, limit = 5 } = {}) {
  const q = query.trim();
  if (q.length < 3) return [];
  const params = new URLSearchParams({ q, limit: String(limit), lang: "en" });
  if (near && typeof near.lat === "number") {
    params.set("lat", near.lat.toFixed(2));
    params.set("lon", near.lng.toFixed(2));
  }
  const res = await fetch(`${ENDPOINT}?${params}`);
  if (!res.ok) throw new Error("Address search failed");
  const data = await res.json();
  return (data.features || [])
    .filter((f) => Array.isArray(f?.geometry?.coordinates) && f.geometry.coordinates.length >= 2)
    .map((f) => {
      const p = f.properties || {};
      const [lng, lat] = f.geometry.coordinates;
      const street = [p.housenumber, p.street].filter(Boolean).join(" ");
      return {
        name: shortName(p) || q,
        fullName: uniq([p.name, street, p.postcode, p.city || p.county, p.state, p.country]).join(", "),
        area: areaOf(p),
        lat,
        lng,
      };
    });
}
