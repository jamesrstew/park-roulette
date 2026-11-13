import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Mail, OPERATOR, Section } from "@/components/legal/Legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The rules for playing Park Roulette.",
};

export default function TermsPage() {
  return (
    <LegalPage
      lead="Terms of"
      accent="Service"
      intro={
        <>
          <p>
            <b>The short version.</b> Park Roulette is a free game for grown-ups
            and their families. Be kind and honest, only post photos you have
            the right to share, and watch your kids at the park. Park info comes
            from people and maps and can be wrong, so look before you play.
          </p>
          <p>
            These terms are an agreement between you and {OPERATOR}, an Oregon
            limited liability company (&ldquo;we&rdquo; or &ldquo;us&rdquo;). By
            using Park Roulette, you agree to them and to our{" "}
            <Link href="/privacy" className="underline">
              Privacy Policy
            </Link>
            . If you don&apos;t agree, please don&apos;t use Park Roulette.
          </p>
        </>
      }
    >
      <Section title="1. Who can play">
        <p>
          You must be at least 18 to have a grown-up account, start a family or
          join one as a grown-up. Anyone under 18 plays only as a kid inside a
          grown-up&apos;s family. One person per grown-up account, please, and
          don&apos;t pretend to be someone else.
        </p>
        <p>
          Kids can color in stars and tap ready-made stickers. They can&apos;t
          write words, add photos or videos, send reports or suggest park fixes.
          You&apos;re responsible for the kids you add and for everything done
          in your family, including what your kids do on your phone.
        </p>
      </Section>

      <Section title="2. Your family and your family link">
        <p>
          Every family has a family link. Anyone who has it can see your
          family&apos;s name and who&apos;s in it, join your family, and switch
          to any family member who doesn&apos;t have a phone number. Family
          members with a number need a texted code. So share your family link
          only with your own family, and add your number to your grown-up
          profile. If your link gets out, email <Mail /> and we&apos;ll help.
        </p>
        <p>
          Keep your phone and your codes to yourself. You&apos;re responsible
          for what happens when someone uses your phone, your codes or your
          family link.
        </p>
      </Section>

      <Section title="3. Signing in by text">
        <p>
          When you add your number or sign in, we text you a one-time code
          through our texting provider, Twilio. By entering your number, you
          agree to get these texts. Here&apos;s how they work:
        </p>
        <ul>
          <li>
            <b>What we send:</b> sign-in codes only. Never marketing, never ads.
          </li>
          <li>
            <b>How often:</b> one text each time you ask for a code.
          </li>
          <li>
            <b>Cost:</b> Message and data rates may apply.
          </li>
          <li>
            <b>Help:</b> reply HELP to a code text, or email <Mail />.
          </li>
          <li>
            <b>Stopping:</b> reply STOP to stop texts. You won&apos;t be able to
            sign in by text until you reply START. You can also remove your
            number in Family &amp; settings.
          </li>
          <li>
            <b>Which phones:</b> US mobile numbers only.
          </li>
          <li>
            Carriers aren&apos;t liable for delayed or undelivered messages.
          </li>
          <li>
            We don&apos;t share your mobile number or your agreement to get
            texts with anyone for their marketing.
          </li>
        </ul>
      </Section>

      <Section title="4. What you post">
        <p>
          Reviews, photos, videos, park info and anything else you add stay
          yours. You give {OPERATOR} a free, non-exclusive, worldwide license to
          store, copy, resize, re-encode, display and share them in Park
          Roulette, with the people your settings allow, so the game can work.
        </p>
        <p>
          The license ends when you delete the content, except for backup copies
          until they roll off and copies other people already saved or
          screenshotted. Parks you add and park facts you help fix (like
          &ldquo;the splash pad is gone&rdquo;) become part of the shared park
          list and stay after you leave, without your name.
        </p>
      </Section>

      <Section title="5. Posting rules">
        <p>When you post on Park Roulette, you promise that:</p>
        <ul>
          <li>
            it&apos;s honest and based on your own visits, with no fake reviews
            and no reviews of a place you run or are paid to promote;
          </li>
          <li>
            any kids in it are your own, or their grown-ups said it&apos;s okay;
          </li>
          <li>it never shows a child undressed, in the bath or changing;</li>
          <li>
            it never includes a kid&apos;s full name, school, home address or
            anything else that tells strangers how to find them;
          </li>
          <li>
            it isn&apos;t hateful, harassing, threatening, sexual, violent,
            illegal, spam or advertising;
          </li>
          <li>
            it doesn&apos;t break anyone else&apos;s rights, like copyright or
            privacy, and you have the right to post it.
          </li>
        </ul>
        <p>
          And please don&apos;t use Park Roulette to keep tabs on other
          families, collect their information, scrape the site, run up texting
          costs, or get around our limits and safety features.
        </p>
      </Section>

      <Section title="6. Reports and removal">
        <p>
          If something worries you, use the Report button on a review or email{" "}
          <Mail />. A report that a review shows your child hides it right away.
          Other reports hide a review once a second family agrees. Either way
          our admins look at the review and its photos to decide what to do.
          While a review is hidden, its writer can still edit it, or email{" "}
          <Mail /> and we&apos;ll delete it.
        </p>
        <p>
          We don&apos;t check everything before it&apos;s posted, and other
          families&apos; posts are their own, not ours. But we may hide or
          remove any content, undo park changes, and suspend or close accounts
          or families that break these terms or make Park Roulette less safe or
          fun. We decide this using our own judgment, and we may not always warn
          you first.
        </p>
      </Section>

      <Section title="7. Park info is a community guess">
        <p>
          Park details come from public maps and from families like yours. Most
          changes need two families to agree, but parks still change, close, get
          new equipment or have hazards nobody reported. The wheel picks parks
          at random. A spin, a star rating or a sticker isn&apos;t a promise
          that a park is open, safe, clean, accessible, suitable for your kids
          or the right place to go today.
        </p>
      </Section>

      <Section title="8. Playing safe">
        <p>
          We don&apos;t own, run, maintain or inspect any park. Playgrounds and
          parks come with real risks: falls, broken or hot equipment, water,
          traffic, weather, wildlife, other people and more. You&apos;re
          responsible for deciding where to go and how to get there, checking
          conditions when you arrive, following posted rules, and supervising
          your kids at all times.
        </p>
        <p>
          You visit parks at your own risk. To the fullest extent the law
          allows, you take on those risks and release {OPERATOR} and its owners
          from claims for injuries, losses or damage that happen at a park or on
          the way to or from one. This release doesn&apos;t cover our gross
          negligence or willful misconduct.
        </p>
      </Section>

      <Section title="9. Copyright complaints">
        <p>
          We respect copyright and follow the Digital Millennium Copyright Act.
          If you think something on Park Roulette infringes your copyright,
          email <Mail /> with:
        </p>
        <ul>
          <li>the work you think was copied;</li>
          <li>
            where it appears on Park Roulette (a link, or enough detail to find
            it);
          </li>
          <li>your name, address, phone number and email;</li>
          <li>
            a statement that you believe in good faith the use isn&apos;t
            authorized by the owner, its agent or the law;
          </li>
          <li>
            a statement, under penalty of perjury, that your notice is accurate
            and that you&apos;re the owner or authorized to act for them;
          </li>
          <li>your physical or electronic signature.</li>
        </ul>
        <p>
          We&apos;ll remove or disable material that appears to infringe. If we
          remove something you posted and you think it was a mistake, you can
          send a counter-notice to the same address. In appropriate cases, we
          close the accounts of people who repeatedly infringe.
        </p>
      </Section>

      <Section title="10. It's free, and it's as-is">
        <p>
          Park Roulette is free and provided &ldquo;as is&rdquo; and &ldquo;as
          available.&rdquo; To the fullest extent the law allows, we make no
          warranties of any kind, express or implied, including that it&apos;s
          accurate, safe, always available, bug-free, or fit for any particular
          purpose. We can change, pause or stop any part of Park Roulette at any
          time.
        </p>
      </Section>

      <Section title="11. Limits on our liability">
        <p>
          To the fullest extent the law allows, {OPERATOR} and its owners
          won&apos;t be liable for any indirect, incidental, special,
          consequential or punitive damages, or for lost data, photos or
          profits, even if we were told they might happen. Our total liability
          for all claims about Park Roulette or these terms is limited to $100.
          Some places don&apos;t allow some of these limits, so they apply to
          you only as far as your local law allows.
        </p>
      </Section>

      <Section title="12. Covering us">
        <p>
          If someone brings a claim against {OPERATOR} or its owners because of
          something you posted, your use of Park Roulette, or your breaking
          these terms or the law, you agree to defend and indemnify us and cover
          our reasonable losses and costs, including reasonable lawyers&apos;
          fees.
        </p>
      </Section>

      <Section title="13. Leaving">
        <p>
          You can remove a kid or delete yourself any time in Family &amp;
          settings (tap your name at the top of your Passport). Your
          family&apos;s founding grown-up (the earliest member who signs in with
          a number) can delete the whole family. We can suspend or close
          accounts as described in section 6, or stop offering Park Roulette.
          Sections 4 (for content already shared), 7, 8, 10, 11, 12, 15 and 16
          still apply after you or we end things.
        </p>
      </Section>

      <Section title="14. Changes to these terms">
        <p>
          If we change these terms in a way that matters, we&apos;ll tell you in
          the app before the change takes effect. If you keep playing after
          that, you accept the new version. If you don&apos;t agree, you can
          delete your account. The date at the top shows the latest version.
        </p>
      </Section>

      <Section title="15. Oregon law">
        <p>
          Oregon law governs these terms, without regard to conflict-of-law
          rules. Any dispute about Park Roulette or these terms goes to the
          state or federal courts located in Deschutes County, Oregon, and you
          and we agree to those courts&apos; jurisdiction.
        </p>
      </Section>

      <Section title="16. The fine print">
        <ul>
          <li>
            If part of these terms can&apos;t be enforced, the rest still
            applies.
          </li>
          <li>
            These terms and the Privacy Policy are the whole agreement between
            you and us about Park Roulette.
          </li>
          <li>
            If we don&apos;t enforce something right away, we haven&apos;t given
            up the right to enforce it later.
          </li>
          <li>
            You can&apos;t transfer your rights under these terms to anyone
            else. We can transfer ours if Park Roulette moves to a new owner.
          </li>
        </ul>
      </Section>

      <Section title="17. Contact">
        <p>
          Questions about these terms? Email {OPERATOR} at <Mail />.
        </p>
      </Section>
    </LegalPage>
  );
}
