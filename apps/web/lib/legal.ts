/**
 * Legal identity used on /terms, /privacy and /refund.
 * Placeholders are deliberate: fill in the registered business details before
 * submitting the site for payment-gateway activation. Never guess them.
 */
export const LEGAL = {
  entityName: '[LEGAL ENTITY NAME]',
  registeredAddress: '[REGISTERED ADDRESS]',
  grievanceOfficerName: '[GRIEVANCE OFFICER NAME]',
  grievanceEmail: '[GRIEVANCE OFFICER EMAIL]',
  /** Existing support inbox shown across the site */
  supportEmail: 'hello@vectra.cloud',
} as const;

export function isLegalPlaceholder(value: string): boolean {
  return /^\[.+\]$/.test(value);
}
