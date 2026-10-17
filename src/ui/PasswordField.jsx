// ════════════════════════════════════════════════════════════
//  PASSWORD FIELD — A password input with a "Show password" toggle on its right.
//  The password is hidden each time the field is first drawn; the eye button shows it
//  while the person checks what they typed. The toggle is a real button with a label
//  and `aria-pressed`, so a screen reader says whether the password is shown.
//  All other props go to the <input> (value, onChange, placeholder, autoComplete, …).
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import Icon from "./Icon.jsx";
import { inputCls } from "./Parts.jsx";

export default function PasswordField({ className = "", ...rest }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <input
        {...rest}
        type={shown ? "text" : "password"}
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect="off"
        className={`${inputCls} pr-12 ${className}`}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        className="absolute inset-y-0 right-0 w-12 flex items-center justify-center text-neutral-500 active:text-black"
      >
        <Icon name={shown ? "eye-off" : "eye"} size={20} />
      </button>
    </div>
  );
}
