import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, Mail, OPERATOR, Section } from "@/components/legal/Legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Park Roulette collects, who can see it, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      lead="Privacy"
      accent="Policy"
      intro={
        <>
          <p>
            <b>The short version.</b> Park Roulette is a free game for families
            visiting playgrounds in Central Oregon. It&apos;s run by {OPERATOR},
            a small Oregon company. We collect as little as we can, we never
            sell it, there are no ads, and we don&apos;t track you. We count
            page visits with a privacy-friendly tool that uses no cookies and
            doesn&apos;t identify you.
          </p>
          <p>
            Your phone number is only used to text you sign-in codes. Photos are
            stored privately and never shown to people who aren&apos;t signed
            in. You choose who sees each review, and you can delete everything
            any time.
          </p>
        </>
      }
    >
      <Section title="Who we are">
        <p>
          Park Roulette (parkroulette.quest) is run by {OPERATOR}, an Oregon
          limited liability company (&ldquo;we&rdquo; or &ldquo;us&rdquo;). This
          policy explains what we collect, why, who sees it, and your choices.
          Questions, requests or worries: <Mail />.
        </p>
      </Section>

      <Section title="Grown-ups hold accounts. Kids play inside them.">
        <p>
          Accounts are for adults 18 and older. Park Roulette is made for
          grown-ups to use with their families. It isn&apos;t directed to
          children under 13, kids don&apos;t get their own accounts, and we
          don&apos;t knowingly collect personal information from children under
          13.
        </p>
        <p>
          A grown-up can add a kid to their family. A kid profile is just a
          first name or nickname, a crayon color and a buddy picture, all picked
          by the grown-up. (A nickname is a great choice.) Kids can color in
          stars and tap ready-made stickers. They can&apos;t type words, add
          photos or videos, send reports, suggest park fixes or have a phone
          number.
        </p>
        <p>
          A grown-up can remove a kid any time in Family &amp; settings (tap
          your name at the top of your Passport), which deletes the kid&apos;s
          profile and ratings. If you think a child has given us personal
          information, email <Mail /> and we&apos;ll delete it.
        </p>
      </Section>

      <Section title="What we collect">
        <ul>
          <li>
            <b>Page visits</b>: which pages are visited, the page that linked
            you here (usually just the site&apos;s name), and your general
            country, browser, operating system and device type. Counted by
            Vercel Web Analytics with no cookies (more below).
          </li>
          <li>
            <b>Your mobile number</b>, if you add one, so we can text you
            one-time sign-in codes. It must be a US mobile number. We keep it so
            you can sign in again, until you remove it.
          </li>
          <li>
            <b>Names you choose</b>: your display name, your family&apos;s name,
            kid names, crayon colors and buddy pictures.
          </li>
          <li>
            <b>Your family&apos;s passport</b>: which parks your family stamped
            and the dates you picked.
          </li>
          <li>
            <b>Reviews</b>: stars, stickers, words, photos and videos, and who
            you chose to share each one with.
          </li>
          <li>
            <b>Parks and fixes</b>: parks you add (name, town and the spot you
            pin on the map) and fixes you suggest (&ldquo;the splash pad is
            gone&rdquo;).
          </li>
          <li>
            <b>Reports</b> you send about a review: the reason and any note you
            add.
          </li>
          <li>
            <b>When you agreed</b> to these policies.
          </li>
          <li>
            <b>Sign-in safety records</b>: each time a code is texted or typed,
            we record the phone number, your IP address (for newer IPv6
            addresses, only the network part) and the time. That&apos;s how we
            stop people from abusing sign-in codes. We delete these records once
            they&apos;re 2 days old.
          </li>
          <li>
            <b>Basic request logs</b>: like any website, our host sees your IP
            address, browser type and the pages you load, and keeps short-lived
            logs to keep the site running. Our own logs show at most the last 4
            digits of a phone number.
          </li>
          <li>
            <b>Messages you send us</b>, if you email us.
          </li>
        </ul>
        <p>
          <b>Your location</b> is only used when you tap a button like
          &ldquo;Near me&rdquo; or &ldquo;Use my location&rdquo;. Your phone
          uses it right there to sort parks, center the map or drop a pin. We
          don&apos;t send it to our servers or save it. When you add a park, we
          save the park&apos;s spot on the map, not yours.
        </p>
        <p>
          <b>Photos</b> are redrawn on your phone before they upload, which
          removes hidden data like where the photo was taken. Animated GIFs and
          videos upload as they are, so they may still hold that data.
        </p>
      </Section>

      <Section title="Cookies and storage on your phone">
        <p>
          We use three cookies, all just to make signing in work. No
          advertising, analytics or tracking cookies.
        </p>
        <ul>
          <li>
            <b>pr_explorer</b> keeps you signed in. It lasts up to 2 years or
            until you sign out.
          </li>
          <li>
            <b>pr_phone</b> remembers a number you just confirmed, for 15
            minutes, so you can finish joining without a second code.
          </li>
          <li>
            <b>pr_grownup</b> lets a grown-up who handed the phone to a kid
            switch back without a new code. It lasts 30 days.
          </li>
        </ul>
        <p>
          Park Roulette also saves a few things in your browser&apos;s own
          storage, which stays on your phone and isn&apos;t sent to us: settings
          like sound on or off, your spin filters, which stickers you&apos;ve
          seen, and whether you&apos;ve closed a tip. While you wait for a code,
          the number you typed is kept in that browser tab for up to 10 minutes.
        </p>
      </Section>

      <Section title="How we use it">
        <p>
          To run the game: sign you in, keep your family&apos;s passport, show
          reviews and park info to the right people, count stars, keep the park
          list accurate, handle reports, stop abuse and spam, keep Park Roulette
          safe, and answer you when you write to us. That&apos;s it. We
          don&apos;t use your information for ads or build profiles about you.
        </p>
      </Section>

      <Section title="Who can see what">
        <ul>
          <li>
            <b>Your phone number</b>: only you. If someone uses your family link
            to switch to you, they see only the last 4 digits.
          </li>
          <li>
            <b>Your family</b>: anyone with your family link can see your
            family&apos;s name and each member&apos;s name and buddy picture, so
            they can pick who they are.
          </li>
          <li>
            <b>Your passport</b> (stamps and dates): only your family.
          </li>
          <li>
            <b>Each review</b>: whoever wrote it picks. &ldquo;Everyone&rdquo;
            means anyone, even people who aren&apos;t signed in.
            &ldquo;Signed-in families&rdquo; (the starting choice) means
            families signed in to Park Roulette. &ldquo;Just our family&rdquo;
            means only your family.
          </li>
          <li>
            <b>Names on reviews</b>: the writer&apos;s name, buddy picture and
            family name show with their review to everyone who can see it.
            &ldquo;Everyone&rdquo; reviews (words, stars and first name) can
            also appear in search engines and AI assistants. Kids&apos; reviews
            only ever show to signed-in families or your own family, never to
            people who aren&apos;t signed in.
          </li>
          <li>
            <b>Stars are always public</b>: every review&apos;s star rating
            counts toward the park&apos;s score, whoever can read the review.
            When you can&apos;t read a review, its stars show without a name, an
            hour after it was last changed (like everything else). Stickers
            count toward the park&apos;s report card the same way. Your choice
            of who sees a review covers its words, photos and your name.
          </li>
          <li>
            <b>Photos</b>: only signed-in families, and only when the review
            allows it. Never people who aren&apos;t signed in, never search
            engines, and never link previews: when someone shares a park&apos;s
            link, the preview shows a crayon wheel with the park&apos;s name,
            town and stars, not anyone&apos;s photos.
          </li>
          <li>
            <b>Videos</b>: only your family.
          </li>
          <li>
            <b>Timing</b>: another family&apos;s review shows up an hour after
            it&apos;s written or last changed (so new words or photos wait an
            hour too), and dates show as days, not times, so the app
            doesn&apos;t tell anyone where your family is right now.
          </li>
          <li>
            <b>Parks and fixes</b>: parks you add show to everyone once another
            family confirms them. Park changes show how many families agreed,
            not who.
          </li>
          <li>
            <b>Reported reviews</b>: hidden from everyone but the writer&apos;s
            family while we look. If a review is reported, our admins can look
            at it, its photos and the reports to decide what to do.
          </li>
        </ul>
        <p>
          Anyone who can see something can screenshot it, so please only share
          what you&apos;re happy to share, and don&apos;t post other
          people&apos;s kids without their grown-ups&apos; okay. See our{" "}
          <Link href="/terms" className="underline">
            Terms
          </Link>{" "}
          for the posting rules.
        </p>
      </Section>

      <Section title="Who helps us run it">
        <p>
          A few companies run parts of Park Roulette for us. They get only what
          they need to do that job:
        </p>
        <ul>
          <li>
            <b>Vercel</b> hosts the app and stores photos and videos in private
            storage. It handles every request, so it sees IP addresses.
          </li>
          <li>
            <b>Vercel Web Analytics</b> counts page visits so we can see which
            pages families use. It gets the page, the page that linked you here
            (usually just the site&apos;s name), and your general country,
            browser, operating system and device type. It uses no cookies and
            doesn&apos;t build a profile of you. Vercel uses your IP address to
            work out the country and a visit code that resets every day, and
            doesn&apos;t keep the IP address. Family invite codes and anything
            after a &ldquo;?&rdquo; are removed from page addresses before a
            visit is counted.
          </li>
          <li>
            <b>Railway</b> hosts our database, where accounts, reviews, stamps
            and phone numbers live.
          </li>
          <li>
            <b>Twilio</b> texts and checks sign-in codes, so it gets your phone
            number.
          </li>
          <li>
            <b>OpenStreetMap</b> serves the map pictures. Your phone asks its
            servers for map tiles directly, so it sees your IP address and which
            part of the map you&apos;re looking at. OpenStreetMap&apos;s own
            privacy policy covers that.
          </li>
        </ul>
        <p>
          Our fonts and pictures come from our own site. There are no
          third-party ads, tracking pixels or social media widgets.
        </p>
      </Section>

      <Section title="We don't sell it">
        <p>
          We don&apos;t sell or rent personal information, including precise
          location or information about children or teens. We don&apos;t share
          it for targeted advertising, and we don&apos;t share your mobile
          number or your agreement to get texts with anyone for their marketing.
          Because we don&apos;t track you across websites, there&apos;s nothing
          for a browser&apos;s &ldquo;Do Not Track&rdquo; or Global Privacy
          Control setting to switch off.
        </p>
      </Section>

      <Section title="When else we might share">
        <ul>
          <li>If the law requires it, like a valid subpoena or court order.</li>
          <li>
            To protect someone&apos;s safety, especially a child&apos;s, or to
            stop fraud or abuse of Park Roulette.
          </li>
          <li>
            If {OPERATOR} sells, merges or passes Park Roulette to someone else,
            your information goes with it, and this policy still covers it
            unless you&apos;re told otherwise first.
          </li>
        </ul>
      </Section>

      <Section title="How long we keep it">
        <ul>
          <li>
            <b>Sign-in safety records</b> (phone and IP): 2 days.
          </li>
          <li>
            <b>Your phone number</b>: until you remove it or delete yourself.
          </li>
          <li>
            <b>Names, kid profiles, reviews, photos and videos</b>: until you
            delete them, yourself or your family.
          </li>
          <li>
            <b>Passport stamps</b>: until you remove them or your family is
            deleted. If one grown-up leaves, the stamps stay with the family.
          </li>
          <li>
            <b>Reports</b>: kept while needed to keep the community safe, and
            deleted when the reported review is deleted or the account that sent
            the report is deleted.
          </li>
          <li>
            <b>Park fixes you suggest</b>: until the fix is applied or turned
            down, or you delete yourself or your family. A change the town
            agreed on stays, with only a count of families.
          </li>
          <li>
            <b>Parks you add</b>: they stay on the map after you leave, without
            your name.
          </li>
          <li>
            <b>Photos picked but never saved</b> to a review: deleted by a daily
            cleanup.
          </li>
          <li>
            <b>Request logs and backups</b>: kept for a limited time by our
            hosts, then replaced.
          </li>
        </ul>
      </Section>

      <Section title="Deleting things">
        <ul>
          <li>
            Delete a review, photo or video any time. While a review is hidden
            after a report, you can edit it, or email <Mail /> and we&apos;ll
            delete it.
          </li>
          <li>
            Remove a kid or delete yourself in Family &amp; settings (tap your
            name at the top of your Passport). Your family&apos;s founding
            grown-up (the earliest member who signs in with a number) can delete
            the whole family. For safety, deleting needs you signed in with your
            number or on the phone you joined with. Or just email <Mail />.
          </li>
          <li>
            Deleting yourself removes your profile, number, reviews, photos and
            videos. If you&apos;re the last grown-up in your family, the whole
            family goes too, kids included.
          </li>
          <li>
            Deleted things leave the app right away, and we delete the photo and
            video files from storage. A photo link already handed to
            someone&apos;s browser stops working within an hour.
          </li>
          <li>
            Our database host keeps rolling backups so we can recover from
            accidents. Deleted information drops out of them as they&apos;re
            replaced, and we don&apos;t restore it from a backup except to
            recover from a failure.
          </li>
        </ul>
      </Section>

      <Section title="Keeping it safe">
        <p>
          We use encrypted connections, signed sign-in cookies that scripts
          can&apos;t read, private photo storage, short-lived photo links and
          limits on sign-in codes. Changing or removing your number signs you
          out everywhere. No system is perfect. If a breach affects your
          personal information, we&apos;ll tell you as Oregon law requires.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <p>Wherever you live, you can ask us to:</p>
        <ul>
          <li>tell you what personal information we have about you;</li>
          <li>send you a copy of it;</li>
          <li>correct anything that&apos;s wrong;</li>
          <li>delete it.</li>
        </ul>
        <p>
          Email <Mail /> from anywhere, or change most things yourself on the Me
          page. We may need to confirm it&apos;s you, for example by texting a
          code to the number on your account. We&apos;ll answer within 30 days.
          If we say no to something, reply to our answer and ask us to take
          another look, and we&apos;ll answer that within 30 days too.
        </p>
        <p>
          You can also change who sees any review, remove your number, and reply
          STOP to stop sign-in texts (reply START to turn them back on). You can
          deny location access in your phone&apos;s settings and still play.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If we change this policy in a way that matters, we&apos;ll tell you in
          the app before it takes effect. The date at the top shows the latest
          version.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          {OPERATOR}, Oregon. Privacy questions or requests: <Mail />.
        </p>
      </Section>
    </LegalPage>
  );
}
