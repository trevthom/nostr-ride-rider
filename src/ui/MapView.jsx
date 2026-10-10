// ════════════════════════════════════════════════════════════
//  MAP VIEW — A real interactive map (Leaflet + free OpenStreetMap
//  tiles). Leaflet draws plain DOM elements
//  (no WebGL), so it works in any browser. Fills its parent by default.
//
//  Props (all optional):
//    pickup, dropoff   {lat,lng}  black dot / black square pins
//    route             [{lat,lng}…] draw the OSRM driving route through these
//    routeDashed       dashed line (e.g. driver → pickup)
//    cars              [{pubkey,lat,lng,name}]  car icons (heading follows movement)
//    me                {lat,lng}  blue "you are here" dot
//    pills, onPill     [{id,lat,lng,text}] price tags (open requests); tap → onPill(id)
//    pulse             radar rings around the pickup ("finding your driver")
//    fitKey            string — the view re-fits to everything shown whenever
//                      this changes (NOT on every car move, so the user can pan)
//    padBottom/padTop  pixels covered by the bottom sheet / top bar
//    onRoute           ({miles, minutes, straight}) when the route resolves
//    height            fixed pixel height; omit to fill the parent
//  Ref: { fit() } re-centres the view.
//
//  Only ONE map per screen. Everything touching Leaflet is wrapped in
//  try/catch so a map failure shows a small fallback, not a crash.
// ════════════════════════════════════════════════════════════

import { useRef, useEffect, useState, useImperativeHandle, forwardRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getDrivingRoute, metersToMiles } from "../lib/routing.js";
import { haversineDistance } from "../lib/geo.js";
import { SAMPLE_LOCATIONS } from "../lib/locations.js";
import { THEME } from "../theme.js";
import { TILE_URL, TILE_ATTRIBUTION as TILE_ATTR } from "../config/services.js";

const DEFAULT_CENTER = [SAMPLE_LOCATIONS[0].lat, SAMPLE_LOCATIONS[0].lng];

const shadow = "box-shadow:0 1px 5px rgba(0,0,0,.45)";
const pinIcon = (square, pulse) =>
  L.divIcon({
    className: "nr-pin",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div style="position:relative;width:20px;height:20px">${pulse ? '<span class="nr-ring"></span>' : ""}
      <div style="position:absolute;inset:0;background:${THEME.ink};border:3px solid #fff;${square ? "" : "border-radius:50%;"}${shadow}"></div></div>`,
  });

const meIcon = L.divIcon({
  className: "nr-pin",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#276ef1;border:3px solid #fff;${shadow}"></div>`,
});

// A top-down car in a white disc, rotated to the direction of travel.
const carIcon = (heading) =>
  L.divIcon({
    className: "nr-pin",
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    html: `<div style="width:38px;height:38px;border-radius:50%;background:#fff;${shadow};display:flex;align-items:center;justify-content:center">
      <svg width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(${heading}deg);transition:transform .4s">
        <rect x="7" y="1.5" width="10" height="21" rx="4.5" fill="#000"/>
        <rect x="8.7" y="5" width="6.6" height="4.2" rx="1.2" fill="#fff"/>
        <rect x="8.7" y="15" width="6.6" height="3.2" rx="1" fill="#fff"/>
        <rect x="5.2" y="8.2" width="2" height="2.6" rx="1" fill="#000"/>
        <rect x="16.8" y="8.2" width="2" height="2.6" rx="1" fill="#000"/></svg></div>`,
  });

// Compass bearing (0 = up/north) from one point to another.
function bearing(a, b) {
  const rad = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * rad) * Math.cos(b.lat * rad);
  const x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lng - a.lng) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

// A small black price tag. `text` is built by the app (never relay text), but is escaped anyway.
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pillIcon = (text) =>
  L.divIcon({
    className: "nr-pin",
    iconSize: [0, 0],
    html: `<div style="transform:translate(-50%,-50%);white-space:nowrap;background:#000;color:#fff;border:2px solid #fff;border-radius:999px;padding:3px 9px;font:700 12px Inter,system-ui,sans-serif;${shadow}">${esc(text)}</div>`,
  });

