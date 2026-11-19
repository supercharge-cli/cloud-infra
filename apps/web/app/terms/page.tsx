import type { Metadata } from 'next';
import Link from 'next/link';
import { GrievanceSection, LegalPage, LegalSection, LegalValue } from '@/components/legal-page';
import { LEGAL } from '@/lib/legal';
import { subscriptionBillingConfig } from '@/lib/billing';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Terms & Conditions',
  description: `Terms & Conditions for ${BRAND.name} managed AI coding sandboxes.`,
};

const UPDATED = 'November 19, 2026';

export default function TermsPage() {
  const { graceDays, retentionDays } = subscriptionBillingConfig();
  return (
    <LegalPage title="Terms & Conditions" updated={UPDATED}>
      <p>
        These Terms &amp; Conditions (“Terms”) are an agreement between you and{' '}
        <LegalValue value={LEGAL.entityName} /> (“we”, “us”). They govern your access to and use of {BRAND.name} (the
        “Service”), including our website, dashboard, APIs, documentation, and managed cloud
        sandboxes. By creating an account, accessing the Service, or completing a payment, you
        agree to these Terms.
      </p>
      <p className="text-zinc-400">
        If you do not agree, do not use the Service. The Service is proprietary and closed source.
      </p>

      <LegalSection title="1. Who we are">
        <p>
          {BRAND.name} provides managed AI agent infrastructure: cloud sandboxes in several sizes
          (from 2 vCPU / 4 GB) with agent software preinstalled, configuration tooling,
          optional Telegram pairing, and billing via our payment processor. Contact:{' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Eligibility and accounts">
        <ul className="list-disc space-y-2 pl-5">
          <li>You must be at least 18 years old (or the age of majority where you live).</li>
          <li>You must provide accurate registration information and keep it updated.</li>
          <li>
            You are responsible for safeguarding your credentials and for all activity under your
            account.
          </li>
          <li>
            We may suspend or terminate accounts that violate these Terms, fail payment checks, or
            pose risk to the Service or other users.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="3. The Service">
        <p>
          We grant you a limited, non-exclusive, non-transferable, revocable right to use the
          Service for lawful purposes during periods for which you have valid access (including
          free trial features, if any, and paid access windows after successful payment).
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Sandboxes are provisioned according to plan limits and availability. Capacity,
            regions, and features may change.
          </li>
          <li>
            You may configure third-party credentials (for example LLM API keys, Telegram bot
            tokens). Those credentials remain yours; we use them only to operate the Service for
            you as described in our{' '}
            <Link href="/privacy" className="text-orange-400 hover:underline">
              Privacy Policy
            </Link>
            .
          </li>
          <li>
            Idle or lifecycle management (pause, cycle, wake) may be applied to control cost and
            stability. You are responsible for saving important work and not relying solely on
            ephemeral sandbox state.
          </li>
          <li>
            Destroying an instance permanently deletes that sandbox environment. That action
            cannot be undone.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Plans, autopay and cancellation">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Each account gets one free base workspace. Paid sandboxes are monthly subscriptions
            for the size you choose, billed in advance through our payment partner, Razorpay.
            Prices and currency are shown before you pay and include or state applicable taxes.
          </li>
          <li>
            <strong className="text-zinc-200">Subscriptions renew automatically</strong> each month
            using the card, UPI Autopay or e-mandate you approved, until you cancel. By subscribing
            you authorise these recurring charges. Recurring payments follow RBI rules, so your
            bank or UPI app may ask you to approve the mandate or notify you before charges.
          </li>
          <li>
            You can cancel anytime from the dashboard billing card. You keep access until the end
            of the paid period and are not charged again.
          </li>
          <li>
            Size changes: upgrades apply now, downgrades at the next renewal. UPI Autopay and
            e-mandate subscriptions cannot be changed; cancel and subscribe again.
          </li>
          <li>
            If a renewal fails, access continues for a {graceDays}-day grace period while payment is
            retried. After that, or when a cancelled subscription reaches its end, the sandbox is
            paused. A paused workspace is kept for {retentionDays} days and may then be deleted.
            An upgraded free workspace returns to the free base instead of being paused.
          </li>
          <li>
            Paid periods bought as one-off payments before autopay keep their end date and do not
            renew unless you subscribe.
          </li>
          <li>
            Charges are not refunded, except as described in our{' '}
            <Link href="/refund" className="text-orange-400 hover:underline">
              Refund &amp; Cancellation Policy
            </Link>{' '}
            (including reversal of duplicate or erroneous charges and your statutory rights).
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4A. Your own AI provider keys">
        <p>
          The Service runs agents with AI model access that you supply (“bring your own key”),
          such as an API key for OpenAI, Anthropic, OpenRouter, Google, xAI, Pollinations or
          another provider. You are responsible for:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>having the right to use each key and complying with that provider’s terms;</li>
          <li>
            all usage and charges billed by your AI provider, including usage caused by agents,
            routines or automations you set up. Our subscription price covers the sandbox only;
          </li>
          <li>keeping keys secret and revoking any key you think was exposed.</li>
        </ul>
        <p>
          We keep keys on our servers and in your sandbox and use them only to run your agents.
          We are not liable for provider outages, model output, rate limits or provider charges.
        </p>
      </LegalSection>

      <LegalSection title="5. Acceptable use">
        <p>You agree not to:</p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Use the Service for illegal activity, fraud, malware, unauthorized access, or abuse of
            third-party systems.
          </li>
          <li>
            Attempt to probe, disrupt, reverse engineer (except where law forbids that
            restriction), or circumvent security or billing of the Service.
          </li>
          <li>
            Mine cryptocurrency, run bulk spam, open proxies for abuse, or overload shared
            infrastructure beyond normal agent-coding workloads without our written consent.
          </li>
          <li>
            Infringe intellectual property or privacy rights of others, or upload unlawful content.
          </li>
          <li>
            Resell, sublicense, or white-label the Service except under a separate written
            agreement.
          </li>
          <li>
            Misrepresent affiliation with XibeCode, other open-source projects, or third-party
            brands.
          </li>
        </ul>
        <p>
          We may investigate and take technical or legal action for violations, including
          suspension without refund where allowed by our Refund &amp; Cancellation Policy.
        </p>
      </LegalSection>

      <LegalSection title="6. Your content and third-party services">
        <p>
          You retain ownership of code, prompts, files, and data you put into sandboxes or the
          dashboard (“Your Content”). You grant us a limited license to host, process, transmit,
          and back up Your Content solely to provide and secure the Service.
        </p>
        <p>
          The Service may integrate with third parties (payment processors, LLM providers,
          Telegram, infrastructure providers). Their terms and privacy policies apply to those
          services. We are not responsible for third-party outages, model behavior, or content
          generated by AI tools you configure.
        </p>
      </LegalSection>

      <LegalSection title="7. Intellectual property">
        <p>
          {BRAND.name}, our branding, dashboard UI, gateway, documentation (except third-party
          open-source components), and related materials are owned by us or our licensors. Open
          source agent engines or libraries used inside sandboxes remain under their own licenses;
          hosting does not transfer those rights to you beyond what those licenses allow.
        </p>
      </LegalSection>

      <LegalSection title="8. Availability and changes">
        <p>
          We aim for reliable operation but do not guarantee uninterrupted or error-free Service.
          We may modify features, limits, pricing, or these Terms. Material changes will be
          reflected by updating the “Last updated” date on this page (and, where practical, notice
          via the site or email). Continued use after changes constitutes acceptance.
        </p>
      </LegalSection>

      <LegalSection title="9. Disclaimers">
        <p className="uppercase tracking-wide text-zinc-400">
          The Service is provided “as is” and “as available” without warranties of any kind,
          whether express, implied, or statutory, including merchantability, fitness for a
          particular purpose, and non-infringement. AI agents may produce incorrect or harmful
          output; you must review and supervise agent actions.
        </p>
      </LegalSection>

      <LegalSection title="10. Limitation of liability">
        <p>
          To the maximum extent permitted by law, we and our suppliers are not liable for
          indirect, incidental, special, consequential, or punitive damages, or for lost profits,
          data, goodwill, or business interruption. Our total liability for any claim relating to
          the Service is limited to the amounts you paid us for the Service in the three (3)
          months before the claim (or ₹1,000 / $12 if greater would still apply under applicable
          law as a minimum floor where required).
        </p>
      </LegalSection>

      <LegalSection title="11. Indemnity">
        <p>
          You will defend and indemnify us against claims arising from Your Content, your use of
          the Service, your third-party credentials/integrations, or your violation of these Terms
          or law.
        </p>
      </LegalSection>

      <LegalSection title="12. Termination">
        <p>
          You may stop using the Service at any time. We may suspend or terminate access for
          breach, non-payment, legal risk, or Service discontinuation. Provisions that by nature
          should survive (including ownership, disclaimers, liability limits, refund policy, and
          indemnity) survive termination.
        </p>
      </LegalSection>

      <LegalSection title="13. Governing law">
        <p>
          These Terms are governed by the laws of India, without regard to conflict-of-law rules.
          Courts in India shall have exclusive jurisdiction, subject to mandatory consumer
          protections that cannot be waived in your place of residence.
        </p>
      </LegalSection>

      <GrievanceSection number={14} />

      <p className="text-sm text-zinc-500">
        Related:{' '}
        <Link href="/privacy" className="text-orange-400 hover:underline">
          Privacy Policy
        </Link>
        {' · '}
        <Link href="/refund" className="text-orange-400 hover:underline">
          Refund &amp; Cancellation Policy
        </Link>
      </p>
    </LegalPage>
  );
}
