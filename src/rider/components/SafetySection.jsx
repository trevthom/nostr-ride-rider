// ════════════════════════════════════════════════════════════
//  SAFETY SECTION (rider Account) — Trusted contacts for "Share my trip" and
//  SOS. Stored on this device only; the app never uploads them.
// ════════════════════════════════════════════════════════════

import { useState } from "react";
import { getContacts, saveContacts, addContact } from "../../lib/safety.js";
import { SectionLabel, inputCls } from "../../ui/Parts.jsx";
import Button from "../../ui/Button.jsx";

export default function SafetySection() {
  const [list, setList] = useState(getContacts);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const update = (next) => { setList(next); saveContacts(next); };
  const add = () => {
    const next = addContact(list, name, phone);
    if (next === list) return setError("Enter a name and a phone number that is not already saved.");
    setError(""); update(next); setName(""); setPhone("");
  };
  return (
    <div>
      <SectionLabel>Trusted contacts</SectionLabel>
      <p className="text-neutral-500 text-sm mb-3">People you can text a live link to during a trip. Saved on this device only.</p>
      {list.map((c) => (
        <div key={c.phone} className="flex items-center justify-between py-2 border-b border-neutral-100">
          <span className="text-[15px]">{c.name} <span className="text-neutral-500">{c.phone}</span></span>
          <button type="button" onClick={() => update(list.filter((x) => x.phone !== c.phone))} className="text-sm text-red-600 font-medium">Remove</button>
        </div>
      ))}
      <div className="flex gap-2 mt-3">
        <input aria-label="Contact name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className={`${inputCls} min-w-0`} />
        <input aria-label="Contact phone" value={phone} onChange={(e) => setPhone(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder="Phone" inputMode="tel" className={`${inputCls} min-w-0`} />
        <Button size="md" full={false} onClick={add} className="px-4" disabled={!name.trim() || !phone.trim()}>Add</Button>
      </div>
      {error && <p className="text-red-600 text-xs mt-1">{error}</p>}
    </div>
  );
}
