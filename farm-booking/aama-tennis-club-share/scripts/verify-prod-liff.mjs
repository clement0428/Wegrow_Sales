#!/usr/bin/env node
// Runs as the `postdeploy` npm hook, right after `wrangler deploy` reports
// success. Uses a real Chromium (puppeteer), not string-scanning: it loads
// the live production pages, lets the real @line/liff SDK execute, and
// fails loudly on anything a plain `curl`/regex check would miss.
//
// 2026-09-18 second review found that the first version of this script
// still used `decodedUrl.includes(...)` to "verify" the OAuth redirect,
// which is a substring match, not the exact match it claimed to be —
// independently reproduced: app_id "...WRONG" and redirect_uri
// "...wegrow-orbit.com.example.org" both false-passed. Rewritten below to
// parse the URL structurally (URL/URLSearchParams at each nesting layer)
// and compare exact fields, never substring-search the raw string.
//
// What this script CANNOT do, and does not pretend to: complete a real LINE
// login (no test account credentials exist in this environment), or drive
// an actual iPhone LINE in-app WKWebView (puppeteer is Chromium, and the
// iPhone/LINE User-Agent set below is a UA *simulation* to exercise the
// SDK's platform branch — it is not a real-device test). Those are
// reported as BLOCKED, not PASS.

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseJsonc } from "jsonc-parser";
import puppeteer from "puppeteer";
import { verifyLineOAuthRedirect } from "./lib/verify-line-oauth.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const config = parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8"), [], { allowTrailingComma: true });
const prodVars = config?.env?.production?.vars ?? {};
const siteUrl = prodVars.NEXT_PUBLIC_SITE_URL;
const expectedLiffId = prodVars.NEXT_PUBLIC_LIFF_ID;
// LIFF IDs are conventionally "<LINE Login channel id>-<random>". We don't have
// read access to the channel id as a separate secret (it's set via `wrangler
// secret put`, correctly not committed), but we can derive the expected value
// from the LIFF ID itself and check LINE's own redirect echoes the same channel.
const expectedClientId = expectedLiffId?.split("-")[0];

if (!siteUrl || !expectedLiffId) {
  console.error("✖ verify-prod-liff: wrangler.jsonc env.production.vars missing NEXT_PUBLIC_SITE_URL or NEXT_PUBLIC_LIFF_ID");
  process.exit(1);
}

const localBuildIdPath = join(root, ".next", "BUILD_ID");
const localBuildId = existsSync(localBuildIdPath) ? readFileSync(localBuildIdPath, "utf8").trim() : null;
// This script's primary job is the `postdeploy` hook, which always runs right
// after a build in this same directory — .next/BUILD_ID must exist then. A
// human running it standalone without a preceding local build can opt out
// explicitly; the default is fail-closed, not a silent BLOCKED that lets the
// process exit 0 with the version check skipped.
const skipBuildIdCheck = process.env.SKIP_BUILD_ID_CHECK === "1";

const results = []; // { name, status: PASS|FAIL|BLOCKED, detail }
const record = (name, status, detail) => {
  results.push({ name, status, detail });
  const icon = status === "PASS" ? "✓" : status === "BLOCKED" ? "•" : "✖";
  console.log(`${icon} [${status}] ${name}${detail ? " — " + detail : ""}`);
};

async function checkBuildIdMatches() {
  if (!localBuildId) {
    if (skipBuildIdCheck) {
      record("build-id-match", "BLOCKED", "no local .next/BUILD_ID and SKIP_BUILD_ID_CHECK=1 was set explicitly");
      return;
    }
    return record(
      "build-id-match",
      "FAIL",
      "no local .next/BUILD_ID found. If this is the postdeploy hook, a build should have just happened — treat this as broken, not skippable. " +
        "Set SKIP_BUILD_ID_CHECK=1 only for a deliberate standalone smoke test with no local build context."
    );
  }
  try {
    const res = await fetch(new URL("/BUILD_ID", siteUrl), { cache: "no-store" });
    if (!res.ok) return record("build-id-match", "FAIL", `GET /BUILD_ID -> HTTP ${res.status}`);
    const liveBuildId = (await res.text()).trim();
    if (liveBuildId !== localBuildId) {
      return record(
        "build-id-match",
        "FAIL",
        `production is serving BUILD_ID ${liveBuildId}, not this build's ${localBuildId} — deploy did not take effect or is cached`
      );
    }
    record("build-id-match", "PASS", `production serves this exact build (${liveBuildId})`);
  } catch (e) {
    record("build-id-match", "FAIL", `could not fetch /BUILD_ID: ${e.message}`);
  }
}

