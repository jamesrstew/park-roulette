/**
 * The site footer's signup block (batch 6): it hides what this visitor
 * already gets. Pure, so the table is tested (components/SiteFooter.tsx
 * reads the facts).
 */

/** What this visitor already gets, and whether texts are one card away. */
export type FooterFacts = {
  kid: boolean;
  emailOn: boolean;
  textsOn: boolean;
  /**
   * A trusted grown-up whose number passed a code in the last 30 days, and
   * a texts number: the Weekend Pick card (an unchecked box, then the
   * button) instead of a link to /texts.
   */
  tapOK: boolean;
  phone: string | null;
  /** Signed in (the "Manage" link goes to Family & settings). */
  signedIn?: boolean;
  /** This account stopped the email, or this number texted STOP: a no. */
  emailNo?: boolean;
  textsNo?: boolean;
};

/**
 * What the footer's signup block shows (batch 6's table). A "no" (a
 * stopped email, a number on the STOP list) hides that offer like a yes.
 */
export function footerSignup(f: FooterFacts): {
  email: boolean;
  texts: "card_rather" | "card_too" | "link" | "link_too" | null;
  /** A small "Manage" link for a signed-in subscriber. */
  manage: boolean;
} {
  const manage = !f.kid && !!f.signedIn && (f.emailOn || f.textsOn);
  const emailHide = f.emailOn || !!f.emailNo;
  const textsHide = f.textsOn || !!f.textsNo;
  if (f.kid) return { email: false, texts: null, manage: false };
  return {
    email: !emailHide,
    texts: textsHide
      ? null
      : f.tapOK
        ? f.emailOn
          ? "card_too"
          : "card_rather"
        : f.emailOn
          ? "link_too"
          : "link",
    manage,
  };
}
