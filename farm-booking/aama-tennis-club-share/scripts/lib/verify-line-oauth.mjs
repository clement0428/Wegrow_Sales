// Structural, exact-match verification of LINE's OAuth redirect URL.
// Extracted into its own module so it has a direct, standalone test suite
// (tests/scripts/verify-line-oauth.test.ts) instead of only being exercised
// indirectly through a full postdeploy run against production.
//
// Never does a substring/`includes` search on the raw or decoded URL string —
// every field is extracted by exact key from the correct nesting layer via
// URL/URLSearchParams, then compared with `===`. A prior version of this
// check used `decodedUrl.includes(...)`, which independently reproduced as a
// false PASS for both a wrong app_id (suffix appended) and a spoofed
// redirect_uri domain (suffix appended) — see 2026-09-18 second code review.
//
// A THIRD round of review (same day) found the rewrite still had three gaps,
// each independently reproduced before fixing:
//   1. outer.pathname was never checked — a redirect to any other path on
//      access.line.me still passed as long as returnUri parsed.
//   2. returnUri's own path segment (before its `?`) was never validated —
//      it could be an absolute URL to a different host entirely
//      ("https://evil.example.org/consent?app_id=...&redirect_uri=...")
//      and still pass, because only the query portion was ever parsed out.
//   3. redirect_uri's query string was ignored entirely — an attacker-
//      controlled extra param alongside the legitimate `liff.state` still
//      passed.
// All three are now hard-checked below against the exact values observed in
// a real (redacted) production capture. If LINE changes this internal path
// shape, this check should start failing loudly rather than silently
// widening to accept it — update EXPECTED_LOGIN_PATHNAME /
// EXPECTED_RETURN_URI_PATHNAME deliberately, not by relaxing the check.
const EXPECTED_LOGIN_PATHNAME = "/oauth2/v2.1/login";
const EXPECTED_RETURN_URI_PATHNAME = "/oauth2/v2.1/authorize/consent";
// The only query key our own app's redirect_uri is expected to carry. LIFF
// appends this to tell the app which route to resume after login; nothing
// else should be riding along on it.
const ALLOWED_REDIRECT_QUERY_KEYS = ["liff.state"];

