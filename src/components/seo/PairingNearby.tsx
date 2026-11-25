import Link from "next/link";
import { Icon } from "@/components/icons";
import { pairingGuidePath } from "@/lib/pairing-guides";
import { parkGuideLinks } from "@/lib/pairing-guides-data";

/**
 * On a park's page: "Nearby: coffee, bakeries", linking the park pairings
 * guides this park is in (only those that exist now). Nothing otherwise.
 */
export async function PairingNearby({ slug }: { slug: string }) {
  const links = await parkGuideLinks(slug, new Date());
  if (!links.length) return null;
  return (
    <p className="mt-4 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      <Icon name="cup" size={20} />
      <span className="text-ink-soft">Nearby:</span>
      {links.map((l, i) => (
        <span key={l.slug}>
          <Link href={pairingGuidePath(l.slug)} className="underline">
            {l.name}
          </Link>
          {i < links.length - 1 ? "," : ""}
        </span>
      ))}
    </p>
  );
}
