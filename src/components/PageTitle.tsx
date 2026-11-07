import type { ReactNode } from "react";
import { CRAYONS, type CrayonName } from "@/lib/crayons";
import { Underline } from "./Scribbles";

/**
 * The tab title style: big Gochi Hand, one crayon-colored word, a scribbled
 * underline in a second crayon, and a handwritten subtitle.
 *
 *   <PageTitle lead="The" accent="Bucket List" color="blue" underline="green" />
 */
export function PageTitle({
  lead,
  accent,
  trail,
  color,
  underline,
  underlineWidth = "w-52",
  subtitle,
  size = "text-5xl",
  align = "center",
}: {
  lead?: ReactNode;
  accent: ReactNode;
  trail?: ReactNode;
  color: CrayonName;
  underline: CrayonName;
  underlineWidth?: string;
  subtitle?: ReactNode;
  size?: string;
  align?: "center" | "left";
}) {
  const center = align === "center";
  return (
    <header className={`pt-2 ${center ? "text-center" : ""}`}>
      <h1 className={`${size} text-balance`}>
        {lead ? <>{lead} </> : null}
        <span style={{ color: CRAYONS[color] }}>{accent}</span>
        {trail}
      </h1>
      <Underline
        className={`-mt-1 h-4 ${underlineWidth} ${center ? "mx-auto" : ""}`}
        color={CRAYONS[underline]}
      />
      {subtitle ? (
        <div className="mt-1 font-hand text-xl text-ink-soft">{subtitle}</div>
      ) : null}
    </header>
  );
}
