import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminQueue } from "@/components/admin/AdminQueue";
import { CrayonLoading } from "@/components/Loading";
import { getMe } from "@/lib/data";
import { AdminStats } from "@/components/admin/AdminStats";
import { getAdminQueue, getAdminStats } from "@/lib/data-admin";
import { LIMITS } from "@/lib/sms";
import { AdminNews } from "@/components/admin/AdminNews";
import { newsAdmin } from "@/lib/news/data";
import { AdminEvents } from "@/components/admin/AdminEvents";
import { adminEvents, recentEventEdits } from "@/lib/events/store";
import { socialAdmin } from "@/lib/social/settings";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

async function Admin() {
  const me = await getMe();
  const queue = me ? await getAdminQueue(me) : null;
  if (!queue) notFound();
  const [stats, news, events, edits, social] = await Promise.all([
    getAdminStats(),
    newsAdmin(),
    adminEvents(),
    recentEventEdits(),
    socialAdmin(),
  ]);
  return (
    <div className="flex flex-col gap-8">
      <AdminQueue queue={queue} />
      <AdminStats
        stats={stats}
        budgets={{ known: LIMITS.knownPerDay, unknown: LIMITS.unknownPerDay }}
      />
      <AdminNews {...news} social={social} />
      <AdminEvents
        events={events}
        edits={edits.map((x) => ({
          id: x.id,
          slug: x.slug,
          action: x.action,
          at: x.createdAt.toISOString().slice(0, 16).replace("T", " "),
          by: x.byExplorerId,
          what: editSummary(x.action, x.detail),
        }))}
      />
    </div>
  );
}

/** One line for a logged repair. */
function editSummary(action: string, detail: unknown): string {
  const d = detail as {
    removed?: { day: string }[];
    moved?: { day: string }[];
    to?: { slug: string };
    reason?: string;
  };
  if (action === "trim") return `${d.removed?.length ?? 0} dates taken off`;
  if (action === "split")
    return `${d.moved?.length ?? 0} dates moved to ${d.to?.slug ?? "?"}`;
  return d.reason ?? "removed";
}

export default function AdminPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Checking the mailbox…" />}>
      <Admin />
    </Suspense>
  );
}
