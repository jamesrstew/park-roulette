import { Suspense } from "react";
import {
  EventPrefsSync,
  PrefsPaint,
  PrefsToast,
} from "@/components/events/SaveHide";
import { readSession } from "@/lib/session";

/**
 * Every /events page: the phone's saved and hidden events. On a hard
 * load the root layout's boot script (lib/events/prefs.ts BOOT) has
 * already written the hide stylesheet; on a client navigation PrefsPaint
 * writes it before the page paints, so hidden cards never flash. The only
 * per-request read is whether a session cookie is here (no database),
 * inside Suspense; the family's list itself loads in the browser.
 */
export default function EventsLayout({ children }: LayoutProps<"/events">) {
  return (
    <>
      <PrefsPaint />
      {children}
      <PrefsToast />
      <Suspense fallback={null}>
        <Sync />
      </Suspense>
    </>
  );
}

async function Sync() {
  return <EventPrefsSync signedIn={!!(await readSession())} />;
}
