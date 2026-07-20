import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage, LegalSection } from '@/components/legal-page';
import { BRAND } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `Terms of Service for ${BRAND.name} managed AI coding sandboxes.`,
};

const UPDATED = 'July 20, 2026';

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms of Service (“Terms”) govern your access to and use of {BRAND.name} (the
        “Service”), including our website, dashboard, APIs, documentation, and managed cloud
        sandboxes. By creating an account, accessing the Service, or completing a payment, you
        agree to these Terms.
      </p>
      <p className="text-zinc-400">
        If you do not agree, do not use the Service. The Service is proprietary and closed source.
      </p>

      <LegalSection title="1. Who we are">
        <p>
          {BRAND.name} provides managed AI coding infrastructure: cloud sandboxes (typically 4
          vCPU / 8 GB class machines) with agent software preinstalled, configuration tooling,
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

      <LegalSection title="4. Billing and payments">
        <p>
          Paid plans are charged per instance for a defined access period (for example 30 days)
          after successful payment through our payment partner (Razorpay). Prices, currencies
          (INR/USD), and period length are shown at checkout and may be updated from time to time.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Sandboxes are not provisioned (or renewed) until payment succeeds.</li>
          <li>
            Multiple instances require separate payments unless we expressly offer otherwise.
          </li>
          <li>
            Taxes, FX conversion, and bank fees may apply and are your responsibility where
            applicable.
          </li>
          <li>
            All sales are subject to our{' '}
            <Link href="/refund" className="text-orange-400 hover:underline">
              Refund Policy
            </Link>{' '}
            (strict no-refund / limited exception rules).
          </li>
        </ul>
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
          suspension without refund where allowed by our Refund Policy.
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

      <LegalSection title="14. Contact">
        <p>
          Legal and support: {' '}
          <a href="mailto:hello@vectra.cloud" className="text-orange-400 hover:underline">
            hello@vectra.cloud
          </a>
        </p>
        <p className="text-sm text-zinc-500">
          Related:{' '}
          <Link href="/privacy" className="text-orange-400 hover:underline">
            Privacy Policy
          </Link>
          {' · '}
          <Link href="/refund" className="text-orange-400 hover:underline">
            Refund Policy
          </Link>
        </p>
      </LegalSection>
    </LegalPage>
  );
}