const ptKey = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

const MapView = forwardRef(function MapView(
  { pickup, dropoff, route, routeDashed = false, cars, me, pills, onPill, pulse = false, fitKey = "", padBottom = 60, padTop = 70, onRoute, height },
  ref
) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const layers = useRef({});
  const routeLatLngs = useRef([]);
  const reqId = useRef(0);
  const heading = useRef(new Map()); // car key -> { lat, lng, deg }
  const latest = useRef({});
  const [failed, setFailed] = useState(false);
  const [routeTick, setRouteTick] = useState(0);
  latest.current = { pickup, dropoff, cars, me, pills, padBottom, padTop, onRoute, onPill };
  // Screens pass fresh arrays on every render; redraw only when the content changes.
  const pillsKey = (pills || []).map((p) => `${p.id}|${p.text}|${p.lat}|${p.lng}`).join(";");
  const carsKey = (cars || []).map((c) => `${c.pubkey}|${c.lat}|${c.lng}`).join(";");

  // Fit the view to everything currently drawn.
  function fit() {
    const map = mapRef.current;
    if (!map) return;
    const { pickup, dropoff, cars, me, pills, padBottom, padTop } = latest.current;
    const pts = [];
    [pickup, dropoff, me].forEach((p) => valid(p) && pts.push([p.lat, p.lng]));
    (cars || []).forEach((c) => valid(c) && pts.push([c.lat, c.lng]));
    (pills || []).forEach((c) => valid(c) && pts.push([c.lat, c.lng]));
    routeLatLngs.current.forEach((p) => pts.push(p));
    if (!pts.length) return;
    try {
      map.invalidateSize();
      if (pts.length === 1) {
        map.setView(pts[0], 15, { animate: false });
        map.panBy([0, (padBottom - padTop) / 2], { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [36, padTop], paddingBottomRight: [36, padBottom], maxZoom: 16, animate: false });
      }
    } catch { /* ignore */ }
  }
  useImperativeHandle(ref, () => ({ fit }));

  // Create the map once.
  useEffect(() => {
    let map;
    try {
      map = L.map(boxRef.current, { zoomControl: false, attributionControl: true });
      map.attributionControl.setPrefix(false);
      map.setView(DEFAULT_CENTER, 12);
      L.tileLayer(TILE_URL, { attribution: TILE_ATTR, maxZoom: 19 }).addTo(map);
      ["route", "pins", "pills", "me", "cars"].forEach((k) => { layers.current[k] = L.layerGroup().addTo(map); });
      mapRef.current = map;
      setTimeout(() => { try { map.invalidateSize(); } catch { /* ignore */ } }, 0);
    } catch (e) {
      console.error("Map init failed:", e);
      setFailed(true);
    }
    // Keep the map sized to its container (sheet open/close, rotation).
    let ro;
    try { ro = new ResizeObserver(() => { try { map && map.invalidateSize(); } catch { /* ignore */ } }); ro.observe(boxRef.current); } catch { /* ignore */ }
    return () => {
      try { ro && ro.disconnect(); map && map.remove(); } catch { /* ignore */ }
      mapRef.current = null;
      layers.current = {};
    };
  }, []);

  // Pins.
  useEffect(() => {
    const g = layers.current.pins;
    if (!g) return;
    try {
      g.clearLayers();
      if (valid(pickup)) L.marker([pickup.lat, pickup.lng], { icon: pinIcon(false, pulse), keyboard: false }).addTo(g);
      if (valid(dropoff)) L.marker([dropoff.lat, dropoff.lng], { icon: pinIcon(true, false), keyboard: false }).addTo(g);
    } catch (e) { console.error("Map pins failed:", e); }
  }, [pickup?.lat, pickup?.lng, dropoff?.lat, dropoff?.lng, pulse]);

  // Price tags for open requests.
  useEffect(() => {
    const g = layers.current.pills;
    if (!g) return;
    try {
      g.clearLayers();
      (pills || []).filter(valid).forEach((p) => {
        const m = L.marker([p.lat, p.lng], { icon: pillIcon(p.text), keyboard: false });
        m.on("click", () => latest.current.onPill?.(p.id));
        m.addTo(g);
      });
    } catch (e) { console.error("Map pills failed:", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pillsKey]);

  // "You are here".
  useEffect(() => {
    const g = layers.current.me;
    if (!g) return;
    try {
      g.clearLayers();
      if (valid(me)) L.marker([me.lat, me.lng], { icon: meIcon, keyboard: false, interactive: false }).addTo(g);
    } catch (e) { console.error("Map me failed:", e); }
  }, [me?.lat, me?.lng]);

  // Cars.
  useEffect(() => {
    const g = layers.current.cars;
    if (!g) return;
    try {
      g.clearLayers();
      const seen = new Set();
      (cars || []).filter(valid).forEach((c) => {
        const key = c.pubkey || "car";
        seen.add(key);
        const prev = heading.current.get(key);
        let deg = prev?.deg ?? 0;
        if (prev && haversineDistance(prev.lat, prev.lng, c.lat, c.lng) * 1609 > 5) deg = bearing(prev, c);
        heading.current.set(key, { lat: c.lat, lng: c.lng, deg });
        L.marker([c.lat, c.lng], { icon: carIcon(deg), keyboard: false, interactive: false, zIndexOffset: 500 }).addTo(g);
      });
      [...heading.current.keys()].forEach((k) => !seen.has(k) && heading.current.delete(k));
    } catch (e) { console.error("Map cars failed:", e); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carsKey]);

  // Route (fetched only when its points change).
  const routeKey = route && route.length >= 2 && route.every(valid) ? route.map(ptKey).join(";") : "";
  useEffect(() => {
    const g = layers.current.route;
    if (!g) return;
    const mine = ++reqId.current;
    g.clearLayers();
    routeLatLngs.current = [];
    if (!routeKey) { setRouteTick((t) => t + 1); return; }
    (async () => {
      let latlngs = route.map((p) => [p.lat, p.lng]);
      let info = null;
      try {
        const r = await getDrivingRoute(route);
        if (r?.coordinates?.length) {
          latlngs = r.coordinates.map((c) => [c[1], c[0]]); // OSRM is [lng,lat]
          info = { miles: metersToMiles(r.distanceMeters), minutes: Math.max(1, Math.round(r.durationSeconds / 60)), straight: false };
        }
      } catch { /* fall back to a straight line */ }
      if (mine !== reqId.current || !layers.current.route) return;
      if (!info) {
        let miles = 0;
        for (let i = 1; i < route.length; i++) miles += haversineDistance(route[i - 1].lat, route[i - 1].lng, route[i].lat, route[i].lng);
        info = { miles: miles * 1.3, minutes: Math.max(1, Math.round((miles * 1.3 / 24) * 60)), straight: true };
      }
      try {
        L.polyline(latlngs, { color: "#fff", weight: routeDashed ? 8 : 9, opacity: 0.9, lineCap: "round" }).addTo(g);
        L.polyline(latlngs, { color: THEME.route, weight: routeDashed ? 4 : 5, opacity: 1, lineCap: "round", dashArray: routeDashed ? "2 9" : undefined }).addTo(g);
      } catch { /* ignore */ }
      routeLatLngs.current = latlngs;
      latest.current.onRoute?.(info);
      setRouteTick((t) => t + 1);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, routeDashed]);

  // Re-fit when asked to (fitKey), once a new route has been drawn, and when
  // the sheet over the map changes size by a real amount.
  const padBucket = Math.round(padBottom / 40);
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, routeTick, padBucket]);

  if (failed) {
    return (
      <div style={height ? { height } : undefined} className={`${height ? "" : "absolute inset-0"} w-full flex items-center justify-center bg-neutral-100`}>
        <p className="text-neutral-500 text-sm px-4 text-center">The map couldn't load in this browser.</p>
      </div>
    );
  }

  return <div ref={boxRef} style={height ? { height, width: "100%" } : undefined} className={height ? "" : "absolute inset-0"} />;
});

export default MapView;
