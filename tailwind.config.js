// Tailwind CSS v3, built into a CSS file that the app hosts itself (no third-party script runs in the page: this is a
// wallet app, so a script from another site could read the keys). It is a normal build step through PostCSS (see
// vite.config.js). v3 is plain JavaScript: it has no native binary, which is why the older "no Tailwind in package.json"
// rule no longer applies. Do NOT use Tailwind v4 or @tailwindcss/vite (their native binary breaks on some machines).
//
// `content` lists every file whose class names must get CSS. A class name built from pieces ("bg-" + color) is NOT
// found by the scan: write each class out in full.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

// Dark mode: the colors the screens use (white, black, the neutral grays, and the tints of red, amber, green and blue) are
// CSS variables (src/index.css: :root = light, .dark = dark). A class such as `bg-white` or `text-neutral-500` therefore
// follows the setting with no `dark:` variant on each element. "black" and "white" swap in the dark look (a black button
// becomes a light one with dark text), so a color that must NOT change (white text on the green GO button, on a red
// button, a photo's dark backdrop) is written as a fixed value: `text-[#fff]`, `bg-[#000]/50`.
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;
const scale = (prefix, steps) => Object.fromEntries(steps.map((n) => [n, v(`${prefix}-${n}`)]));

export default {
  darkMode: "class",
  content: [`${root}/*.html`, `${root}/src/**/*.{js,jsx}`],
  theme: {
    extend: {
      colors: {
        white: v("white"),
        black: v("black"),
        neutral: scale("neutral", [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]),
        red: scale("red", [50, 100, 600, 700]),
        amber: scale("amber", [50, 700, 800, 900]),
        green: scale("green", [50, 200, 700]),
        blue: scale("blue", [600]),
      },
    },
  },
  plugins: [],
};
