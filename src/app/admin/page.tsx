import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AdminQueue } from "@/components/admin/AdminQueue";
import { CrayonLoading } from "@/components/Loading";
import { getMe } from "@/lib/data";
import { getAdminQueue } from "@/lib/data-admin";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

async function Admin() {
  const me = await getMe();
  const queue = me ? await getAdminQueue(me) : null;
  if (!queue) notFound();
  return <AdminQueue queue={queue} />;
}

export default function AdminPage() {
  return (
    <Suspense fallback={<CrayonLoading label="Checking the mailbox…" />}>
      <Admin />
    </Suspense>
  );
}
