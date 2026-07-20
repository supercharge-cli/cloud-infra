import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/legal-page';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Refund Policy',
  description: `No-refund and limited exception rules for ${BRAND.name} billing.`,
};

const UPDATED = 'July 20, 2026';

export default function RefundPage() {
  return (
    <LegalPage title="Refund Policy" updated={UPDATED}>
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100/90">
        <strong className="font-semibold text-orange-400">All sales are final.</strong>{' '}
        {BRAND.name} is a digital, on-demand infrastructure product. Except as required by
        mandatory law or the narrow cases below, we do not offer refunds, credits, or chargebacks
        for completed payments.
      </div>

      <p>
        This Refund Policy is part of our{' '}
        <Link href="/terms" className="text-orange-400 hover:underline">
          Terms of Service
        </Link>
        . By paying for an instance or renewal, you acknowledge that you have read and accept this
        policy.
      </p>

      <LegalSection title="1. What you are buying">
        <p>
          Each successful payment unlocks access to one managed sandbox (or extends an existing
          instance’s paid period) for the period shown at checkout (typically 30 days). Pricing
          may be shown in INR and/or USD. Compute and agent capacity are digital services that
          begin when payment succeeds and provisioning starts.
        </p>
      </LegalSection>

      <LegalSection title="2. No refunds (default rule)">
        <p>We do not refund or pro-rate for:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Change of mind, unused time, or “I didn’t need it after all.”</li>
          <li>
            Partial period use — including early destroy of an instance, pause, or not connecting
            Telegram / API keys.
          </li>
          <li>
            Mistaken plan, wrong currency selection, or accidental double purchase (see §4 for how
            to ask about goodwill cases).
          </li>
          <li>
            Dissatisfaction with AI model quality, third-party APIs, Telegram, or your own agent
            prompts and code.
          </li>
          <li>
            Account suspension or termination for Terms violations, abuse, fraud, or illegal use.
          </li>
          <li>
            Outages or performance issues of third-party providers (LLM vendors, Telegram, payment
            networks) outside our reasonable control.
          </li>
          <li>
            Loss of data after you destroy an instance or after normal lifecycle cleanup of
            ephemeral sandbox state.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Limited exceptions">
        <p>
          Without limiting the default no-refund rule, we may — solely at our discretion — issue a
          refund or credit when:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-zinc-200">Duplicate charge clearly on us</strong> — the same
            order was charged twice due to a confirmed payment-system error on our side, and you
            contact us promptly with proof.
          </li>
          <li>
            <strong className="text-zinc-200">Payment succeeded but we never granted access</strong>{' '}
            — after you open a support request with order/payment id and account email, we confirm
            no paid period was applied and cannot resolve by granting access.
          </li>
          <li>
            <strong className="text-zinc-200">Mandatory consumer law</strong> — where a non-waivable
            statute requires a remedy (we will comply with that law only to the extent required).
          </li>
        </ul>
        <p>
          Service credits (extended paid-until), if offered, are not cash and have no residual
          value after account closure unless we say otherwise in writing.
        </p>
      </LegalSection>

      <LegalSection title="4. How to request a review">
        <p>
          Email{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>{' '}
          within <strong className="text-zinc-200">7 days</strong> of the charge with:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Account email</li>
          <li>Approximate payment time and amount / currency</li>
          <li>Razorpay payment or order id if available</li>
          <li>Instance id (if any) and a short description of the issue</li>
        </ul>
        <p>
          We will investigate in good faith. Opening a bank chargeback without contacting us first
          may delay resolution and can result in account suspension while the dispute is open.
        </p>
      </LegalSection>

      <LegalSection title="5. Renewals and cancellations">
        <p>
          Access ends when the paid-until date passes unless you renew. Destroying an instance or
          closing your account does not automatically refund remaining days. Cancel by not
          renewing; there is no long-term subscription lock-in beyond the current paid period
          unless we introduce auto-renew and you opt in.
        </p>
      </LegalSection>

      <LegalSection title="6. Pricing changes">
        <p>
          Future prices may change. Amounts already paid for a current period are not adjusted
          upward or downward mid-period solely because list prices change.
        </p>
      </LegalSection>

      <LegalSection title="7. Contact">
        <p>
          Billing support:{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>
        </p>
        <p className="text-sm text-zinc-500">
          Related:{' '}
          <Link href="/terms" className="text-orange-400 hover:underline">
            Terms of Service
          </Link>
          {' · '}
          <Link href="/privacy" className="text-orange-400 hover:underline">
            Privacy Policy
          </Link>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
