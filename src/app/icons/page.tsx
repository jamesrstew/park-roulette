import type { Metadata } from "next";
import { Icon, type IconName } from "@/components/icons";
import { ATTRIBUTES } from "@/lib/features";
export const metadata: Metadata = {
  title: "Crayon icons",
  robots: { index: false, follow: false },
};

type Row = [IconName, string, string];

const attr = (k: string): Row => [
  k as IconName,
  ATTRIBUTES[k].emoji,
  ATTRIBUTES[k].label,
];

const GROUPS: { title: string; rows: Row[] }[] = [
  {
    title: "Nav tabs",
    rows: [
      ["spin", "🎡", "Spin"],
      ["map", "🗺️", "Map"],
      ["list", "📋", "List"],
      ["passport", "📒", "Passport"],
      ["me", "🖍️", "Me"],
    ],
  },
  {
    title: "Play",
    rows: [
      "slides",
      "great_slides",
      "swings",
      "climbing",
      "zipline",
      "splash_pad",
      "sandbox",
      "spinny",
      "accessible",
      "sports_courts",
    ].map(attr),
  },
  {
    title: "For littles",
    rows: ["toddler_area", "baby_swings", "fenced", "stroller_friendly"].map(
      attr,
    ),
  },
  {
    title: "Comfy grown-ups + dogs",
    rows: [
      "shade",
      "restrooms",
      "picnic",
      "parking",
      "water_view",
      "trail",
      "quiet",
      "dog_friendly",
      "dog_park",
    ].map(attr),
  },
  {
    title: "Heads up",
    rows: [
      "busy_road",
      "open_water",
      "no_shade",
      "hot_slides",
      "no_restrooms",
      "goatheads",
      "windy",
      "crowded",
      "broken",
      "messy",
      "old_equipment",
    ].map(attr),
  },
  {
    title: "Park types + cross-offs",
    rows: [
      ["playground", "🛝", "Playground"],
      ["nature", "🪵", "Nature play"],
      ["park", "🌳", "Just a park"],
      ["closed", "🚧", "Closed"],
      ["private", "🔒", "Private"],
      ["safe", "🛡️", "Away from roads"],
    ],
  },
  {
    title: "Actions",
    rows: [
      ["directions", "🚗", "Let's go"],
      ["peek", "👀", "Peek"],
      ["pin", "📍", "Pin"],
      ["near_me", "📍", "Near me"],
      ["stamp", "📬", "Stamp"],
      ["camera", "📸", "Camera"],
      ["video", "🎥", "Video"],
      ["photo", "🖼️", "Photo"],
      ["share", "📤", "Share"],
      ["mail", "💌", "Send"],
      ["link", "🔗", "Link"],
      ["copy", "📄", "Copy"],
      ["qr", "🔳", "QR"],
      ["star", "⭐", "Star"],
      ["warning", "⚠️", "Heads up"],
      ["undo", "↩️", "Undo"],
      ["plus", "➕", "Add"],
      ["search", "🔍", "Search"],
      ["shuffle", "🔀", "Shuffle"],
      ["filter", "🎛️", "More filters"],
      ["sound_on", "🔊", "Sound on"],
      ["sound_off", "🔇", "Sound off"],
      ["edit", "✏️", "Edit"],
      ["trash", "🗑️", "Delete"],
      ["book", "📖", "Park page"],
      ["home", "🏠", "Home"],
      ["phone", "📲", "Make it an app"],
      ["calendar", "📅", "Calendar"],
      ["check", "✅", "Done"],
      ["close", "✕", "Close"],
      ["arrow_left", "←", "Back"],
      ["arrow_right", "→", "Next"],
    ],
  },
  {
    title: "Celebrate",
    rows: [
      ["trophy", "🏆", "Trophy"],
      ["party", "🎉", "Party"],
      ["confetti", "🎊", "Confetti"],
      ["sparkles", "✨", "Sparkles"],
      ["ticket", "🎟️", "Ticket"],
      ["crown", "👑", "Crown"],
      ["heart", "💛", "Heart"],
    ],
  },
];

const CHIPS: IconName[] = [
  "toddler_area",
  "splash_pad",
  "dog_friendly",
  "restrooms",
  "shade",
  "safe",
  "goatheads",
  "windy",
];

/** Internal design review sheet for the crayon icon set. Not linked anywhere. */
export default function IconsPage() {
  return (
    <div className="space-y-8 py-4">
      <header>
        <h1 className="font-hand text-4xl">Crayon icons</h1>
        <p className="text-ink-soft">
          Every icon at 20, 24 and 48px, then in chips and buttons.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-2xl">In the app</h2>
        <nav className="doodle-box flex justify-around bg-[#fffdf7] px-1 py-1.5 shadow-[3px_4px_0_#2b2a33]">
          {(
            [
              ["spin", "Spin"],
              ["map", "Map"],
              ["list", "List"],
              ["passport", "Passport"],
              ["me", "Me"],
            ] as const
          ).map(([n, l]) => (
            <span key={n} className="flex flex-col items-center gap-0.5 py-1">
              <Icon name={n} size={30} />
              <span className="font-hand text-base leading-none">{l}</span>
            </span>
          ))}
        </nav>
        <div className="flex flex-wrap gap-2">
          {CHIPS.map((n, i) => (
            <span
              key={n}
              className="chip"
              aria-pressed={i === 1 ? "true" : undefined}
            >
              <Icon name={n} size={22} />
              {n.replace(/_/g, " ")}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <span className="crayon-btn wax bg-crayon-yellow">
            <Icon name="directions" size={28} /> Let&apos;s go!
          </span>
          <span className="crayon-btn wax bg-crayon-green text-white">
            <Icon name="stamp" size={28} /> We went!
          </span>
          <span className="crayon-btn wax bg-crayon-pink">
            <Icon name="shuffle" size={26} /> Shuffle
          </span>
          <span className="crayon-btn wax bg-[#fffdf7]">
            <Icon name="peek" size={28} /> Peek
          </span>
          <span className="crayon-btn wax bg-crayon-blue text-white">
            <Icon name="camera" size={28} /> Add photos
          </span>
          <span className="crayon-btn wax bg-crayon-orange">
            <Icon name="filter" size={26} /> More
          </span>
        </div>
      </section>

      {GROUPS.map((g) => (
        <section key={g.title} className="space-y-3">
          <h2 className="text-2xl">{g.title}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {g.rows.map(([n, emoji, label]) => (
              <li
                key={n}
                className="doodle-box flex items-center gap-2 px-2 py-2"
              >
                <Icon name={n} size={48} />
                <span className="flex flex-col items-center gap-1">
                  <Icon name={n} size={24} />
                  <Icon name={n} size={20} />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block font-hand text-lg">{label}</span>
                  <span className="block truncate text-xs text-ink-soft">
                    {n} · was {emoji}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
