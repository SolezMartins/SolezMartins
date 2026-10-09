/** Category from the discovered display name (no hard-coded instrument list); falls back to Deriv's submarket. */
export const categorize = (name: string, submarket = '') =>
  /volatil/i.test(name) ? 'Volatility' : /boom/i.test(name) ? 'Boom' : /crash/i.test(name) ? 'Crash' : /jump/i.test(name) ? 'Jump'
  : /range break/i.test(name) ? 'Range Break' : /step/i.test(name) ? 'Step' : /drift/i.test(name) ? 'Drift Switching' : submarket || 'Other';
export const slugify = (name: string) => name.toLowerCase().replace(/ index$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