export function verifyLineOAuthRedirect(finalUrl, expectedLiffId, expectedClientId, siteUrl) {
  let outer;
  try {
    outer = new URL(finalUrl);
  } catch {
    return { ok: false, reason: `final URL is not parseable: ${finalUrl}` };
  }
  if (outer.protocol !== "https:") return { ok: false, reason: `expected https:, got ${outer.protocol} (${finalUrl})` };
  if (outer.hostname !== "access.line.me") {
    return { ok: false, reason: `expected host exactly "access.line.me", got ${JSON.stringify(outer.hostname)} (${finalUrl})` };
  }
  if (outer.pathname !== EXPECTED_LOGIN_PATHNAME) {
    return { ok: false, reason: `expected outer pathname exactly ${JSON.stringify(EXPECTED_LOGIN_PATHNAME)}, got ${JSON.stringify(outer.pathname)} (${finalUrl})` };
  }
  if (outer.username || outer.password) return { ok: false, reason: `URL contains userinfo credentials, rejecting (${finalUrl})` };

  const returnUriValues = outer.searchParams.getAll("returnUri");
  if (returnUriValues.length !== 1) {
    return { ok: false, reason: `expected exactly one returnUri query param, found ${returnUriValues.length} (${finalUrl})` };
  }
  const returnUri = returnUriValues[0];
  const qIdx = returnUri.indexOf("?");
  if (qIdx === -1) {
    return { ok: false, reason: `returnUri has no query segment to read app_id/redirect_uri from: ${JSON.stringify(returnUri)}` };
  }
  const returnUriPath = returnUri.slice(0, qIdx);
  // returnUri must be a bare relative path on access.line.me itself, never an
  // absolute URL to another host. Reject on scheme markers as a first-pass
  // guard, then require an exact match against the known LINE-internal path —
  // this closes both "different path" and "absolute URL to a different host"
  // in one check, since an absolute-URL value can never equal the expected
  // bare path string.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(returnUriPath) || returnUriPath.startsWith("//")) {
    return { ok: false, reason: `returnUri's path looks like an absolute URL, not a relative path on access.line.me: ${JSON.stringify(returnUriPath)}` };
  }
  if (returnUriPath !== EXPECTED_RETURN_URI_PATHNAME) {
    return { ok: false, reason: `returnUri path is ${JSON.stringify(returnUriPath)}, expected exactly ${JSON.stringify(EXPECTED_RETURN_URI_PATHNAME)}` };
  }
  let innerParams;
  try {
    innerParams = new URLSearchParams(returnUri.slice(qIdx + 1));
  } catch {
    return { ok: false, reason: `returnUri's query segment failed to parse: ${JSON.stringify(returnUri)}` };
  }

  const appIdValues = innerParams.getAll("app_id");
  if (appIdValues.length !== 1) return { ok: false, reason: `expected exactly one app_id in returnUri, found ${appIdValues.length}` };
  if (appIdValues[0] !== expectedLiffId) {
    return { ok: false, reason: `app_id is ${JSON.stringify(appIdValues[0])}, expected exactly ${JSON.stringify(expectedLiffId)}` };
  }

  if (expectedClientId) {
    const clientIdValues = innerParams.getAll("client_id");
    if (clientIdValues.length !== 1) return { ok: false, reason: `expected exactly one client_id in returnUri, found ${clientIdValues.length}` };
    if (clientIdValues[0] !== expectedClientId) {
      return {
        ok: false,
        reason: `client_id is ${JSON.stringify(clientIdValues[0])}, expected exactly ${JSON.stringify(expectedClientId)} (derived from the LIFF ID's channel prefix)`,
      };
    }
  }

  const redirectUriValues = innerParams.getAll("redirect_uri");
  if (redirectUriValues.length !== 1) return { ok: false, reason: `expected exactly one redirect_uri in returnUri, found ${redirectUriValues.length}` };
  let redirectUri;
  try {
    redirectUri = new URL(redirectUriValues[0]);
  } catch {
    return { ok: false, reason: `redirect_uri is not a parseable URL: ${JSON.stringify(redirectUriValues[0])}` };
  }
  if (redirectUri.username || redirectUri.password) {
    return { ok: false, reason: `redirect_uri contains userinfo credentials, rejecting` };
  }
  let expectedSite;
  try {
    expectedSite = new URL(siteUrl);
  } catch {
    return { ok: false, reason: `configured siteUrl is not a valid URL: ${siteUrl}` };
  }
  if (redirectUri.origin !== expectedSite.origin) {
    return { ok: false, reason: `redirect_uri origin ${JSON.stringify(redirectUri.origin)} does not exactly match expected ${JSON.stringify(expectedSite.origin)}` };
  }
  if (redirectUri.pathname !== expectedSite.pathname) {
    return { ok: false, reason: `redirect_uri pathname ${JSON.stringify(redirectUri.pathname)} does not exactly match expected ${JSON.stringify(expectedSite.pathname)}` };
  }
  // Explicit allowlist for redirect_uri's own query string: only liff.state
  // may ride along. Any other key — attacker-controlled or otherwise — fails.
  // liff.state's VALUE is allowed to vary (it legitimately differs per entry
  // page), only its presence and the absence of anything else is checked.
  for (const key of redirectUri.searchParams.keys()) {
    if (!ALLOWED_REDIRECT_QUERY_KEYS.includes(key)) {
      return { ok: false, reason: `redirect_uri has an unexpected query param ${JSON.stringify(key)} not in the allowlist ${JSON.stringify(ALLOWED_REDIRECT_QUERY_KEYS)}` };
    }
  }
  return { ok: true };
}
