// ════════════════════════════════════════════════════════════
//  QR CODE — Renders any text string as a scannable QR code.
//  Used for sharing Lightning invoices and connection strings.
// ════════════════════════════════════════════════════════════

import { QRCodeSVG } from "qrcode.react";

export default function QRCode({ value, size = 180 }) {
  if (!value) return null;
  return (
    <div className="inline-block bg-white p-3 rounded-xl border border-neutral-200">
      <QRCodeSVG value={value} size={size} level="M" />
    </div>
  );
}
