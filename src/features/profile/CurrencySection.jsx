// ════════════════════════════════════════════════════════════
//  CURRENCY — Pick the local currency (both apps). Every price and charge is
//  shown in it. A charge is turned into sats at the BTC price of the moment
//  it happens (lib/ticks.js), and the sats are what is paid.
// ════════════════════════════════════════════════════════════

import { useApp } from "../../state/AppContext.jsx";
import { CURRENCIES } from "../../lib/currency.js";
import { SectionLabel, inputCls } from "../../ui/Parts.jsx";
import { formatFiat, satsFromFiat } from "../../lib/currency.js";

export default function CurrencySection({ locked = false }) {
  const { currency, setCurrency, btcPrice } = useApp();
  const oneUnit = formatFiat(1, currency).replace(/[.,]00(?=\D|$)/, ""); // "$1" (never "$1.00"), follows the chosen currency
  return (
    <section>
      <SectionLabel>Currency</SectionLabel>
      <p className="text-sm text-neutral-500 mb-2">
        Your money is paid in sats, at the bitcoin price of the moment the charge happens.
      </p>
      <select aria-label="Local currency" value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={locked} className={inputCls}>
        {Object.entries(CURRENCIES).map(([code, c]) => <option key={code} value={code}>{code} · {c.name} ({c.symbol})</option>)}
      </select>
      {btcPrice ? (
        <p className="text-xs text-neutral-500 mt-1 flex items-center justify-between gap-3" role="status">
          <span>1 bitcoin = {formatFiat(btcPrice, currency)}</span>
          <span className="text-right">{oneUnit} = {satsFromFiat(1, btcPrice)?.toLocaleString()} sats</span>
        </p>
      ) : (
        <p className="text-xs text-neutral-500 mt-1" role="status">The bitcoin price for this currency is not available yet. Amounts show in sats until it is.</p>
      )}
    </section>
  );
}
