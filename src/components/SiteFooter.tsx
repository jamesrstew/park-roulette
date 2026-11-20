import { connection } from "next/server";
import Link from "next/link";
import { EmailSignup } from "@/components/ParkNews";
import { FooterGate, FooterNavLink } from "@/components/FooterGate";
import { TextsLink } from "@/components/news/TextsLink";
import { CONTACT } from "@/components/legal/Legal";
import { getMe } from "@/lib/data";
import { subscriptionFor } from "@/lib/news/subscribers";
import { NEWS_NAME, PARK_NEWS } from "@/lib/park-news";

const STRIPE = [
  "#e5432f",
  "#f58a2c",
  "#f7c933",
  "#3aa35b",
  "#2f78d4",
  "#8a5cc6",
];

/**
 * The site footer, on reading pages only (FooterGate holds the list): the
 * weekly email signup, the texts link, a few links, and who runs it.
 * Signed-in subscribers see "Manage" instead of the field; kids never see
 * the field. The signup block drops on /newsletter and /texts, which have
 * their own.
 */
export async function SiteFooter() {
  await connection(); // the date and time matter here
  const me = await getMe();
  const signedOut = !me;
  const sub = me && !me.isKid ? await subscriptionFor(me.id) : null;
  const footer = (showSignup: boolean) => (
    <footer className="mt-14 flex flex-col gap-6" aria-labelledby="footer-h">
      <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full">
        {STRIPE.map((c) => (
          <span key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      {showSignup && !me?.isKid ? (
        <section className="flex flex-col gap-2">
          <h2 id="footer-h" className="font-hand text-3xl leading-tight">
            {NEWS_NAME}
          </h2>
          <p className="leading-snug">
            {PARK_NEWS.tagline} {PARK_NEWS.cadence}
          </p>
          {sub?.status === "on" ? (
            <p className="leading-snug">
              You get it every Thursday.{" "}
              <Link href="/me" className="underline">
                Manage
              </Link>
            </p>
          ) : (
            <EmailSignup source="footer" inline />
          )}
          <TextsLink />
        </section>
      ) : (
        <h2 id="footer-h" className="sr-only">
          {NEWS_NAME}
        </h2>
      )}
      <nav aria-label="Footer" className="grid grid-cols-2 gap-4">
        <div>
          <h3 className="font-hand text-xl text-ink-soft">Explore</h3>
          <ul>
            <FooterLink href="/list">Every playground</FooterLink>
            <FooterLink href="/towns">Playgrounds by town</FooterLink>
            <li>
              <FooterNavLink href="/events">Kids&apos; events</FooterNavLink>
            </li>
            {signedOut ? (
              <FooterLink href="/start">Start your family</FooterLink>
            ) : null}
          </ul>
        </div>
        <div>
          <h3 className="font-hand text-xl text-ink-soft">Stay in touch</h3>
          <ul>
            <FooterLink href="/newsletter">Past issues</FooterLink>
            <FooterLink href="/texts">Weekend Pick</FooterLink>
            <FooterLink href={`mailto:${CONTACT}`}>Email us</FooterLink>
          </ul>
        </div>
      </nav>
      <p className="flex gap-6">
        <Link href="/terms" className="flex min-h-11 items-center underline">
          Terms
        </Link>
        <Link href="/privacy" className="flex min-h-11 items-center underline">
          Privacy
        </Link>
      </p>
      <p className="border-t border-dashed border-ink/25 pt-3 text-sm leading-snug text-ink-soft">
        Park Roulette is a free game for Central Oregon families. No ads, and we
        never sell your info. Made in Oregon by True Craft Ventures LLC. ©{" "}
        {new Date().getFullYear()}
      </p>
    </footer>
  );
  return <FooterGate full={footer(true)} bare={footer(false)} />;
}

function FooterLink({ href, children }: { href: string; children: string }) {
  const cls = "flex min-h-11 items-center";
  return (
    <li>
      {href.startsWith("mailto:") ? (
        <a href={href} className={cls}>
          {children}
        </a>
      ) : (
        <Link href={href} className={cls}>
          {children}
        </Link>
      )}
    </li>
  );
}
