# Park Roulette Twilio A2P Registration

Prepared November 19, 2026.

## Context

Park Roulette helps Central Oregon families discover playgrounds, with park recommendations, directions, reviews, and a family passport. The planned SMS program sends a weekly text featuring a different park.

The repo anticipated SMS marketing: `src/db/schema.ts` says "sms comes later, after carrier registration." Currently, however, it collects consent for monthly email news, and the terms promise that texts are for sign-in codes only.

**A separate marketing SMS opt-in is required before sending weekly park texts.** Existing phone numbers and email subscriptions do not establish that permission. [Twilio's messaging policy](https://www.twilio.com/en-us/legal/messaging-policy) requires express written consent for promotional messages.

Source form: `/Users/jamesstewart/Downloads/gofullpage-console-twilio-us1-develop-sms-regulatory-compliance-a2p-onboarding-2026-11-19-12_16_21.pdf`.

## Registration Fields

### A2P Brand

TRUE CRAFT VENTURES LLC

### Campaign Use Case

Keep **Low Volume Mixed** for the initial small audience. This supports marketing traffic; describe the weekly promotional purpose clearly.

Reference: [Twilio's campaign types](https://help.twilio.com/articles/1260801844470-List-of-Campaign-Types-and-Use-Case-Types-for-A2P-10DLC-registration).

### Messaging Service

Select **Create new Messaging Service**.

Keep sign-in codes on the existing Twilio Verify setup. Verify can handle verification without this campaign registration.

Reference: [Twilio's A2P 10DLC guidance](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc).

### Campaign Description

Copy and paste:

> Park Roulette, operated by True Craft Ventures LLC, sends weekly promotional SMS messages to adult users who explicitly subscribe to park recommendations. Messages feature parks and playgrounds in Central Oregon and link to park information on parkroulette.quest, encouraging families to discover local parks and use Park Roulette. Subscribers receive approximately one promotional message per week and can reply STOP to unsubscribe or HELP for assistance.

### Sample Message #1

Copy and paste:

> Park Roulette: This week's park pick is Alpenglow Park in Bend! Plan your next family outing: https://parkroulette.quest/parks/alpenglow-park-bend Reply STOP to unsubscribe.

### Sample Message #2

Copy and paste:

> Park Roulette: Looking for your next playground adventure? Explore Rockridge Park in Bend: https://parkroulette.quest/parks/rockridge-park-bend Reply STOP to unsubscribe.

### Sample Messages #3-5

Leave blank; these fields are optional.

### Message Contents

| Checkbox | Selection |
| --- | --- |
| Embedded links | Check |
| Phone numbers in message content | Unchecked |
| Direct lending or loan arrangements | Unchecked |
| Age-gated content | Unchecked |

### Privacy Policy URL

```text
https://parkroulette.quest/privacy
```

### Terms and Conditions URL

```text
https://parkroulette.quest/terms
```

These are the repo's policy URLs. Both pages need to describe the weekly SMS program before submission.

### How Do End-Users Consent to Receive Messages?

**The proposed flow below is not implemented yet. Do not submit this description until it accurately describes the published signup flow.**

Add a separate, unchecked checkbox in Family & settings using the proposed disclosure in the next section. Once that flow exists, copy and paste the following description, replacing the screenshot placeholder:

> Adult users opt in through Family & settings at https://parkroulette.quest/me. Users confirm their mobile number, select a separate checkbox that is unchecked by default, and submit their subscription. The disclosure identifies Park Roulette and True Craft Ventures LLC, explains that messages are recurring automated marketing texts featuring Central Oregon parks and playgrounds, states approximately one promotional text per week and that message and data rates may apply, and provides STOP and HELP instructions and links to the Terms and Privacy Policy. Consent is optional and is not required to purchase anything or use Park Roulette. We record the phone number, consent timestamp, source, and disclosure version. Sign-in and email consent do not enroll users. Public screenshot of the opt-in form: [INSERT PUBLIC SCREENSHOT URL].

### Opt-in Keywords

Leave blank if enrollment happens only through the website.

### Opt-in Message

Leave blank under the same website-only enrollment setup. The form says this field applies to keyword enrollment.

## Proposed Signup Disclosure

Place this text beside a separate checkbox that is unchecked by default in Family & settings:

> I agree to receive recurring automated marketing texts from Park Roulette, operated by True Craft Ventures LLC, featuring Central Oregon parks and playgrounds. Approximately one promotional text per week. Consent is not a condition of purchase or use of Park Roulette. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Terms and Privacy Policy.

Make "Terms" and "Privacy Policy" clickable links to the corresponding policy pages.

## Before Clicking Create

- [ ] Publish the optional SMS opt-in flow.
- [ ] Update the Terms and Privacy Policy to describe the weekly SMS program.
- [ ] Record the phone number, consent timestamp, source, and disclosure version.
- [ ] Configure STOP and HELP handling.
- [ ] Publish a publicly accessible screenshot of the opt-in form and replace the placeholder in the consent description.
- [ ] Verify that the campaign description, sample messages, policies, and consent description match the finished signup flow.

The campaign description and samples above are ready to use. The consent description must match the finished signup flow before submission.
