import Link from "next/link";
import { Icon } from "@/components/icons";

/** "Rather get a text? Weekend Pick, on Fridays", the same words everywhere. */
export function TextsLink({ lead = "Rather get a text?" }: { lead?: string }) {
  return (
    <p className="flex min-h-11 items-center gap-2 leading-snug">
      <Icon name="phone" size={26} className="shrink-0 text-crayon-green" />
      <span>
        {lead}{" "}
        <Link href="/texts" className="underline underline-offset-2">
          Weekend Pick, on Fridays
        </Link>
      </span>
    </p>
  );
}
