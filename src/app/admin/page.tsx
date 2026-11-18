import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminQueue } from "@/components/admin/AdminQueue";
import { CrayonLoading } from "@/components/Loading";
import { getMe } from "@/lib/data";
import { AdminStats } from "@/components/admin/AdminStats";
import { getAdminQueue, getAdminStats } from "@/lib/data-admin";
import { LIMITS } from "@/lib/sms";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

async function Admin() {
  const me = await getMe();
  const queue = me ? await getAdminQueue(me) : null;
  if (!queue) notFound();
  const stats = await getAdminStats();
  return (
    <div className="flex flex-col gap-8">
      <AdminQueue queue={queue} />
      <AdminStats
        stats={stats}
        budgets={{ known: LIMITS.knownPerDay, unknown: LIMITS.unknownPerDay }}
      />
    </div>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Checking the mailbox…" />}>
      <Admin />
    </Suspense>
  );
}
