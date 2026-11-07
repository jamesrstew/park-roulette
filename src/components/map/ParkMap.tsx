"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";
import L from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkSummary } from "@/lib/data";
import type { LatLng } from "@/lib/geo";
import { clusterPinHtml, dotPinHtml, mePinHtml, starPinHtml } from "./pins";

/** Central Oregon, roughly centered on Bend/Redmond. */
export const CENTRAL_OREGON: LatLng = { lat: 44.2, lng: -121.25 };
/** At this zoom and closer, every pin stands on its own. */
const NO_CLUSTER_ZOOM = 15;
/** Pins closer than this many pixels get bunched together. */
const CLUSTER_PX = 46;
/** Crossed-off parks only show up once you're zoomed in a bit. */
const CROSSED_MIN_ZOOM = 12;

export type MapPadding = { top: number; bottom: number };

export type ParkMapHandle = {
  locate: (here: LatLng) => void;
  center: () => LatLng | null;
};

type Cluster = {
  key: string;
  lat: number;
  lng: number;
  parks: ParkSummary[];
};

function clusterParks(map: L.Map, parks: ParkSummary[], zoom: number) {
  if (zoom >= NO_CLUSTER_ZOOM)
    return parks.map((p) => ({ key: `p${p.id}`, ...p, parks: [p] }));
  const groups: { x: number; y: number; parks: ParkSummary[] }[] = [];
  for (const p of parks) {
    const pt = map.project([p.lat, p.lng], zoom);
    const g = groups.find(
      (g) => Math.hypot(g.x - pt.x, g.y - pt.y) < CLUSTER_PX,
    );
    if (g) {
      g.parks.push(p);
      // Keep the group's anchor at its running centroid.
      g.x += (pt.x - g.x) / g.parks.length;
      g.y += (pt.y - g.y) / g.parks.length;
    } else groups.push({ x: pt.x, y: pt.y, parks: [p] });
  }
  return groups.map((g): Cluster => {
    const ll = map.unproject([g.x, g.y], zoom);
    return {
      key: g.parks
        .map((p) => p.id)
        .sort((a, b) => a - b)
        .join("-"),
      lat: ll.lat,
      lng: ll.lng,
      parks: g.parks,
    };
  });
}

function boundsOf(parks: { lat: number; lng: number }[]) {
  return L.latLngBounds(parks.map((p) => [p.lat, p.lng] as [number, number]));
}

