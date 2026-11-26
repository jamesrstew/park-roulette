import Link from "next/link";
import { Icon } from "@/components/icons";
import { pairingGuidePath } from "@/lib/pairing-guides";
import { parkGuideLinks } from "@/lib/pairing-guides-data";
import { pairingPagePath } from "@/lib/pairing-pages";
import { pagesForPark } from "@/lib/pairing-pages-data";

/**
 * On a park's page: "Nearby: coffee, bakeries", linking the park pairings
 * guides this park is in (only those that exist now). Nothing otherwise.
 */
export async function PairingNearby({ slug }: { slug: string }) {
  const [guides, pages] = await Promise.all([
    parkGuideLinks(slug, new Date()),
    pagesForPark(slug, new Date()).catch(() => []),
  ]);
  // The theme guides, then the newest two pairing pages it's in.
  const links = [
    ...guides.map((g) => ({ href: pairingGuidePath(g.slug), name: g.name })),
    ...pages
      .slice(0, 2)
      .map((v) => ({ href: pairingPagePath(v.slug), name: v.name })),
  ];
  if (!links.length) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <Icon name="cup" size={20} />
      <span className="text-ink-soft">Nearby:</span>
      {links.map((l, i) => (
        <span key={l.href}>
          <Link href={l.href} className="underline">
            {l.name}
          </Link>
          {i < links.length - 1 ? "," : ""}
        </span>
      ))}
    </p>
  );
}
