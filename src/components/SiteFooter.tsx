import { connection } from "next/server";
import Link from "next/link";
import { EmailSignup } from "@/components/ParkNews";
import { FooterGate, FooterNavLink } from "@/components/FooterGate";
import { FooterTexts } from "@/components/FooterTexts";
import { TextsLink } from "@/components/news/TextsLink";
import { CONTACT } from "@/components/legal/Legal";
import { Icon } from "@/components/icons";
import { getMe, type Me, phoneFresh } from "@/lib/data";
import { emailStoppedFor, subscriptionFor } from "@/lib/news/subscribers";
import { textsAvailable } from "@/lib/signup-core";
import { type FooterFacts, footerSignup } from "@/lib/footer-signup";
import { readOn } from "@/lib/on-cookie";
import { NEWS_NAME, PARK_NEWS } from "@/lib/park-news";
import { TEXTS_COPY } from "@/lib/texts";
import {
  confirmationsEnabled,
  textedStop,
  textsOn as textsOnFor,
} from "@/lib/texts-store";

const STRIPE = [
  "#e5432f",
  "#f58a2c",
  "#f7c933",
  "#3aa35b",
  "#2f78d4",
  "#8a5cc6",
];

/** The account's truth signed in; this browser's pr_on cookie signed out. */
async function footerFacts(me: Me | null): Promise<FooterFacts> {
  if (me?.isKid)
    return {
      kid: true,
      emailOn: false,
      textsOn: false,
      tapOK: false,
      phone: null,
    };
  if (!me) {
    const here = await readOn();
    return {
      kid: false,
      emailOn: here.email,
      textsOn: here.texts,
      tapOK: false,
      phone: null,
    };
  }
  const [sub, on, fresh, available, stoppedEmail, stoppedTexts] =
    await Promise.all([
      subscriptionFor(me.id),
      me.phone ? textsOnFor(me.phone) : false,
      me.phone && me.trusted ? phoneFresh(me.id) : false,
      textsAvailable().catch(() => false),
      emailStoppedFor(me.id),
      me.phone ? textedStop(me.phone) : false,
    ]);
  const emailOn = sub.status !== "off";
  return {
    kid: false,
    signedIn: true,
    emailOn,
    textsOn: on,
    // The same gate as the asks: texts really going out.
    tapOK: me.trusted && !!me.phone && fresh && available,
    phone: me.phone,
    emailNo: !emailOn && stoppedEmail,
    textsNo: !on && stoppedTexts,
  };
}

/**
 * The site footer, on reading pages only (FooterGate holds the list): the
 * weekly email signup and the Weekend Pick, a few links, and who runs it.
 * It hides what this person already gets (the account, or the pr_on cookie
 * signed out), and shows nothing to sign up for when they get both. Kids
 * never see the field. The signup block drops on /newsletter and /texts,
 * which have their own. Never on the wheel (James's rule).
 */
export async function SiteFooter() {
  await connection(); // the date and time matter here
  const me = await getMe();
  const signedOut = !me;
  const facts = await footerFacts(me);
  const show = footerSignup(facts);
  const anySignup = show.email || !!show.texts || show.manage;
  const footer = (showSignup: boolean) => (
    <footer className="mt-14 flex flex-col gap-6" aria-labelledby="footer-h">
      <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full">
        {STRIPE.map((c) => (
          <span key={c} className="flex-1" style={{ backgroundColor: c }} />
        ))}
      </div>
      {showSignup && anySignup ? (
        <section className="flex flex-col gap-2">
          {show.email ? (
            <>
              <h2 id="footer-h" className="font-hand text-3xl leading-tight">
                {NEWS_NAME}
              </h2>
              <p className="leading-snug">
                {PARK_NEWS.tagline} {PARK_NEWS.cadence}
              </p>
              <EmailSignup source="footer" inline />
            </>
          ) : (
            <h2 id="footer-h" className="sr-only">
              {NEWS_NAME}
            </h2>
          )}
          {show.texts === "card_rather" || show.texts === "card_too" ? (
            <FooterTexts
              number={facts.phone!}
              state={show.texts === "card_too" ? "too" : "rather"}
              confirmationsOn={confirmationsEnabled()}
            />
          ) : show.texts === "link" ? (
            <TextsLink />
          ) : show.texts === "link_too" ? (
            <p className="flex min-h-11 items-center gap-2 leading-snug">
              <Icon
                name="phone"
                size={26}
                className="shrink-0 text-crayon-green"
              />
              <Link href="/texts" className="underline underline-offset-2">
                {TEXTS_COPY.footerTooLink}
              </Link>
            </p>
          ) : null}
          {show.manage ? (
            <p className="flex min-h-11 items-center text-sm text-ink-soft">
              <Link href="/me#park-picks-h" className="underline">
                Manage your park picks
              </Link>
            </p>
          ) : null}
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
  return (
    <FooterGate
      who={me ? `${me.id}:${me.trusted ? 1 : 0}` : ""}
      full={footer(true)}
      bare={footer(false)}
    />
  );
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
