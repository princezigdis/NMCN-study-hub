import { useEffect, useState } from "react";
import { useAI } from "../../components/ai/AIContext";
import { Icon } from "../../components/Icon";
import { Button, Card, Spinner } from "../../components/ui";
import { api } from "../../lib/api";
import { friendly } from "../../lib/errors";
import { Link, useSearchParams } from "../../lib/router";

/** Paystack redirects here. We confirm with our server (which asks Paystack), never trusting the URL alone. */
export default function PaymentCallbackPage() {
  const [params] = useSearchParams();
  const reference = params.get("reference") ?? params.get("trxref") ?? "";
  const { refreshWallet } = useAI();
  const [state, setState] = useState<{ status: string; purpose?: string; item?: string; error?: string }>({ status: "checking" });

  useEffect(() => {
    let tries = 0;
    let cancelled = false;
    const check = async () => {
      try {
        const r = await api.verifyPayment(reference);
        if (cancelled) return;
        if (r.status === "pending" && tries++ < 6) { setTimeout(check, 3000); return; }
        setState(r);
        if (r.status === "success") refreshWallet();
      } catch (e) {
        if (!cancelled) setState({ status: "error", error: friendly(e) });
      }
    };
    if (reference) check(); else setState({ status: "error", error: "No payment reference was provided." });
    return () => { cancelled = true; };
  }, [reference, refreshWallet]);

  const dest = state.purpose === "ai_plan" ? "/plans" : state.item === "section_d" ? "/final" : "/mock";
  return (
    <div className="mx-auto max-w-md py-12">
      <Card className="text-center">
        {state.status === "checking" || state.status === "pending" ? (
          <><Spinner size={32} className="mx-auto text-brand-600" /><h1 className="mt-4 text-lg font-semibold">Confirming your payment…</h1><p className="ink-2 mt-1 text-sm">This usually takes a few seconds.</p></>
        ) : state.status === "success" ? (
          <><Icon name="checkCircle" size={40} className="mx-auto text-emerald-600" /><h1 className="mt-3 text-lg font-semibold">Payment confirmed</h1>
            <p className="ink-2 mt-1 text-sm">{state.purpose === "ai_plan" ? "Your AI credits have been added." : "Your exam section is now unlocked."}</p>
            <Link to={dest}><Button className="mt-5">Continue</Button></Link></>
        ) : (
          <><Icon name="alert" size={40} className="mx-auto text-amber-600" /><h1 className="mt-3 text-lg font-semibold">Payment not completed</h1>
            <p className="ink-2 mt-1 text-sm">{state.error ?? `Status: ${state.status.replace(/_/g, " ")}. If money left your account, contact support with reference ${reference}.`}</p>
            <div className="mt-5 flex justify-center gap-2"><Link to={dest}><Button variant="secondary">Back</Button></Link><Link to="/support"><Button>Contact support</Button></Link></div></>
        )}
      </Card>
    </div>
  );
}
