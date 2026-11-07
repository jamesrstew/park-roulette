/** Shared SVG filters + patterns. Rendered once in the root layout. */
export function CrayonDefs() {
  return (
    <svg aria-hidden width="0" height="0" style={{ position: "absolute" }}>
      <defs>
        {/* Wobbly edges + waxy speckle: makes any SVG shape look drawn in crayon. */}
        <filter id="crayon" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035"
            numOctaves="2"
            seed="3"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
            result="wobbled"
          />
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            seed="8"
            result="grain"
          />
          <feColorMatrix
            in="grain"
            type="matrix"
            values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.8 1.35"
            result="mask"
          />
          <feComposite in="wobbled" in2="mask" operator="in" />
        </filter>
        <filter id="wobble">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.03"
            numOctaves="2"
            seed="11"
            result="warp"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="warp"
            scale="2.5"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
        <pattern
          id="hatch-yellow"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-35)"
        >
          <rect width="6" height="6" fill="#fbe08a" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="#f2b705"
            strokeWidth="3.2"
          />
        </pattern>
      </defs>
    </svg>
  );
}
