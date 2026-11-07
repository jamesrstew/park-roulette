"use client";

import { createLeafletContext, LeafletContext } from "@react-leaflet/core";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import type { LatLng } from "@/lib/geo";

type View = { center: LatLng; zoom: number };

/**
 * A react-leaflet map container that survives being hidden and shown.
 *
 * Next 16 (Cache Components) keeps the last few pages alive in React's
 * <Activity>: leaving the Map tab hides it, which runs effect cleanups, and
 * coming back runs the effects again. react-leaflet's MapContainer builds its
 * Leaflet map only once (in a ref callback) but removes it in an effect
 * cleanup, so after a quick Map → List → Map its layers attach to a dead map
 * and the page crashes ("Map container is being reused by another instance").
 *
 * Here the map lives exactly as long as the effect: made when the page is
 * shown, removed when it's hidden, and put back where you left it.
 */
export function LiveMap({
  center,
  zoom,
  className,
  children,
  options,
}: {
  center: LatLng;
  zoom: number;
  className?: string;
  children: React.ReactNode;
  options?: L.MapOptions;
}) {
  const el = useRef<HTMLDivElement>(null);
  const [context, setContext] = useState<ReturnType<
    typeof createLeafletContext
  > | null>(null);
  // Where to open: the first center/zoom, then wherever they last left it.
  const view = useRef<View>({ center, zoom });
  const opts = useRef(options);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    const map = new L.Map(node, opts.current);
    map.setView(
      [view.current.center.lat, view.current.center.lng],
      view.current.zoom,
      {
        animate: false,
      },
    );
    setContext(createLeafletContext(map));
    return () => {
      const c = map.getCenter();
      view.current = {
        center: { lat: c.lat, lng: c.lng },
        zoom: map.getZoom(),
      };
      setContext(null); // children (layers) go with the map
      map.remove();
    };
  }, []);

  return (
    <div ref={el} className={className}>
      {context ? (
        <LeafletContext value={context}>{children}</LeafletContext>
      ) : null}
    </div>
  );
}