let crossedIconCache: L.DivIcon | null = null;
function crossedIcon() {
  return (crossedIconCache ??= L.divIcon({
    className: "park-pin",
    html: `<div class="pin-hit" style="width:32px;height:32px"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><g filter="url(#wobble)" stroke="#5d5a6b" stroke-width="3.2" stroke-linecap="round" opacity=".7"><path d="M5 5 L19 19"/><path d="M19 5 L5 19"/></g></svg></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  }));
}

function Pins({
  parks,
  crossed,
  selectedId,
  onSelect,
  padding,
}: {
  parks: ParkSummary[];
  crossed: ParkSummary[];
  selectedId: number | null;
  onSelect: (p: ParkSummary | null) => void;
  padding: MapPadding;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(() => map.getZoom());

  useEffect(() => {
    const onZoom = () => setZoom(map.getZoom());
    const onClick = () => onSelect(null);
    map.on("zoomend", onZoom);
    map.on("click", onClick);
    return () => {
      map.off("zoomend", onZoom);
      map.off("click", onClick);
    };
  }, [map, onSelect]);

  const clusters = useMemo(
    () => clusterParks(map, parks, zoom),
    [map, parks, zoom],
  );

  function openCluster(c: Cluster) {
    const b = boundsOf(c.parks);
    const tiny = b.getNorthEast().distanceTo(b.getSouthWest()) < 60;
    if (tiny) map.flyTo(b.getCenter(), NO_CLUSTER_ZOOM + 1, { duration: 0.6 });
    else
      map.flyToBounds(b, {
        paddingTopLeft: [40, padding.top + 20],
        paddingBottomRight: [40, padding.bottom + 20],
        maxZoom: NO_CLUSTER_ZOOM + 1,
        duration: 0.6,
      });
  }

  return (
    <>
      {zoom >= CROSSED_MIN_ZOOM &&
        crossed.map((p) => (
          <Marker
            key={`x${p.id}`}
            position={[p.lat, p.lng]}
            icon={crossedIcon()}
            zIndexOffset={-500}
            title={`${p.name} (crossed off)`}
            eventHandlers={{ click: () => onSelect(p) }}
          />
        ))}
      {clusters.map((c) => {
        if (c.parks.length === 1) {
          const p = c.parks[0];
          return (
            <ParkPin
              key={c.key}
              park={p}
              selected={p.id === selectedId}
              onSelect={onSelect}
            />
          );
        }
        const towns = [...new Set(c.parks.map((p) => p.city))];
        const visited = c.parks.filter((p) => p.lastVisit).length;
        const color =
          towns.length === 1 ? CRAYONS[townCrayon(towns[0])] : CRAYONS.purple;
        const icon = L.divIcon({
          className: "park-pin",
          html: clusterPinHtml({
            count: c.parks.length,
            visited,
            color,
            label: towns.length === 1 ? towns[0] : null,
          }),
          iconSize: [64, 64],
          iconAnchor: [32, 32],
        });
        return (
          <Marker
            key={c.key}
            position={[c.lat, c.lng]}
            icon={icon}
            title={`${c.parks.length} parks`}
            eventHandlers={{ click: () => openCluster(c) }}
          />
        );
      })}
    </>
  );
}

function ParkPin({
  park,
  selected,
  onSelect,
}: {
  park: ParkSummary;
  selected: boolean;
  onSelect: (p: ParkSummary) => void;
}) {
  const visited = !!park.lastVisit;
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "park-pin",
        html: visited
          ? starPinHtml(selected)
          : dotPinHtml(CRAYONS[townCrayon(park.city)], selected),
        iconSize: [44, 44],
        iconAnchor: [22, 22],
      }),
    [visited, selected, park.city],
  );
  return (
    <Marker
      position={[park.lat, park.lng]}
      icon={icon}
      title={park.name}
      zIndexOffset={selected ? 1000 : visited ? 100 : 0}
      keyboard
      eventHandlers={{ click: () => onSelect(park) }}
    />
  );
}

/** Fit to the parks on load, and again whenever the filter (fitKey) changes. */
function FitToParks({
  parks,
  padding,
  fitKey,
}: {
  parks: { lat: number; lng: number }[];
  padding: MapPadding;
  fitKey: string;
}) {
  const map = useMap();
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (fitted.current === fitKey || parks.length === 0) return;
    const first = fitted.current == null;
    fitted.current = fitKey;
    const opts = { animate: !first, duration: 0.6 };
    if (parks.length === 1) {
      map.setView([parks[0].lat, parks[0].lng], 14, opts);
      return;
    }
    map.fitBounds(boundsOf(parks), {
      paddingTopLeft: [28, padding.top],
      paddingBottomRight: [28, padding.bottom],
      maxZoom: 14,
      ...opts,
    });
  }, [map, parks, padding, fitKey]);
  return null;
}

/** Keep the selected pin visible above the bottom sheet. */
function FollowSelected({
  selected,
  sheetHeight,
}: {
  selected: ParkSummary | null;
  sheetHeight: number;
}) {
  const map = useMap();
  useEffect(() => {
    if (!selected) return;
    const size = map.getSize();
    const pt = map.latLngToContainerPoint([selected.lat, selected.lng]);
    // The header shrinks to ~110px while a sheet is open.
    const top = 120;
    const bottom = size.y - (sheetHeight || 300);
    const wantY = bottom > top + 60 ? (top + bottom) / 2 : top + 30;
    const inView =
      pt.y > top + 20 && pt.y < bottom - 24 && pt.x > 30 && pt.x < size.x - 30;
    if (inView) return;
    map.panBy([pt.x - size.x / 2, pt.y - wantY], { duration: 0.4 });
  }, [map, selected, sheetHeight]);
  return null;
}

function Locator({
  here,
  onReady,
}: {
  here: LatLng | null;
  onReady: (h: ParkMapHandle) => void;
}) {
  const map = useMap();
  useEffect(() => {
    onReady({
      locate: (h) => map.flyTo([h.lat, h.lng], 14, { duration: 0.8 }),
      center: () => {
        const c = map.getCenter();
        return { lat: c.lat, lng: c.lng };
      },
    });
  }, [map, onReady]);
  const icon = useMemo(
    () =>
      L.divIcon({
        className: "me-pin",
        html: mePinHtml(),
        iconSize: [40, 40],
        iconAnchor: [20, 20],
      }),
    [],
  );
  if (!here) return null;
  return (
    <Marker
      position={[here.lat, here.lng]}
      icon={icon}
      interactive={false}
      zIndexOffset={2000}
    />
  );
}

export default function ParkMap({
  parks,
  crossed,
  selectedId,
  onSelect,
  here,
  padding,
  sheetHeight,
  onReady,
  fitKey,
}: {
  parks: ParkSummary[];
  crossed: ParkSummary[];
  selectedId: number | null;
  onSelect: (p: ParkSummary | null) => void;
  here: LatLng | null;
  padding: MapPadding;
  sheetHeight: number;
  onReady: (h: ParkMapHandle) => void;
  /** Change this to re-fit the map to the parks (e.g. a new filter). */
  fitKey: string;
}) {
  const selected =
    parks.find((p) => p.id === selectedId) ??
    crossed.find((p) => p.id === selectedId) ??
    null;
  const all = useMemo(() => [...parks, ...crossed], [parks, crossed]);
  return (
    <MapContainer
      center={[CENTRAL_OREGON.lat, CENTRAL_OREGON.lng]}
      zoom={10}
      zoomControl={false}
      className="pr-map pr-map-full h-full w-full"
      attributionControl
    >
      <TileLayer
        className="paper-tiles"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      <FitToParks parks={all} padding={padding} fitKey={fitKey} />
      <Pins
        parks={parks}
        crossed={crossed}
        selectedId={selectedId}
        onSelect={onSelect}
        padding={padding}
      />
      <FollowSelected selected={selected} sheetHeight={sheetHeight} />
      <Locator here={here} onReady={onReady} />
    </MapContainer>
  );
}
