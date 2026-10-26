// User-maintained account markers; these do not change provider billing.
export const PROVIDER_BILLING_TYPES = {
  unmarked: 'billingUnmarked',
  free: 'billingFree',
  paid: 'billingPaid',
  quota: 'billingQuota',
  credits: 'billingCredits'
};

const DEFAULT_PROVIDER_BILLING_TYPES = {
  claude: 'quota',
  stepfun: 'quota',
  agnes: 'credits',
  'hy-aistudio': 'quota'
};

export function getProviderBillingType(providerId, overrides) {
  const value = overrides?.[providerId];
  if (typeof value === 'string' && Object.hasOwn(PROVIDER_BILLING_TYPES, value)) {
    return value;
  }
  return Object.hasOwn(DEFAULT_PROVIDER_BILLING_TYPES, providerId)
    ? DEFAULT_PROVIDER_BILLING_TYPES[providerId]
    : 'unmarked';
}
