import { SITE_URL } from "@/lib/site";
import { TEXTS_FROM } from "@/lib/texts";
import { parkRouletteVcard } from "@/lib/vcard";

/**
 * /park-roulette.vcf: Park Roulette's contact card. The Weekend Pick
 * confirmation is an MMS with this as its media, so families can save the
 * number (Twilio fetches it when it sends).
 */
export function GET() {
  return new Response(
    parkRouletteVcard({ number: TEXTS_FROM, site: SITE_URL }),
    {
      headers: {
        "content-type": "text/vcard; charset=utf-8",
        "content-disposition": 'inline; filename="park-roulette.vcf"',
        "cache-control": "public, max-age=3600",
      },
    },
  );
}
