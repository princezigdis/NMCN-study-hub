import type { ReactNode } from "react";
import { Link } from "../../lib/router";
import { APP_NAME } from "../../lib/supabase";

export const SUPPORT_EMAIL = "support@nmcnstudy.app";
export type LegalKind = "terms" | "privacy" | "credits" | "refunds";

const P = ({ children }: { children: ReactNode }) => <p className="mb-3 text-sm leading-relaxed">{children}</p>;
const H = ({ children }: { children: ReactNode }) => <h2 className="mb-2 mt-6 text-base font-semibold">{children}</h2>;
const UL = ({ items }: { items: string[] }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-sm leading-relaxed">{items.map((i) => <li key={i}>{i}</li>)}</ul>;

const DOCS: Record<LegalKind, { title: string; body: ReactNode }> = {
  terms: {
    title: "Terms of Service",
    body: (<>
      <P>Welcome to {APP_NAME}. By creating an account or using the app you agree to these terms.</P>
      <H>1. Who the app is for</H>
      <P>{APP_NAME} is an exam-preparation platform for Nigerian nursing (RN) and midwifery (RM) students. You must provide accurate registration details and keep your password private. One account belongs to one person.</P>
      <H>2. Your study track</H>
      <P>You choose either the RN or the RM track when you register. The track is then locked to your account. You may switch to the other track later for a one-time fee shown on your profile page.</P>
      <H>3. Content and acceptable use</H>
      <UL items={[
        "Notes, questions and rationales are provided for personal study only.",
        "Do not copy, resell, scrape or redistribute the content.",
        "Do not share your account or try to bypass credit, payment or access limits.",
        "Practice questions are study aids and do not replace your school textbooks or official NMCN guidance.",
      ]} />
      <H>4. AI features</H>
      <P>AI tools use credits and may produce answers that need checking against your approved notes. Never enter patient-identifiable information.</P>
      <H>5. Payments</H>
      <P>Paid items are processed securely by Paystack. See the Payment &amp; Refund Policy and the Credit Usage Policy for details.</P>
      <H>6. Suspension</H>
      <P>We may suspend accounts that break these terms or abuse the service.</P>
      <H>7. Changes and contact</H>
      <P>We may update these terms and will show the latest version here. Questions? Email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</P>
    </>),
  },
  privacy: {
    title: "Privacy Policy",
    body: (<>
      <P>We respect your privacy. This page explains what we collect and why.</P>
      <H>What we collect</H>
      <UL items={[
        "Account details: name, email, study track and school.",
        "Study activity: practice and exam attempts, bookmarks, notes and flashcards you create.",
        "Payment records: reference, amount and status. Card details go directly to Paystack and are never stored by us.",
        "Text you select for AI help, so we can answer and prevent abuse.",
      ]} />
      <H>How we use it</H>
      <P>To run the app, track your progress, process payments, give support and keep the service secure. We do not sell your personal data.</P>
      <H>Sharing</H>
      <P>We share data only with service providers needed to run the app (hosting, payments, email and AI processing) and when the law requires it.</P>
      <H>Your choices</H>
      <P>You can update your profile at any time. To request a copy or deletion of your data, email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</P>
      <H>Patient information</H>
      <P>Please never type real patient names or identifiers into notes or AI tools.</P>
    </>),
  },
  credits: {
    title: "Credit Usage Policy",
    body: (<>
      <P>AI features run on credits. Each plan includes a monthly credit allowance.</P>
      <H>How credits are charged</H>
      <UL items={[
        "Each AI action has a credit cost, shown before you confirm.",
        "Simple actions such as explanations cost fewer credits than image or diagram generation.",
        "A free-text request for a diagram or illustration costs 20 credits.",
        "Credits are reserved when you submit a request.",
      ]} />
      <H>Failed requests</H>
      <P>If an AI request fails on our side, the credits are returned to your wallet automatically.</P>
      <H>Running out</H>
      <P>If you do not have enough credits you will be offered an upgrade. Credits renew with your plan period.</P>
      <H>Questions</H>
      <P>Email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</P>
    </>),
  },
  refunds: {
    title: "Payment & Refund Policy",
    body: (<>
      <P>All payments are made in Nigerian Naira (NGN) through Paystack.</P>
      <H>What you can buy</H>
      <UL items={[
        "Section C (Mock) and Section D (Final) access.",
        "AI credit plans.",
        "A one-time track switch between RN and RM.",
      ]} />
      <H>Confirmation</H>
      <P>Access is granted only after Paystack confirms your payment to our server. If you were charged but nothing unlocked, wait a few minutes, then contact support with your payment reference.</P>
      <H>Refunds</H>
      <UL items={[
        "Duplicate or failed-delivery charges are refunded in full once verified.",
        "Used AI credits and delivered digital access are generally not refundable.",
        "Refund requests must be sent within 7 days of payment.",
      ]} />
      <H>How to ask</H>
      <P>Open Help &amp; support in the app or email <a className="underline" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> with your payment reference.</P>
    </>),
  },
};

export const LEGAL_LINKS: [string, string][] = [
  ["/legal/terms", "Terms"], ["/legal/privacy", "Privacy"], ["/legal/credits", "Credit usage"], ["/legal/refunds", "Payments & refunds"],
];

export default function LegalPage({ kind }: { kind: LegalKind }) {
  const d = DOCS[kind];
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="mb-4 inline-block text-sm underline">← Back to {APP_NAME}</Link>
      <h1 className="text-2xl font-bold">{d.title}</h1>
      <p className="ink-2 mb-4 text-xs">Last updated: November 2026</p>
      {d.body}
      <nav className="ink-2 mt-8 flex flex-wrap gap-x-4 gap-y-1 border-t line pt-4 text-xs">
        {LEGAL_LINKS.map(([to, l]) => <Link key={to} to={to} className="underline">{l}</Link>)}
      </nav>
    </div>
  );
}
