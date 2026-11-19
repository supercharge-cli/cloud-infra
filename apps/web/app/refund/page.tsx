import type { Metadata } from 'next';
import Link from 'next/link';
import { GrievanceSection, LegalPage, LegalSection } from '@/components/legal-page';
import { BRAND } from '@/lib/brand';
import { LEGAL } from '@/lib/legal';
import { subscriptionBillingConfig } from '@/lib/billing';

export const metadata: Metadata = {
  title: 'Refund & Cancellation Policy',
  description: `How cancellation, renewals and refunds work for ${BRAND.name} sandboxes.`,
};

const UPDATED = 'November 19, 2026';

export default function RefundPage() {
  const { graceDays, retentionDays } = subscriptionBillingConfig();
  return (
    <LegalPage title="Refund & Cancellation Policy" updated={UPDATED}>
      <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 px-4 py-3 text-sm text-orange-100/90">
        <strong className="font-semibold text-orange-400">In short:</strong> subscription charges
        are not refunded. You can cancel anytime from the dashboard; you keep your sandbox until the
        end of the period you already paid for, and you are not charged again.
      </div>

      <p>
        This policy is part of our{' '}
        <Link href="/terms" className="text-orange-400 hover:underline">
          Terms &amp; Conditions
        </Link>
        . It applies to monthly autopay subscriptions and to one-off paid periods bought before
        autopay was available.
      </p>

      <LegalSection title="1. What you pay for">
        <p>
          A paid plan is a monthly subscription for one cloud sandbox of the size you choose. Each
          charge pays for one billing period (one month) of that sandbox, starting when the charge
          succeeds. Prices are shown in INR (and USD where offered) before you pay. The sandbox is
          a digital service that starts immediately.
        </p>
      </LegalSection>

      <LegalSection title="2. Automatic renewal">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Subscriptions renew automatically every month through our payment partner, Razorpay,
            using the card, UPI Autopay or e-mandate you approved at checkout.
          </li>
          <li>
            The dashboard shows your next charge date. Razorpay, your bank or your UPI app may also
            notify you before a charge, as required by RBI rules on recurring payments.
          </li>
          <li>
            You can change size from the dashboard. Upgrades apply immediately; downgrades apply at
            the next renewal. UPI Autopay and e-mandate subscriptions cannot be changed; cancel and
            subscribe again at the new size.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How to cancel">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Open the{' '}
            <Link href={`${BRAND.dashboard}?billing=1`} className="text-orange-400 hover:underline">
              dashboard billing card
            </Link>{' '}
            and choose <strong className="text-zinc-200">Cancel subscription</strong>, then confirm.
            You can also cancel the mandate in your UPI app or with your bank.
          </li>
          <li>
            Cancellation stops all future charges. Your sandbox keeps working until the end of the
            current paid period, then it is paused.
          </li>
          <li>
            After it is paused we keep your files and settings for {retentionDays} days so you can subscribe again
            and continue. After that the workspace may be permanently deleted.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. No refunds">
        <p>Charges that have gone through are not refunded or pro-rated, including when:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>you cancel partway through a period, or did not use the sandbox;</li>
          <li>
            you picked the wrong size, currency or workspace, or forgot to cancel before a renewal;
          </li>
          <li>you destroy the sandbox or close your account before the period ends;</li>
          <li>
            AI model quality, your own API keys or AI provider, Telegram or other third-party
            services did not work as you hoped;
          </li>
          <li>your account was suspended for breaking our Terms.</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Errors we will reverse">
        <p>
          If you are charged twice for the same period, charged after a cancellation took effect,
          or charged without the paid period being applied, because of an error in our system or
          the payment system, we will reverse the erroneous charge in full to the original payment
          method once we confirm it. Reversals usually reach you in 5–7 working days after we
          approve them, depending on your bank.
        </p>
        <p>
          To report one, email{' '}
          <a href={`mailto:${LEGAL.supportEmail}`} className="text-orange-400 hover:underline">
            {LEGAL.supportEmail}
          </a>{' '}
          with your account email, the date and amount, and the Razorpay payment id if you have it.
        </p>
      </LegalSection>

      <LegalSection title="6. Failed payments">
        <p>
          If a renewal fails, Razorpay retries it. Your sandbox keeps working for a {graceDays}-day
          grace period. If payment still fails, the sandbox is paused, and the {retentionDays}-day retention in §3
          applies. Paying the due amount resumes it.
        </p>
      </LegalSection>

      <LegalSection title="7. Your statutory rights">
        <p>
          Nothing in this policy limits rights you have under applicable law that cannot be
          waived, including the Consumer Protection Act, 2019 and the Consumer Protection
          (E-Commerce) Rules, 2020. Where such a law requires a refund or another remedy, we will
          provide it.
        </p>
      </LegalSection>

      <GrievanceSection number={8} />

      <p className="text-sm text-zinc-500">
        Related:{' '}
        <Link href="/terms" className="text-orange-400 hover:underline">
          Terms &amp; Conditions
        </Link>
        {' · '}
        <Link href="/privacy" className="text-orange-400 hover:underline">
          Privacy Policy
        </Link>
      </p>
    </LegalPage>
  );
}