async function checkPageWithRealBrowser(browser, path, { expectRedirectToLineLogin }) {
  const name = `browser:${path}`;
  const page = await browser.newPage();
  // Simulates an iPhone LINE in-app browser's User-Agent to exercise the SDK's
  // iOS branch. This is a UA simulation in Chromium, NOT a real iPhone/WKWebView
  // test — real-device verification is still required (see the BLOCKED items).
  await page.setUserAgent(
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/15.5.0 Mobile/15E148 Safari/604.1"
  );
  const pageErrors = [];
  const criticalFailures = []; // same-origin static asset load failures
  const thirdPartyFailures = []; // cross-origin — reported, not auto-fail
  const url = new URL(path, siteUrl).toString();
  const origin = new URL(siteUrl).origin;

  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("requestfailed", (req) => {
    const failUrl = req.url();
    const sameOrigin = (() => {
      try {
        return new URL(failUrl).origin === origin;
      } catch {
        return false;
      }
    })();
    const entry = `${req.method()} ${failUrl} -> ${req.failure()?.errorText}`;
    (sameOrigin ? criticalFailures : thirdPartyFailures).push(entry);
  });
  page.on("response", (res) => {
    if (res.status() < 400) return;
    const sameOrigin = (() => {
      try {
        return new URL(res.url()).origin === origin;
      } catch {
        return false;
      }
    })();
    if (sameOrigin) criticalFailures.push(`HTTP ${res.status()} ${res.url()}`);
  });

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
  } catch (e) {
    await page.close();
    return record(name, "FAIL", `page.goto failed: ${e.message}`);
  }

  if (expectRedirectToLineLogin) {
    // liff.login() navigates the page; wait (bounded) for the LINE host rather
    // than sleeping a fixed duration and hoping it already happened.
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (page.url().includes("access.line.me")) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    const finalUrl = page.url();
    await page.close();
    if (criticalFailures.length > 0) {
      return record(name, "FAIL", `same-origin resource load failure(s) before redirect: ${criticalFailures.join(" | ")}`);
    }
    if (pageErrors.length > 0) {
      return record(name, "FAIL", `uncaught page error(s): ${pageErrors.join(" | ")}`);
    }
    if (thirdPartyFailures.length > 0) {
      console.log(`  (third-party resource failures, not blocking: ${thirdPartyFailures.join(" | ")})`);
    }
    const verdict = verifyLineOAuthRedirect(finalUrl, expectedLiffId, expectedClientId, siteUrl);
    if (!verdict.ok) return record(name, "FAIL", verdict.reason);
    return record(name, "PASS", "liff.init() succeeded and liff.login() reached LINE's real OAuth endpoint with an exact-matched app_id/client_id/redirect_uri");
  }

  // Homepage path: poll for a determinate init outcome instead of a fixed
  // sleep-then-hope. The app doesn't currently expose an init-state hook of
  // its own (adding one is a source change, tracked separately) — so this
  // polls the same liff global the SDK sets, waiting for either a stable
  // `id` or for pageerror/timeout, rather than guessing 4 seconds is enough.
  const deadline = Date.now() + 15000;
  let liffState = { liffGlobalPresent: false };
  while (Date.now() < deadline) {
    liffState = await page
      .evaluate(() => {
        if (typeof liff === "undefined") return { liffGlobalPresent: false };
        const safe = (fn) => {
          try {
            return { value: fn() };
          } catch (e) {
            return { error: `${e.name}: ${e.message}` };
          }
        };
        const idResult = liff.id ?? null;
        const loggedInResult = safe(() => liff.isLoggedIn());
        return { liffGlobalPresent: true, id: idResult, isLoggedIn: loggedInResult };
      })
      .catch((e) => ({ evalError: e.message }));
    if (liffState.liffGlobalPresent && liffState.id) break;
    if (pageErrors.length > 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.close();

  if (criticalFailures.length > 0) {
    return record(name, "FAIL", `same-origin resource load failure(s): ${criticalFailures.join(" | ")}`);
  }
  if (pageErrors.length > 0) {
    return record(name, "FAIL", `uncaught page error(s) during init: ${pageErrors.join(" | ")}`);
  }
  if (thirdPartyFailures.length > 0) {
    console.log(`  (third-party resource failures, not blocking: ${thirdPartyFailures.join(" | ")})`);
  }
  if (!liffState.liffGlobalPresent) return record(name, "FAIL", "window.liff never became available (SDK did not initialize within 15s)");
  if (liffState.id !== expectedLiffId) {
    return record(name, "FAIL", `live liff.id is ${JSON.stringify(liffState.id)}, expected exactly ${JSON.stringify(expectedLiffId)}`);
  }
  if (liffState.isLoggedIn?.error) {
    return record(name, "FAIL", `liff.isLoggedIn() threw after init: ${liffState.isLoggedIn.error} — SDK state is not actually healthy despite liff.id being set`);
  }
  record(name, "PASS", `liff.init() succeeded, SDK reports the exact expected liff.id (${liffState.id}) and isLoggedIn() did not throw`);
}

async function main() {
  await checkBuildIdMatches();

  const browser = await puppeteer.launch();
  await checkPageWithRealBrowser(browser, "/login", { expectRedirectToLineLogin: true });
  await checkPageWithRealBrowser(browser, "/", { expectRedirectToLineLogin: false });
  await browser.close();

  record(
    "real-line-account-login",
    "BLOCKED",
    "no test LINE account credentials available in this environment — cannot complete liff.login()/token exchange/session. Requires a controlled test account, real iPhone LINE in-app browser, or a human tester."
  );
  record(
    "iphone-wkwebview",
    "BLOCKED",
    "this script drives Chromium via puppeteer with a spoofed iPhone/LINE User-Agent — that exercises the SDK's UA-based branch but is NOT a real iOS WKWebView. Real-device LINE testing is still required and is not replaced by this check."
  );

  const failed = results.filter((r) => r.status === "FAIL");
  const blocked = results.filter((r) => r.status === "BLOCKED");
  console.log(
    `\nSummary: ${results.length - failed.length - blocked.length}/${results.length} PASS, ${failed.length} FAIL, ${blocked.length} BLOCKED`
  );
  console.log(
    "This is a SMOKE check (config/init/OAuth-entry), not a release gate: BLOCKED items above (real LINE login, real device) are still required before declaring the incident resolved."
  );

  let commitSha = null;
  try {
    commitSha = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
  } catch {
    // not fatal — record null rather than guessing
  }
  const manifest = {
    mode: "smoke",
    releaseReady: false, // this script never sets this true; only a human can, after the BLOCKED items are cleared
    timestamp: new Date().toISOString(),
    commitSha,
    buildId: localBuildId,
    siteUrl,
    expectedLiffId,
    results: results.map((r) => ({ name: r.name, status: r.status, detail: r.detail ?? null })),
    summary: { pass: results.length - failed.length - blocked.length, fail: failed.length, blocked: blocked.length, total: results.length },
  };
  const manifestPath = join(root, "qa", "verify-prod-liff-last-run.json");
  try {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`\nMachine-readable result written to ${manifestPath}`);
  } catch (e) {
    console.error(`(could not write ${manifestPath}: ${e.message})`);
  }

  if (failed.length > 0) {
    console.error("\n✖ verify-prod-liff: production has FAIL result(s) above. Treat the deploy as broken.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("✖ verify-prod-liff: unexpected error:", e);
  process.exit(1);
});
