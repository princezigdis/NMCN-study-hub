import { useState } from "react";
import { api } from "../lib/api";
import { friendly } from "../lib/errors";
import { naira } from "../lib/format";
import { Icon } from "./Icon";
import { Button, Card, useToast } from "./ui";

/** Shown when a paid section isn't unlocked. Prices always come from the server. */
export function Paywall({ product, features }: {
  product: { code: string; name: string; price_kobo: number; access_days: number | null; description: string | null } | null;
  features: string[];
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!product) return <Card><p className="ink-2 text-sm">This section isn't on sale yet.</p></Card>;

  const buy = async () => {
    setBusy(true);
    try {
      const { authorizationUrl } = await api.checkout("product", product.code);
      window.location.assign(authorizationUrl);   // Paystack hosted checkout
    } catch (e) {
      toast(friendly(e), "error");
      setBusy(false);
    }
  };

  return (
    <Card className="overflow-hidden p-0 sm:p-0">
      <div className="bg-gradient-to-br from-brand-800 to-brand-600 p-6 text-white">
        <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><Icon name="lock" size={14} /> Locked</div>
        <h2 className="text-xl font-bold">{product.name}</h2>
        {product.description && <p className="mt-1 text-sm text-white/85">{product.description}</p>}
        <div className="mt-4 text-3xl font-bold">{naira(product.price_kobo)}</div>
        <div className="text-xs text-white/80">One-time payment · {product.access_days ? `${product.access_days} days access` : "No expiry"}</div>
      </div>
      <div className="p-6">
        <ul className="mb-5 space-y-2 text-sm">
          {features.map((f) => <li key={f} className="flex gap-2"><Icon name="checkCircle" size={18} className="shrink-0 text-brand-600" />{f}</li>)}
        </ul>
        <Button size="lg" className="w-full" onClick={buy} loading={busy}>Unlock for {naira(product.price_kobo)}</Button>
        <p className="ink-2 mt-3 text-center text-xs">Secure payment by Paystack (card, bank transfer, USSD). Access unlocks automatically once payment is confirmed.</p>
      </div>
    </Card>
  );
}
