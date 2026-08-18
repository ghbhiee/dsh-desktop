// Host-only no-op plugin (same shape as dsh-plugin-snake's host half, minus
// the client). Exists so e2e can install something harmless through the UI.

export const name = "e2e-probe";
export const inject = [];
export function apply(ctx) {}
