// Example sign-in for axe-pages.mjs (set "signIn": "sign-in.example.mjs" in pages.json).
// Signs a Playwright browser context in as a demo user against a LOCAL app only.
// Return true when signed in. Never use real accounts or production.
export default async function signIn(context, base) {
  const response = await context.request.post(`${base}/api/dev/sign-in`, { data: { user: 'demo-admin' } });
  return response.ok();
}
