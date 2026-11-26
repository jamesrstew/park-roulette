import { esc } from "@/lib/news/template";
import { fmtNum, rate, type DigestView, type Headline } from "./analyze";
import { GROUPS } from "./model";

/**
 * The Monday growth digest as an email: HTML (tables, inline styles, a
 * light card that survives Gmail's dark mode) and plain text. Trends are
 * little bar charts made of table cells, not images or SVG: Gmail shows
 * them on every app, with images off, and nothing is fetched. Kept well
 * under Gmail's ~102 KB clipping point (a test holds it under 80 KB).
 * Pure: the view comes in, strings go out. Every value is escaped.
 */

const C = {
  page: "#f4ecdc",
  paper: "#fffaf0",
  ink: "#2b2a33",
  soft: "#5c5a66",
  rule: "#e6dcc8",
  note: "#fdf0c4",
  alert: "#fbe1dc",
  good: "#23794a",
  bad: "#c4321f",
  flat: "#5c5a66",
  bar: "#2f78d4",
  barPast: "#a9c4e8",
  barNone: "#d9d2c3",
  button: "#1f62b8",
};
const BODY = "'Trebuchet MS',Arial,sans-serif";
const HAND = "'Chalkboard SE','Comic Neue','Trebuchet MS',Arial,sans-serif";
const STRIPE = [
  "#e5432f",
  "#f08a24",
  "#f7c933",
  "#3aa35b",
  "#2f78d4",
  "#8b5cc6",
];

/** Short, shared style strings (they repeat on every row). */
const F = `font-family:${BODY};`;

const toneClass = (t: Headline["tone"]) =>
  t === "good" ? "t-good" : t === "bad" ? "t-bad" : "txt-soft";
const toneColor = (t: Headline["tone"]) =>
  t === "good" ? C.good : t === "bad" ? C.bad : C.flat;

/** 4 bars: this week dark, earlier weeks light, 0 a hairline, unmeasured dotted. */
export function bars(
  series: (number | null)[],
  { height = 22, width = 6, gap = 2 } = {},
): string {
  const max = Math.max(1, ...series.map((x) => x ?? 0));
  const cells = series
    .map((x, i) => {
      const last = i === series.length - 1;
      const pad = last ? "" : `padding-right:${gap}px;`;
      if (x == null)
        return `<td valign="bottom" style="${pad}height:${height}px;font-size:0;line-height:0;"><div style="width:${width}px;border-bottom:1px dotted ${C.barNone};font-size:0;line-height:0;">&nbsp;</div></td>`;
      const h = x === 0 ? 1 : Math.max(2, Math.round((x / max) * height));
      const color = x === 0 ? C.barNone : last ? C.bar : C.barPast;
      return `<td valign="bottom" style="${pad}height:${height}px;font-size:0;line-height:0;"><div style="width:${width}px;height:${h}px;background-color:${color};font-size:0;line-height:0;">&nbsp;</div></td>`;
    })
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells}</tr></table>`;
}

function section(title: string, inner: string): string {
  return `<tr><td class="px" style="padding:26px 28px 0 28px;">
<div class="txt" style="${F}font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.ink};padding-bottom:8px;border-bottom:2px solid ${C.ink};">${esc(title)}</div>
${inner}
</td></tr>`;
}

function changeWords(h: Headline): string {
  if (h.change === "not measured")
    return h.key === "visitors" ? "not connected yet" : "not measured";
  if (h.change === "no prior week") return "new this week";
  if (h.change === "same") return "same as last week";
  return `${h.change.startsWith("+") ? "▲" : "▼"} ${h.change} vs last week`;
}

function tile(h: Headline, note: string): string {
  return `<td class="tile" valign="top" width="33%" style="width:33%;padding:0 5px 10px 5px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-tile" bgcolor="#ffffff" style="background-color:#ffffff;border:2px solid ${C.ink};border-radius:10px;">
<tr><td valign="top" style="padding:10px 0 10px 12px;">
<div class="txt-soft" style="${F}font-size:11px;line-height:14px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:${C.soft};">${esc(h.label)}</div>
<div class="txt" style="${F}font-size:30px;line-height:36px;font-weight:bold;color:${C.ink};">${esc(fmtNum(h.value))}</div>
<div class="${toneClass(h.tone)}" style="${F}font-size:12px;line-height:16px;font-weight:bold;color:${toneColor(h.tone)};">${esc(changeWords(h))}</div>
${note ? `<div class="txt-soft" style="${F}font-size:11px;line-height:15px;color:${C.soft};padding-top:2px;">${esc(note)}</div>` : ""}
</td><td valign="bottom" align="right" style="padding:10px 12px 12px 6px;width:34px;">${bars(h.series)}</td></tr></table>
</td>`;
}

function bullets(items: string[]): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:10px;">${items
    .map(
      (t) =>
        `<tr><td valign="top" width="14" style="width:14px;padding:8px 0 0 0;"><div style="width:6px;height:6px;border-radius:3px;background-color:${C.bar};font-size:0;line-height:0;">&nbsp;</div></td><td class="txt" style="padding:0 0 8px 2px;${F}font-size:15px;line-height:22px;color:${C.ink};">${esc(t)}</td></tr>`,
    )
    .join("")}</table>`;
}

