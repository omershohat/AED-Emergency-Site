'use client';
// ============================================================================
//  MapCanvas - OpenStreetMap via Leaflet, driven by React props
// ============================================================================
//  WHY PLAIN LEAFLET AND NOT react-leaflet:
//  Leaflet is an imperative library - it creates DOM nodes and mutates them.
//  React is declarative. A wrapper hides that mismatch behind components, but
//  we would still have to explain what it does underneath. Doing it directly
//  is about forty lines, has no version-compatibility risk, and every one of
//  those lines is ours to explain.
//
//  WHY OpenStreetMap: no API key, no billing account, no registration. The
//  project runs on any machine, including the one it is graded on.
//
//  The React pattern here is: one effect CREATES the map, other effects SYNC
//  layers when props change, and every effect cleans up what it created.
// ============================================================================
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

/**
 * Marker styling by role. Built with L.divIcon (an HTML element) instead of the
 * default image icon, which avoids the well-known broken-icon-path problem with
 * bundlers and lets us colour a marker by its communication channel.
 */
const MARKER_STYLES = {
  victim: { color: '#dc2626', size: 22, ring: true, emoji: '🆘' },
  selected: { color: '#16a34a', size: 20, ring: true, emoji: '🚴' },
  LORA: { color: '#7c3aed', size: 16, ring: false, emoji: '📡' },
  SMS: { color: '#0891b2', size: 16, ring: false, emoji: '📱' },
  NONE: { color: '#64748b', size: 14, ring: false, emoji: '✖' },
  device: { color: '#94a3b8', size: 12, ring: false, emoji: '' },
};

function buildIcon(kind) {
  const style = MARKER_STYLES[kind] || MARKER_STYLES.device;
  const ring = style.ring
    ? `<span style="position:absolute;inset:0;border-radius:9999px;border:3px solid ${style.color};
         animation:pulseRing 1.8s cubic-bezier(.2,.6,.4,1) infinite;"></span>`
    : '';

  return L.divIcon({
    className: '',                       // Leaflet's own class adds a white box
    html: `<div style="position:relative;width:${style.size}px;height:${style.size}px;">
             ${ring}
             <span style="position:absolute;inset:0;border-radius:9999px;
               background:${style.color};border:2px solid #fff;
               box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;
               align-items:center;justify-content:center;font-size:${Math.round(style.size * 0.55)}px;">
               ${style.emoji}
             </span>
           </div>`,
    iconSize: [style.size, style.size],
    iconAnchor: [style.size / 2, style.size / 2],
  });
}

export default function MapCanvas({
  center,
  zoom = 14,
  markers = [],
  circle = null,
  route = null,          // GeoJSON coordinates: [[lng, lat], ...]
  onMapClick = null,
  className = 'h-[420px] w-full rounded-2xl overflow-hidden border border-slate-200',
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  // Layer groups let us clear and redraw one category without touching the
  // others - markers can change while the route stays as it is.
  const markerLayerRef = useRef(null);
  const circleLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const clickHandlerRef = useRef(onMapClick);
  clickHandlerRef.current = onMapClick;

  // --- 1. create the map, exactly once -------------------------------------
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return undefined;

    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: true,
      attributionControl: true,
    });

    // The tile layer is the actual map imagery. The attribution is not
    // decoration - OpenStreetMap's licence requires crediting it.
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    markerLayerRef.current = L.layerGroup().addTo(map);
    circleLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);

    // Reading the handler from a ref means the map is never rebuilt just
    // because the parent passed a new function identity on re-render.
    map.on('click', (e) => {
      clickHandlerRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    return () => {
      // Leaflet keeps global listeners and a reference on the DOM node. Without
      // remove() a second mount (React strict mode does exactly that in dev)
      // throws "Map container is already initialized".
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 2. follow the centre when the parent moves it ------------------------
  useEffect(() => {
    if (mapRef.current && center) mapRef.current.setView([center.lat, center.lng], zoom, { animate: true });
  }, [center?.lat, center?.lng, zoom]);

  // --- 3. redraw the markers ------------------------------------------------
  useEffect(() => {
    const layer = markerLayerRef.current;
    if (!layer) return;
    layer.clearLayers();

    for (const m of markers) {
      const marker = L.marker([m.lat, m.lng], {
        icon: buildIcon(m.kind),
        title: m.label || '',
      });
      if (m.popup) marker.bindPopup(m.popup);
      layer.addLayer(marker);
    }
  }, [markers]);

  // --- 4. redraw the search radius -----------------------------------------
  useEffect(() => {
    const layer = circleLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!circle) return;

    // L.circle takes a radius in METRES - the same unit the server's $geoNear
    // maxDistance uses, so what the user sees is exactly what was searched.
    layer.addLayer(L.circle([circle.lat, circle.lng], {
      radius: circle.radiusM,
      color: '#dc2626',
      weight: 2,
      fillColor: '#dc2626',
      fillOpacity: 0.08,
    }));
  }, [circle?.lat, circle?.lng, circle?.radiusM]);

  // --- 5. redraw the bicycle route -----------------------------------------
  useEffect(() => {
    const layer = routeLayerRef.current;
    if (!layer) return;
    layer.clearLayers();
    if (!route?.coordinates?.length) return;

    // GeoJSON stores [lng, lat]; Leaflet wants [lat, lng]. Swapping here, once,
    // is the only place in the front end that has to know about it.
    const latLngs = route.coordinates.map(([lng, lat]) => [lat, lng]);

    layer.addLayer(L.polyline(latLngs, {
      color: route.fallback ? '#94a3b8' : '#16a34a',
      weight: 5,
      opacity: 0.9,
      // A dashed grey line is our honest signal that the routing service was
      // unreachable and this is a straight line, not a real bicycle path.
      dashArray: route.fallback ? '8 10' : null,
    }));

    if (mapRef.current) {
      mapRef.current.fitBounds(L.latLngBounds(latLngs).pad(0.25));
    }
  }, [route]);

  return <div ref={containerRef} className={className} />;
}
