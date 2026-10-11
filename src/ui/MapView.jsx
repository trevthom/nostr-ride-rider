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
//    navigation        trip mode (turns on the props below)
//    follow            {lat,lng,id} the vehicle to follow; id = that car's `pubkey`
//  Ref: { fit() } re-centres the view (in trip mode: back on the vehicle).
//
//  TRIP MODE (`navigation`): the camera zooms in on the vehicle and follows it, north
//  at the top. Dragging or zooming the map stops the following; a "Re-center" button
//  then returns to the vehicle at the following zoom. A compass button switches
//  between north-up and heading-up (the map turns so the car drives "up the screen").
//  The map sits in an oversized box that is turned with CSS, so turning never shows
//  an empty corner; panning is done here (Leaflet's own drag does not know about the turn).
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
import Icon from "./Icon.jsx";
import { TILE_URL, TILE_ATTRIBUTION as TILE_ATTR } from "../config/services.js";

const DEFAULT_CENTER = [SAMPLE_LOCATIONS[0].lat, SAMPLE_LOCATIONS[0].lng];

const shadow = "box-shadow:0 1px 5px rgba(0,0,0,.45)";
const pinIcon = (square, pulse) =>
  L.divIcon({
    className: "nr-pin",
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    html: `<div class="nr-up" style="position:relative;width:20px;height:20px">${pulse ? '<span class="nr-ring"></span>' : ""}
      <div style="position:absolute;inset:0;background:${THEME.ink};border:3px solid #fff;${square ? "" : "border-radius:50%;"}${shadow}"></div></div>`,
  });

const meIcon = L.divIcon({
  className: "nr-pin",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<div class="nr-up" style="width:22px;height:22px;border-radius:50%;background:#276ef1;border:3px solid #fff;${shadow}"></div>`,
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
    html: `<div class="nr-up"><div style="transform:translate(-50%,-50%);white-space:nowrap;background:#000;color:#fff;border:2px solid #fff;border-radius:999px;padding:3px 9px;font:700 12px Inter,system-ui,sans-serif;${shadow}">${esc(text)}</div></div>`,
  });

const FOLLOW_ZOOM = 17; // street level
const TURN_MIN_METERS = 12; // the map turns only after the car moved this far (GPS noise)
const rad = Math.PI / 180;

// Compass button: the needle always points to north on the screen.
function CompassIcon({ angle }) {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-angle}deg)`, transition: "transform .6s ease" }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke="#000" strokeWidth="1.6" />
      <path d="M12 3.5 L15.2 12 H8.8 Z" fill="#e5322d" />
      <path d="M12 20.5 L15.2 12 H8.8 Z" fill="#000" />
    </svg>
  );
}

const ptKey = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const valid = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng);