function ideasHtml(v: DigestView): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;">${v.ideas
    .map(
      (idea, i) =>
        `<tr><td valign="top" width="34" style="width:34px;padding:0 0 14px 0;"><div class="num" style="width:26px;height:26px;border-radius:13px;background-color:${C.ink};color:#ffffff;${F}font-size:14px;line-height:26px;font-weight:bold;text-align:center;">${i + 1}</div></td>
<td valign="top" style="padding:2px 0 14px 4px;"><div class="txt" style="${F}font-size:16px;line-height:22px;font-weight:bold;color:${C.ink};">${esc(idea.title)}</div>
<div class="txt-soft" style="${F}font-size:14px;line-height:21px;color:${C.soft};padding-top:2px;">${esc(idea.why)}</div></td></tr>`,
    )
    .join("")}</table>`;
}

/** Each step with its count and the share of the step before it. */
function funnelHtml(v: DigestView): string {
  return v.funnels
    .map((f) => {
      const rows = f.steps
        .map((s, i) => {
          const before = i > 0 ? f.steps[i - 1].n : null;
          const conv = i > 0 && s.n != null ? rate(s.n, before) : "";
          return `<tr>
<td class="txt" style="padding:5px 8px 5px 0;${F}font-size:14px;line-height:18px;color:${C.ink};border-bottom:1px solid ${C.rule};">${i > 0 ? '<span class="txt-soft" style="color:' + C.soft + ';">&#8627;&nbsp;</span>' : ""}${esc(s.label)}${s.note ? `<div class="txt-soft" style="font-size:11px;line-height:14px;color:${C.soft};">${esc(s.note)}</div>` : ""}</td>
<td class="txt-soft" align="right" style="padding:5px 8px;${F}font-size:12px;line-height:16px;color:${C.soft};border-bottom:1px solid ${C.rule};white-space:nowrap;">${esc(conv)}</td>
<td class="txt" align="right" width="44" style="width:44px;padding:5px 0 5px 4px;${F}font-size:15px;line-height:18px;font-weight:bold;color:${C.ink};border-bottom:1px solid ${C.rule};">${s.n == null ? "–" : esc(fmtNum(s.n))}</td>
</tr>`;
        })
        .join("");
      return `<div class="txt" style="${F}font-size:14px;line-height:20px;font-weight:bold;color:${C.ink};padding:14px 0 2px 0;">${esc(f.name)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
    })
    .join("");
}

