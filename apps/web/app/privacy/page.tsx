import type { Metadata } from 'next';
import Link from 'next/link';
import { GrievanceSection, LegalPage, LegalSection, LegalValue } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';
import { subscriptionBillingConfig } from '@/lib/billing';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${BRAND.name} collects, uses, and protects personal data.`,
};

const UPDATED = 'November 19, 2026';

export default function PrivacyPage() {
  const { graceDays, retentionDays } = subscriptionBillingConfig();
  return (
    <LegalPage title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains how <LegalValue value={LEGAL.entityName} />, which operates{' '}
        {BRAND.name} (“we”, “us”), collects, uses, stores, and
        shares information when you use our website, dashboard, APIs, and managed AI coding
        sandboxes (the “Service”). By using the Service, you acknowledge this policy.
      </p>

      <LegalSection title="1. Data controller / contact">
        <p>
          The data fiduciary / controller is <LegalValue value={LEGAL.entityName} />,{' '}
          <LegalValue value={LEGAL.registeredAddress} />. For privacy requests, email{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>{' '}
          or the grievance officer in section 13.
        </p>
      </LegalSection>

      <LegalSection title="2. Information we collect">
        <p className="font-medium text-zinc-200">Account and identity</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Email address and password (stored as a secure hash — we do not store plaintext passwords).</li>
          <li>Session cookies / tokens used to keep you signed in.</li>
          <li>Account identifiers and timestamps (created, last login where recorded).</li>
        </ul>
        <p className="font-medium text-zinc-200">Billing</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Subscription and payment status, sandbox size, paid-until and next-charge dates,
            Razorpay subscription, invoice, order and payment ids, currency, and amounts.
          </li>
          <li>
            Card, UPI and bank mandate details are collected and processed by Razorpay, our
            payment partner. We do not receive or store full card numbers, UPI PINs or bank
            credentials.
          </li>
        </ul>
        <p className="font-medium text-zinc-200">Service configuration</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Instance metadata (name, status, lifecycle events, pairing mode, Telegram bot
            configuration as you provide it).
          </li>
          <li>
            Secrets you supply (for example your own AI provider API keys and bot tokens) so we
            can write them into your sandbox and run your agents. Requests your agents send with
            your key go to that AI provider, which processes them and bills you under its own
            terms and privacy policy. Only paste keys you control.
          </li>
        </ul>
        <p className="font-medium text-zinc-200">Technical and usage</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>IP address, user agent, approximate location from IP, request logs, and error logs.</li>
          <li>Dashboard and API activity needed for security, abuse prevention, and support.</li>
        </ul>
        <p className="font-medium text-zinc-200">Sandbox content</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Code, files, agent memory, chat-related data, and processes inside your sandbox are
            processed to provide the Service. We do not use Your Content to train public foundation
            models. Third-party AI providers you configure may process prompts under their own
            policies.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. How we use information">
        <ul className="list-disc space-y-2 pl-5">
          <li>Create and secure accounts; authenticate sessions.</li>
          <li>Provision, manage, pause, wake, and destroy sandboxes you request.</li>
          <li>Process payments, prevent fraud, and fulfill access periods.</li>
          <li>Provide support, respond to abuse reports, and enforce our Terms.</li>
          <li>Operate, debug, and improve reliability and security of the Service.</li>
          <li>Send service-related messages (security, billing, material policy changes).</li>
          <li>Comply with law and lawful requests.</li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Legal bases (where applicable)">
        <p>
          Depending on your location, we rely on: performance of a contract (providing the
          Service you request); legitimate interests (security, fraud prevention, product
          improvement that does not override your rights); consent (where required, e.g. optional
          marketing); and legal obligation.
        </p>
      </LegalSection>

      <LegalSection title="5. Sharing">
        <p>We share data only as needed:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-zinc-200">Infrastructure providers</strong> — cloud hosts,
            database (e.g. MongoDB Atlas), logging, and sandbox compute partners that process data
            on our instructions.
          </li>
          <li>
            <strong className="text-zinc-200">Payment processors</strong> — Razorpay and banks for
            checkout, webhooks, and dispute handling.
          </li>
          <li>
            <strong className="text-zinc-200">You-directed third parties</strong> — LLM APIs,
            Telegram, and other services you configure; their processing is under your and their
            terms.
          </li>
          <li>
            <strong className="text-zinc-200">Legal and safety</strong> — when required by law,
            to protect rights, or in connection with a merger/acquisition with appropriate
            safeguards.
          </li>
        </ul>
        <p>We do not sell your personal information.</p>
      </LegalSection>

      <LegalSection title="6. International transfers">
        <p>
          Data may be processed in India and other countries where our providers operate (for
          example cloud regions). Where required, we use appropriate safeguards for cross-border
          transfers.
        </p>
      </LegalSection>

      <LegalSection title="7. Retention">
        <ul className="list-disc space-y-2 pl-5">
          <li>Account data: while your account is active and for a reasonable period after closure for legal, billing, and security needs.</li>
          <li>
            Paid sandboxes: kept while your subscription is paid. If a renewal fails, the sandbox
            keeps running for a {graceDays}-day grace period. After that, or once a cancelled
            subscription reaches the end of its paid period, the sandbox is paused and its files,
            settings and agent memory are kept for {retentionDays} days. After that the workspace is
            marked for deletion and may be permanently deleted. Paying again before deletion
            restores it.
          </li>
          <li>Payment and invoice records: as long as tax and financial regulations require (in India, generally at least 8 years).</li>
          <li>Logs: typically short operational windows unless needed for security investigations.</li>
          <li>Destroyed sandboxes: content is deleted according to provider lifecycle; backups may lag for a short period.</li>
        </ul>
      </LegalSection>

      <LegalSection title="8. Security">
        <p>
          We use industry-standard measures such as HTTPS, hashed passwords, access controls, and
          isolation of customer environments. No method of transmission or storage is 100% secure.
          You must protect API keys and bot tokens you paste into the Service.
        </p>
      </LegalSection>

      <LegalSection title="9. Cookies and similar tech">
        <p>
          We use a strictly necessary session cookie to keep you signed in, and browser local
          storage for preferences such as currency and cached chat state. When you pay, Razorpay
          Checkout loads from Razorpay and may set its own cookies for fraud prevention and
          payment processing under Razorpay’s privacy policy. We do not use advertising or
          cross-site tracking cookies. Blocking cookies stops sign-in from working.
        </p>
      </LegalSection>

      <LegalSection title="10. Your rights">
        <p>
          Depending on applicable law (including Indian IT rules and, where they apply, GDPR-like
          rights), you may request access, correction, deletion, or export of personal data we
          hold, or object to certain processing. Contact{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>
          . We may need to verify your identity and retain data where law requires.
        </p>
      </LegalSection>

      <LegalSection title="11. Children">
        <p>
          The Service is not directed to children under 18. We do not knowingly collect personal
          data from children. If you believe a child has registered, contact us to delete the
          account.
        </p>
      </LegalSection>

      <LegalSection title="12. Changes">
        <p>
          We may update this Privacy Policy. The “Last updated” date at the top will change when
          we do. Continued use after updates means you accept the revised policy.
        </p>
      </LegalSection>

      <GrievanceSection number={13} />

      <p className="text-sm text-zinc-500">
        Related:{' '}
        <Link href="/terms" className="text-orange-400 hover:underline">
          Terms &amp; Conditions
        </Link>
        {' · '}
        <Link href="/refund" className="text-orange-400 hover:underline">
          Refund &amp; Cancellation Policy
        </Link>
      </p>
    </LegalPage>
  );
}
