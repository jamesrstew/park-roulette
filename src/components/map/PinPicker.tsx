"use client";

import "leaflet/dist/leaflet.css";
import "./map.css";
import L from "leaflet";
import { useEffect, useMemo } from "react";
import {
  MapContainer,
  Marker,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import { CRAYONS, townCrayon } from "@/lib/crayons";
import type { ParkPin } from "@/lib/data-map";
import type { LatLng } from "@/lib/geo";
import { ghostPinHtml, pushPinHtml } from "./pins";

function TapToPlace({ onPick }: { onPick: (ll: LatLng) => void }) {
  useMapEvents({
    click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }),
  });
  return null;
}

/** Glide to the pin when it's moved from outside the map (e.g. "Use my location"). */
function FollowPin({ pin, flyKey }: { pin: LatLng | null; flyKey: number }) {
  const map = useMap();
  useEffect(() => {
    if (!pin || flyKey === 0) return;
    map.flyTo([pin.lat, pin.lng], Math.max(map.getZoom(), 16), {
      duration: 0.7,
    });
    // Only fly on explicit requests, not on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyKey, map]);
  return null;
}

export default function PinPicker({
  start,
  startZoom,
  pin,
  onPick,
  others,
  flyKey,
}: {
  start: LatLng;
  startZoom: number;
  pin: LatLng | null;
  onPick: (ll: LatLng) => void;
  others: ParkPin[];
  flyKey: number;
}) {
  const pushIcon = useMemo(
    () =>
      L.divIcon({
        className: "push-pin",
        html: pushPinHtml(),
        iconSize: [40, 52],
        iconAnchor: [20, 50],
      }),
    [],
  );
  const ghostIcons = useMemo(() => {
    const m = new Map<string, L.DivIcon>();
    for (const o of others)
      if (!m.has(o.city))
        m.set(
          o.city,
          L.divIcon({
            className: "park-pin",
            html: ghostPinHtml(CRAYONS[townCrayon(o.city)]),
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          }),
        );
    return m;
  }, [others]);

  return (
    <MapContainer
      center={[start.lat, start.lng]}
      zoom={startZoom}
      zoomControl={false}
      className="pr-map h-full w-full"
    >
      <TileLayer
        className="paper-tiles"
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
      />
      {others.map((o) => (
        <Marker
          key={o.id}
          position={[o.lat, o.lng]}
          icon={ghostIcons.get(o.city)!}
          interactive={false}
          keyboard={false}
        />
      ))}
      <TapToPlace onPick={onPick} />
      <FollowPin pin={pin} flyKey={flyKey} />
      {pin && (
        <Marker
          position={[pin.lat, pin.lng]}
          icon={pushIcon}
          draggable
          autoPan
          zIndexOffset={1000}
          title="Drag me to the playground"
          eventHandlers={{
            dragend: (e) => {
              const ll = (e.target as L.Marker).getLatLng();
              onPick({ lat: ll.lat, lng: ll.lng });
            },
          }}
        />
      )}
    </MapContainer>
  );
}