function tableHtml(v: DigestView): string {
  const rows = v.rows.filter((r) => r.inEmail);
  const th = (t: string, align = "right") =>
    `<td class="txt-soft" align="${align}" style="padding:10px 0 4px 6px;${F}font-size:11px;line-height:14px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;color:${C.soft};">${t}</td>`;
  const head = `<tr>${th("", "left")}${th("Now")}${th("Prior")}${th("Trend")}</tr>`;
  const cell = `border-bottom:1px solid ${C.rule};`;
  const body = GROUPS.map((g) => {
    const rs = rows.filter((r) => r.group === g);
    if (!rs.length) return "";
    return (
      `<tr><td colspan="4" class="txt-soft" style="padding:12px 0 2px 0;${F}font-size:11px;line-height:14px;font-weight:bold;text-transform:uppercase;letter-spacing:0.5px;color:${C.soft};">${esc(g)}</td></tr>` +
      rs
        .map((r) => {
          const moved =
            r.change !== "same" &&
            r.change !== "no prior week" &&
            r.change !== "not measured";
          return `<tr><td class="txt" style="padding:6px 6px 6px 0;${F}font-size:14px;line-height:18px;color:${C.ink};${cell}">${esc(r.label)}</td><td class="txt" align="right" style="padding:6px 0 6px 6px;${F}font-size:15px;line-height:18px;font-weight:bold;color:${C.ink};${cell}white-space:nowrap;">${esc(fmtNum(r.value))}${moved ? `<div class="${toneClass(r.tone)}" style="font-size:11px;line-height:14px;color:${toneColor(r.tone)};">${esc(r.change.split(" ")[0])}</div>` : ""}</td><td class="txt-soft" align="right" style="padding:6px 0 6px 6px;${F}font-size:14px;line-height:18px;color:${C.soft};${cell}">${esc(fmtNum(r.prev))}</td><td align="right" style="padding:6px 0 6px 10px;${cell}">${bars(r.series, { height: 16, width: 5, gap: 2 })}</td></tr>`;
        })
        .join("")
    );
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${head}${body}</table>
<div class="txt-soft" style="${F}font-size:12px;line-height:17px;color:${C.soft};padding-top:8px;">Rows that were 0 both weeks or aren't measured yet are left out. Every number is in the full view.</div>`;
}

export type RenderOptions = {
  /** The web view (absolute). */
  webUrl: string;
};

const adminOf = (webUrl: string) =>
  webUrl.replace(/\/admin\/growth.*$/, "/admin");

export function renderSubject(v: DigestView): string {
  const [fam, aud, vis] = v.headlines;
  const part = (label: string, h: Headline) =>
    `${fmtNum(h.value)} ${label}${
      h.change.startsWith("+") || h.change.startsWith("−")
        ? ` (${h.change.split(" ")[0]})`
        : ""
    }`;
  const parts = [
    part(fam.value === 1 ? "new family" : "new families", fam),
    vis.value == null ? null : part("visitors", vis),
    aud.value == null ? null : part("reach", aud),
  ].filter(Boolean);
  return `Growth, ${v.week.label}: ${parts.join(", ")}`;
}

export function renderHtml(v: DigestView, opts: RenderOptions): string {
  const o = { ...opts, adminUrl: adminOf(opts.webUrl) };
  const notes = ["", v.audienceParts, ""];
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(`Park Roulette growth, ${v.week.label}`)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
body { margin:0; padding:0; width:100% !important; -webkit-text-size-adjust:100%; }
table { border-collapse:collapse; }
@media screen and (max-width:620px) {
  .container { width:100% !important; }
  .px { padding-left:16px !important; padding-right:16px !important; }
  .tile { display:block !important; width:100% !important; padding:0 0 8px 0 !important; }
  .tiles { padding:14px 16px 0 16px !important; }
}
@media (prefers-color-scheme: dark) {
  .bg-page { background-color:#1d1c22 !important; }
  .bg-card { background-color:#2b2a33 !important; }
  .bg-tile { background-color:#34333d !important; border-color:#55535f !important; }
  .bg-note { background-color:#4a4231 !important; }
  .bg-alert { background-color:#5a2a24 !important; }
  .txt { color:#f3efe6 !important; }
  .txt-soft { color:#b9b4c2 !important; }
  .t-good { color:#5fd08a !important; }
  .t-bad { color:#ff8a7a !important; }
  .num { background-color:#3a6fd0 !important; color:#ffffff !important; }
  .lnk { color:#8fbaf0 !important; }
}
[data-ogsb] .bg-page { background-color:#1d1c22 !important; }
[data-ogsb] .bg-card { background-color:#2b2a33 !important; }
[data-ogsb] .bg-tile { background-color:#34333d !important; }
[data-ogsb] .bg-note { background-color:#4a4231 !important; }
[data-ogsb] .bg-alert { background-color:#5a2a24 !important; }
[data-ogsb] .num { background-color:#3a6fd0 !important; }
[data-ogsc] .txt { color:#f3efe6 !important; }
[data-ogsc] .txt-soft { color:#b9b4c2 !important; }
[data-ogsc] .t-good { color:#5fd08a !important; }
[data-ogsc] .t-bad { color:#ff8a7a !important; }
[data-ogsc] .lnk { color:#8fbaf0 !important; }
</style>
</head>
<body class="bg-page" style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.page};opacity:0;">${esc(v.verdict)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-page" bgcolor="${C.page}" style="background-color:${C.page};">
<tr><td align="center" style="padding:20px 8px;">
<table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="font-size:0;line-height:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${STRIPE.map((c) => `<td height="6" bgcolor="${c}" style="background-color:${c};height:6px;font-size:0;">&nbsp;</td>`).join("")}</tr></table></td></tr>
<tr><td class="bg-card" bgcolor="${C.paper}" style="background-color:${C.paper};border:2px solid ${C.ink};border-top:0;padding-bottom:28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
<tr><td class="px" style="padding:22px 28px 0 28px;">
<div class="txt-soft" style="${F}font-size:12px;line-height:16px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:${C.soft};">Park Roulette &middot; Weekly growth</div>
<div class="txt" style="font-family:${HAND};font-size:28px;line-height:34px;font-weight:bold;color:${C.ink};padding-top:2px;">Week of ${esc(v.week.label)}</div>${v.week.partial ? `<div class="txt-soft" style="${F}font-size:13px;line-height:18px;color:${C.soft};">So far: gathered before the week ended</div>` : ""}
</td></tr>
<tr><td class="px" style="padding:14px 28px 0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-note" bgcolor="${C.note}" style="background-color:${C.note};border-radius:10px;"><tr><td class="txt" style="padding:14px 16px;${F}font-size:17px;line-height:24px;font-weight:bold;color:${C.ink};">${esc(v.verdict)}</td></tr></table>
${
  v.problem
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg-alert" bgcolor="${C.alert}" style="background-color:${C.alert};border-radius:10px;margin-top:8px;"><tr><td class="txt" style="padding:10px 16px;${F}font-size:14px;line-height:20px;color:${C.ink};"><b class="t-bad" style="color:${C.bad};">Needs a look:</b> ${esc(v.problem)} <a class="lnk" href="${esc(o.adminUrl)}" style="color:${C.button};font-weight:bold;">Open /admin</a></td></tr></table>`
    : ""
}
</td></tr>
<tr><td class="tiles" style="padding:16px 23px 0 23px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${v.headlines.map((h, i) => tile(h, notes[i])).join("")}</tr></table>
</td></tr>
${section("What moved and why", bullets(v.moved))}
${section("3 things to try this week", ideasHtml(v))}
${section("This week's funnels", funnelHtml(v))}
${section("Key numbers", tableHtml(v))}
${section(
  "What we can't see yet",
  `<div class="txt-soft" style="${F}font-size:13px;line-height:19px;color:${C.soft};padding-top:10px;">${v.gaps.map((g) => `&bull; ${esc(g)}`).join("<br>")}</div>`,
)}
<tr><td class="px" align="left" style="padding:24px 28px 0 28px;">
<a href="${esc(o.webUrl)}" style="display:inline-block;background-color:${C.button};border:2px solid ${C.ink};border-radius:22px;color:#ffffff;${F}font-size:15px;font-weight:bold;line-height:40px;padding:0 22px;text-decoration:none;">See every number and definition</a>
</td></tr>
</table>
</td></tr>
<tr><td class="txt-soft" style="padding:16px 12px 0 12px;${F}font-size:12px;line-height:18px;color:${C.soft};text-align:center;">The Monday growth digest. Counts only: no names, addresses or numbers.<br>Weeks run Monday to Sunday, Pacific.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderText(v: DigestView, o: RenderOptions): string {
  const out: string[] = [];
  out.push(
    `PARK ROULETTE WEEKLY GROWTH: week of ${v.week.label}`,
    "",
    v.verdict,
  );
  if (v.week.partial) out.push("(So far: gathered before the week ended.)");
  if (v.problem)
    out.push("", `Needs a look: ${v.problem} ${adminOf(o.webUrl)}`);
  out.push("");
  for (const h of v.headlines)
    out.push(
      `${h.label}: ${fmtNum(h.value)}${h.change.startsWith("+") || h.change.startsWith("\u2212") ? `, ${h.change}` : ""}${h.key === "audience_total" ? ` (${v.audienceParts.replace(/ \u00b7 /g, ", ")})` : ""}`,
    );
  out.push("", "WHAT MOVED AND WHY", ...v.moved.map((m) => `* ${m}`));
  out.push(
    "",
    "3 THINGS TO TRY THIS WEEK",
    ...v.ideas.map((x, i) => `${i + 1}. ${x.title}. ${x.why}`),
  );
  out.push("", "THIS WEEK'S FUNNELS");
  for (const f of v.funnels)
    out.push(
      `${f.name}: ${f.steps.map((s) => `${s.label} ${fmtNum(s.n)}`).join(" > ")}`,
    );
  out.push("", "KEY NUMBERS (now / prior)");
  for (const g of GROUPS) {
    const rs = v.rows.filter((r) => r.inEmail && r.group === g);
    if (!rs.length) continue;
    out.push(`${g}:`);
    for (const r of rs)
      out.push(`  ${r.label}: ${fmtNum(r.value)} / ${fmtNum(r.prev)}`);
  }
  out.push("", "WHAT WE CAN'T SEE YET", ...v.gaps.map((g) => `* ${g}`));
  out.push("", `Every number and definition: ${o.webUrl}`);
  return out.join("\n");
}
