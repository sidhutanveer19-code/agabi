import type { Lesson } from "@/features/canvas/lib/lesson";

/**
 * The design's demonstration lesson — "Why does a ball thrown upwards come back
 * down?" — expressed entirely as data in the generic Lesson model. Nothing here
 * lives inside a component; swap this file for any other Lesson and the board
 * renders it identically.
 */
export const projectileLesson: Lesson = {
  id: "projectile-motion",
  subject: "Physics",
  title: "Why does a ball thrown upwards come back down?",
  viewBox: "0 0 1340 1000",
  nodes: [
    // ---- drawn strokes (top level) ----
    { t: "path", kind: "stroke", dl: 0.5, dur: 1, d: "M300,632 L1095,632", stroke: "#EDE8DF", w: 2.5, cap: true },
    {
      t: "path",
      kind: "stroke",
      dl: 0.7,
      dur: 1,
      d: "M330,632 l-14,20 M372,632 l-14,20 M414,632 l-14,20 M456,632 l-14,20 M498,632 l-14,20 M540,632 l-14,20 M582,632 l-14,20 M624,632 l-14,20 M666,632 l-14,20 M708,632 l-14,20 M750,632 l-14,20 M792,632 l-14,20 M834,632 l-14,20 M876,632 l-14,20 M918,632 l-14,20 M960,632 l-14,20 M1002,632 l-14,20 M1044,632 l-14,20 M1086,632 l-14,20",
      stroke: "#EDE8DF",
      w: 1.6,
      cap: true,
      opacity: 0.7,
    },
    { t: "path", kind: "stroke", dl: 0.9, dur: 1.8, d: "M360,632 Q710,-168 1060,632", stroke: "#EDE8DF", w: 2.4, cap: true, fill: "none" },
    { t: "path", kind: "fade", dl: 2.4, d: "M710,244 L710,628", stroke: "#6FCF97", w: 2, dash: "3 9", cap: true, opacity: 0.85 },
    { t: "path", kind: "stroke", dl: 0.5, dur: 0.9, d: "M60,168 C210,160 380,162 470,176", stroke: "#A78BFA", w: 3, cap: true, fill: "none" },
    { t: "path", kind: "stroke", dl: 0.8, dur: 0.7, d: "M556,242 C600,238 650,238 690,244", stroke: "#EDE8DF", w: 2, cap: true, opacity: 0.8, fill: "none" },
    { t: "path", kind: "stroke", dl: 3.3, dur: 0.8, d: "M430,738 C480,734 528,734 566,740", stroke: "#6FCF97", w: 2.4, cap: true, fill: "none" },

    // ---- headings ----
    {
      t: "group",
      kind: "fade",
      dl: 0.2,
      hand: true,
      children: [
        { t: "text", x: 60, y: 96, fill: "#EDE8DF", size: 46, content: "Why does a ball thrown upwards" },
        { t: "text", x: 60, y: 150, fill: "#EDE8DF", size: 46, content: "come back down?" },
        { t: "text", x: 60, y: 232, fill: "#EDE8DF", size: 38, content: { slot: "subtitle" } },
      ],
    },

    // ---- balls ----
    {
      t: "group",
      kind: "fade",
      dl: 1.9,
      children: [
        { t: "circle", cx: 458, cy: 439, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 528, cy: 340, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 612, cy: 263, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 808, cy: 263, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 892, cy: 340, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 962, cy: 439, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "circle", cx: 1018, cy: 512, r: 13, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        // top ball with + marker
        { t: "circle", cx: 710, cy: 232, r: 15, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "path", d: "M710,224 L710,240 M702,232 L718,232", stroke: "#EDE8DF", w: 2, cap: true },
        // thrown ball with + marker
        { t: "circle", cx: 402, cy: 542, r: 15, fill: "#0a0c11", stroke: "#EDE8DF", w: 2 },
        { t: "path", d: "M402,534 L402,550 M394,542 L410,542", stroke: "#EDE8DF", w: 2, cap: true },
      ],
    },

    // ---- up arrows ----
    {
      t: "group",
      kind: "fade",
      dl: 2,
      stroke: "#A78BFA",
      w: 3,
      cap: true,
      children: [
        { t: "path", d: "M352,588 L392,548", stroke: "#A78BFA", w: 3, marker: "V" },
        { t: "path", d: "M420,486 L456,448", stroke: "#A78BFA", w: 3, marker: "V" },
        { t: "path", d: "M496,392 L524,356", stroke: "#A78BFA", w: 3, marker: "V" },
        { t: "path", d: "M588,312 L610,282", stroke: "#A78BFA", w: 3, marker: "V" },
      ],
    },

    // ---- down arrows ----
    {
      t: "group",
      kind: "fade",
      dl: 2.2,
      stroke: "#E8944E",
      w: 3,
      cap: true,
      children: [
        { t: "path", d: "M840,252 L852,288", stroke: "#E8944E", w: 3, marker: "O" },
        { t: "path", d: "M908,322 L924,372", stroke: "#E8944E", w: 3, marker: "O" },
        { t: "path", d: "M978,416 L996,472", stroke: "#E8944E", w: 3, marker: "O" },
        { t: "path", d: "M1036,512 L1056,584", stroke: "#E8944E", w: 3, marker: "O" },
      ],
    },

    // ---- gravity ----
    {
      t: "group",
      kind: "fade",
      dl: 2.5,
      hand: true,
      children: [
        { t: "path", d: "M656,432 L656,504", stroke: "#6FCF97", w: 3, cap: true, marker: "G" },
        { t: "text", x: 676, y: 492, fill: "#6FCF97", size: 46, content: "g" },
        { t: "text", x: 748, y: 452, fill: "#6FCF97", size: 32, content: "Gravity pulls" },
        { t: "text", x: 748, y: 488, fill: "#6FCF97", size: 32, content: "downwards" },
        { t: "text", x: 748, y: 524, fill: "#6FCF97", size: 32, content: "constantly" },
      ],
    },

    // ---- v = 0 ----
    {
      t: "group",
      kind: "fade",
      dl: 2.6,
      hand: true,
      children: [
        { t: "text", x: 710, y: 150, fill: "#B39DDB", size: 34, anchor: "middle", content: "v = 0" },
        { t: "text", x: 710, y: 186, fill: "#B39DDB", size: 34, anchor: "middle", content: "at the top" },
      ],
    },

    // ---- initial velocity + thrower ----
    {
      t: "group",
      kind: "fade",
      dl: 2.3,
      hand: true,
      children: [
        { t: "text", x: 248, y: 694, fill: "#A78BFA", size: 31, content: "Initial velocity" },
        { t: "text", x: 292, y: 730, fill: "#A78BFA", size: 31, content: "upwards" },
        { t: "path", d: "M300,700 C350,690 400,672 452,650", stroke: "#A78BFA", w: 2.6, cap: true, fill: "none", marker: "V" },
        { t: "circle", cx: 400, cy: 560, r: 9, fill: "#0a0c11", stroke: "#EDE8DF", w: 2.2 },
        { t: "path", d: "M400,569 L400,600", stroke: "#EDE8DF", w: 2.2, cap: true, fill: "none" },
        { t: "path", d: "M400,578 L382,568 M400,578 L418,556", stroke: "#EDE8DF", w: 2.2, cap: true, fill: "none" },
        { t: "path", d: "M400,600 L386,624 M400,600 L414,624", stroke: "#EDE8DF", w: 2.2, cap: true, fill: "none" },
        { t: "path", d: "M418,556 L400,542", stroke: "#EDE8DF", w: 2.2, cap: true, fill: "none", dash: "2 6" },
      ],
    },

    // ---- orange callouts ----
    {
      t: "group",
      kind: "fade",
      dl: 2.8,
      hand: true,
      children: [
        { t: "text", x: 1010, y: 300, fill: "#E8944E", size: 33, content: { slot: "cA0" } },
        { t: "text", x: 1042, y: 340, fill: "#E8944E", size: 33, content: { slot: "cA1" } },
        { t: "path", d: "M1004,356 C956,384 918,400 898,420", stroke: "#E8944E", w: 2.6, cap: true, fill: "none", marker: "O" },
        { t: "text", x: 1092, y: 470, fill: "#E8944E", size: 31, content: "Speed decreases" },
        { t: "text", x: 1092, y: 506, fill: "#E8944E", size: 31, content: "while going up" },
        { t: "text", x: 1096, y: 600, fill: "#E8944E", size: 31, content: "Speed increases" },
        { t: "text", x: 1096, y: 636, fill: "#E8944E", size: 31, content: "while coming down" },
      ],
    },

    // ---- key idea ----
    {
      t: "group",
      kind: "fade",
      dl: 3.2,
      hand: true,
      children: [
        { t: "text", x: 430, y: 726, fill: "#6FCF97", size: 38, content: "Key Idea" },
        { t: "text", x: 576, y: 726, fill: "#EDE8DF", size: 38, content: { slot: "keyTail" } },
      ],
    },

    // ---- mathematical model ----
    {
      t: "group",
      kind: "fade",
      dl: 3.4,
      hand: true,
      children: [
        { t: "rect", x: 380, y: 772, w: 452, h: 150, rx: 14, fill: "rgba(217,195,107,.045)", stroke: "#D9C36B", sw: 2 },
        { t: "rect", x: 404, y: 758, w: 228, h: 28, fill: "#0a0c11" },
        { t: "text", x: 412, y: 780, fill: "#D9C36B", size: 30, content: "Mathematical Model" },
        { t: "text", x: 440, y: 862, fill: "#EDE8DF", size: 48, content: "a = -g" },
        { t: "text", x: 646, y: 858, fill: "#EDE8DF", size: 42, content: "g ≈ 9.8 m/s²" },
        { t: "text", x: 690, y: 896, fill: "#9aa0a8", size: 26, content: "(downwards)" },
      ],
    },

    // ---- right notes ----
    {
      t: "group",
      kind: "fade",
      dl: 3.6,
      hand: true,
      children: [
        { t: "text", x: 862, y: 808, fill: "#EDE8DF", size: 31, content: { slot: "n1a" } },
        { t: "text", x: 862, y: 844, fill: "#EDE8DF", size: 31, content: { slot: "n1b" } },
        { t: "path", d: "M858,884 L900,884", stroke: "#EDE8DF", w: 2.4, cap: true, marker: "W" },
        { t: "text", x: 912, y: 892, fill: "#EDE8DF", size: 31, content: { slot: "n2a" } },
        { t: "text", x: 912, y: 928, fill: "#EDE8DF", size: 31, content: { slot: "n2b" } },
      ],
    },
  ],

  variants: {
    normal: {
      subtitle: "Let's think about what is really happening.",
      cA0: "We will start simple.",
      cA1: "Just the idea of gravity.",
      keyTail: ": Gravity is always acting downwards.",
      n1a: "This simple idea explains the",
      n1b: "entire motion.",
      n2a: "Now let's connect this",
      n2b: "to equations.",
    },
    again1: {
      subtitle: "Same idea, another angle — think of speed as a debt.",
      cA0: "Going up, the ball",
      cA1: "spends its speed.",
      keyTail: ": borrowed on the way up, repaid on the way down.",
      n1a: "Up and down are",
      n1b: "mirror images.",
      n2a: "Same speeds, same times",
      n2b: "— just reversed.",
    },
    again2: {
      subtitle: "Forget the ball for a moment — watch the speed.",
      cA0: "Track one number:",
      cA1: "the upward speed.",
      keyTail: ": the top is simply where that number hits zero.",
      n1a: "Speed melts to zero,",
      n1b: "then grows back.",
      n2a: "Gravity never paused",
      n2b: "— only the ball did.",
    },
    simpler: {
      subtitle: "Let's keep this really simple.",
      cA0: "Up means slowing.",
      cA1: "Down means speeding.",
      keyTail: ": what goes up must come down.",
      n1a: "Earth always pulls",
      n1b: "things downward.",
      n2a: "That's the whole",
      n2b: "story here.",
    },
    deeper: {
      subtitle: "Now let's be precise about it.",
      cA0: "Acceleration is constant:",
      cA1: "a = -g throughout.",
      keyTail: ": velocity changes by 9.8 m/s every second.",
      n1a: "At the peak v = 0",
      n1b: "but a is still -g.",
      n2a: "Integrate a for v,",
      n2b: "then v for position.",
    },
  },
};