const MapView = forwardRef(function MapView(
  { pickup, dropoff, route, routeDashed = false, cars, me, pills, onPill, pulse = false, fitKey = "", padBottom = 60, padTop = 70, onRoute, height, navigation = false, follow = null },
  ref
) {
  const boxRef = useRef(null);
  const outerRef = useRef(null); // trip mode: the frame that clips the turned map
  const [dims, setDims] = useState({ w: 390, h: 700 });
  const [following, setFollowing] = useState(true);
  const [orient, setOrient] = useState("north"); // "north" | "heading"
  const [angle, setAngle] = useState(0); // how far the map is turned (degrees, unwrapped)
  const [carDeg, setCarDeg] = useState(null); // direction of travel of the followed car
  const angleRef = useRef(0);
  const programmatic = useRef(false); // true while the app itself moves the camera
  const followingRef = useRef(true);
  const turnFrom = useRef(null); // where the car was when the map last turned
  const mapRef = useRef(null);
  const layers = useRef({});
  const routeLatLngs = useRef([]);
  const reqId = useRef(0);
  const heading = useRef(new Map()); // car key -> { lat, lng, deg }
  const latest = useRef({});
  const [failed, setFailed] = useState(false);
  const [routeTick, setRouteTick] = useState(0);
  latest.current = { pickup, dropoff, cars, me, pills, padBottom, padTop, onRoute, onPill, navigation, follow, dims };
  followingRef.current = following;
  const box = Math.ceil(Math.hypot(dims.w, dims.h)); // side of the oversized map box
  // Screens pass fresh arrays on every render; redraw only when the content changes.
  const pillsKey = (pills || []).map((p) => `${p.id}|${p.text}|${p.lat}|${p.lng}`).join(";");
  const carsKey = (cars || []).map((c) => `${c.pubkey}|${c.lat}|${c.lng}`).join(";");

  // Fit the view to everything currently drawn.
  function fit() {
    const map = mapRef.current;
    if (!map) return;
    const { pickup, dropoff, cars, me, pills, padBottom, padTop, navigation, dims } = latest.current;
    // In trip mode the map box is larger than what is on screen: add the hidden margin to the padding.
    const D = Math.ceil(Math.hypot(dims.w, dims.h));
    const ex = navigation ? (D - dims.w) / 2 : 0, ey = navigation ? (D - dims.h) / 2 : 0;
    const pts = [];
    [pickup, dropoff, me].forEach((p) => valid(p) && pts.push([p.lat, p.lng]));
    (cars || []).forEach((c) => valid(c) && pts.push([c.lat, c.lng]));
    (pills || []).forEach((c) => valid(c) && pts.push([c.lat, c.lng]));
    routeLatLngs.current.forEach((p) => pts.push(p));
    if (!pts.length) return;
    programmatic.current = true;
    try {
      map.invalidateSize();
      if (pts.length === 1) {
        map.setView(pts[0], 15, { animate: false });
        map.panBy([0, (padBottom - padTop) / 2], { animate: false });
      } else {
        map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [36 + ex, padTop + ey], paddingBottomRight: [36 + ex, padBottom + ey], maxZoom: 16, animate: false });
      }
    } catch { /* ignore */ }
    programmatic.current = false;
  }

  // Trip mode: put the vehicle in the middle of the part of the map that is not covered
  // by the sheet or the top bar, at street zoom.
  function applyFollow() {
    const map = mapRef.current;
    const { follow, padBottom, padTop } = latest.current;
    if (!map || !valid(follow) || !followingRef.current) return;
    const dy = (padTop - padBottom) / 2; // the vehicle sits this far below the screen centre (above it, usually)
    const b = angleRef.current * rad; // turn the screen offset into the map's own direction
    const mx = -dy * Math.sin(b), my = dy * Math.cos(b);
    programmatic.current = true;
    try {
      const center = map.unproject(map.project([follow.lat, follow.lng], FOLLOW_ZOOM).subtract([mx, my]), FOLLOW_ZOOM);
      // No animation when the zoom changes: an animated zoom reports its start later, and that would look like the user zooming.
      if (map.getZoom() !== FOLLOW_ZOOM) map.setView(center, FOLLOW_ZOOM, { animate: false });
      else map.panTo(center, { animate: true, duration: 0.8, easeLinearity: 0.5 });
    } catch { /* ignore */ }
    programmatic.current = false;
  }

  const recenter = () => { setFollowing(true); followingRef.current = true; applyFollow(); };
  useImperativeHandle(ref, () => ({ fit: () => (latest.current.navigation && valid(latest.current.follow) ? recenter() : fit()) }));

  // Create the map once.
  useEffect(() => {
    let map;
    try {
      const nav = latest.current.navigation;
      // Trip mode zooms about the screen centre (a turned map confuses pointer-based zoom) and pans through our own handler.
      map = L.map(boxRef.current, {
        zoomControl: false, attributionControl: !nav, dragging: !nav,
        scrollWheelZoom: nav ? "center" : true, touchZoom: nav ? "center" : true, doubleClickZoom: nav ? "center" : true, boxZoom: !nav,
      });
      if (!nav) map.attributionControl.setPrefix(false);
      map.setView(DEFAULT_CENTER, 12);
      // Zooming by hand (pinch, wheel, double tap) ends the following; the app's own moves do not.
      // (Added after the first setView, which is the app's own.)
      map.on("zoomstart", () => { if (nav && !programmatic.current) { followingRef.current = false; setFollowing(false); } });
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

  // Trip mode: track the size of the frame (the oversized map box follows it).
  useEffect(() => {
    if (!navigation || !outerRef.current) return;
    const read = () => { const el = outerRef.current; if (!el) return; const r = el.getBoundingClientRect(); if (r.width && r.height) setDims({ w: Math.round(r.width), h: Math.round(r.height) }); };
    read();
    let ro;
    try { ro = new ResizeObserver(read); ro.observe(outerRef.current); } catch { /* keep the first size */ }
    return () => ro && ro.disconnect();
  }, [navigation]);
  useEffect(() => { try { mapRef.current?.invalidateSize({ animate: false }); } catch { /* ignore */ } }, [box]);

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
        if (latest.current.navigation && latest.current.follow?.id === key) {
          // Turn the map only after real movement, so GPS noise does not spin it.
          const from = turnFrom.current;
          if (!from) turnFrom.current = { lat: c.lat, lng: c.lng };
          else if (haversineDistance(from.lat, from.lng, c.lat, c.lng) * 1609.344 >= TURN_MIN_METERS) {
            setCarDeg(bearing(from, c));
            turnFrom.current = { lat: c.lat, lng: c.lng };
          }
        }
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
  const hasFollow = valid(follow);
  useEffect(() => {
    if (navigation && hasFollow && followingRef.current) return; // the camera is on the vehicle
    if (navigation && hasFollow === false && !followingRef.current) return; // the user moved the map: leave it
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, routeTick, padBucket]);

  // Trip mode: the map turns toward the car's direction (heading-up) or stays north-up.
  useEffect(() => {
    if (!navigation) return;
    const target = orient === "heading" && carDeg != null ? carDeg : 0;
    const d = ((target - angleRef.current) % 360 + 540) % 360 - 180; // the short way round
    const next = angleRef.current + d;
    angleRef.current = next;
    setAngle(next);
  }, [navigation, orient, carDeg]);

  // Trip mode: keep the camera on the vehicle as it moves.
  useEffect(() => {
    if (navigation && following) applyFollow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, following, follow?.lat, follow?.lng, angle, dims.w, dims.h]);
  // ...and when the sheet over the map changes size (after it settles).
  useEffect(() => {
    if (!navigation || !following) return;
    const t = setTimeout(applyFollow, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [padBucket]);

  // Trip mode: drag with one finger/mouse to pan (this also stops the following).
  const pan = useRef(null);
  const panDown = (e) => {
    if (!mapRef.current || (e.button != null && e.button !== 0)) return;
    pan.current = { id: e.pointerId, x: e.clientX, y: e.clientY, total: 0 };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const panMove = (e) => {
    const p = pan.current;
    if (!p || p.id !== e.pointerId || !mapRef.current) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    p.total += Math.abs(dx) + Math.abs(dy);
    if (p.total < 6) return; // a tap, not a drag
    if (followingRef.current) { followingRef.current = false; setFollowing(false); }
    const b = angleRef.current * rad; // screen movement -> the map's own direction
    mapRef.current.panBy([-(dx * Math.cos(b) - dy * Math.sin(b)), -(dx * Math.sin(b) + dy * Math.cos(b))], { animate: false });
  };
  const panUp = (e) => { if (pan.current?.id === e.pointerId) pan.current = null; };

  if (failed) {
    return (
      <div style={height ? { height } : undefined} className={`${height ? "" : "absolute inset-0"} w-full flex items-center justify-center bg-neutral-100`}>
        <p className="text-neutral-500 text-sm px-4 text-center">The map couldn't load in this browser.</p>
      </div>
    );
  }

  if (!navigation) {
    return <div ref={boxRef} style={height ? { height, width: "100%" } : undefined} className={height ? "" : "absolute inset-0"} />;
  }

  const stop = (e) => e.stopPropagation(); // buttons must not start a pan
  const ctl = "w-11 h-11 rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.22)] flex items-center justify-center text-black active:bg-neutral-100";
  return (
    <div
      ref={outerRef}
      className="absolute inset-0 overflow-hidden"
      style={{ touchAction: "none" }}
      onPointerDown={panDown}
      onPointerMove={panMove}
      onPointerUp={panUp}
      onPointerCancel={panUp}
    >
      <div
        ref={boxRef}
        style={{
          position: "absolute", left: "50%", top: "50%", width: box, height: box, marginLeft: -box / 2, marginTop: -box / 2,
          transform: `rotate(${-angle}deg)`, transition: "transform .6s ease", "--nr-rot": `${angle}deg`,
        }}
      />
      <div className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] z-[550] flex flex-col items-center gap-3" onPointerDown={stop}>
        <button
          type="button"
          className={ctl}
          aria-label={orient === "north" ? "North up. Tap for heading up" : "Heading up. Tap for north up"}
          aria-pressed={orient === "heading"}
          onClick={() => setOrient((o) => (o === "north" ? "heading" : "north"))}
        >
          <CompassIcon angle={angle} />
        </button>
        {hasFollow && !following && (
          <button type="button" className={`${ctl} !w-auto px-4 gap-2 text-sm font-semibold`} aria-label="Re-center on the vehicle" onClick={recenter}>
            <Icon name="navigation" size={16} /> Re-center
          </button>
        )}
      </div>
      <p className="absolute right-1 bottom-0 z-[550] text-[10px] text-neutral-600 bg-white/70 px-1 pointer-events-none">{TILE_ATTR}</p>
    </div>
  );
});

export default MapView;
