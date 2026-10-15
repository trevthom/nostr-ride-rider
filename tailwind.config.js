// Tailwind CSS v3, built into the app's own CSS (see vite.config.js). `content` lists every file whose class names get CSS:
// write each class out in full ("bg-" + color is not found). Do NOT use Tailwind v4 or @tailwindcss/vite (native binary).
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default {
  content: [`${root}/*.html`, `${root}/src/**/*.{js,jsx}`],
  theme: { extend: {} },
  plugins: [],
};
