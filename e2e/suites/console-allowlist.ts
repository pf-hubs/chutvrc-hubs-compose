// Console errors, page errors and failed requests that do not fail a test (plan T6.10: "none outside a
// reviewed allow-list"). Each entry says why it is accepted; the report lists how often each matched.
// Add an entry only with a reason that a reviewer can check, and prefer narrow patterns.
import type { AllowEntry } from "../probes/errors";

export const CONSOLE_ALLOW_LIST: AllowEntry[] = [
  {
    pattern: /Executing inline script violates the following Content Security Policy directive/,
    types: ["error"],
    reason:
      "reticulum's content security policy does not list the hash of an inline script the development build's pages run; seen on every page load of the local stack since step 2 (TRIALS.md), on develop as well (BASELINE.md)"
  },
  {
    pattern: /^Warning: %s: Support for defaultProps will be removed from (function|memo) components/,
    types: ["error"],
    reason:
      "React's development-build deprecation notice for defaultProps (printed through console.error) on the client's and libraries' components; a notice, not a failure; listed in step 2 (TRIALS.md)"
  },
  {
    pattern: /status of 404 .*\/favicon\.ico/,
    types: ["error"],
    reason: "the local stack serves no favicon.ico"
  },
  {
    pattern: /InvalidStateError: Failed to execute 'send' on 'RTCDataChannel': RTCDataChannel\.readyState is not 'open'/,
    types: ["error"],
    reason:
      "sends on data channels that are still connecting right after entry (the [e2e] send watch names them: #avatarId, #avatar-pose). Accepted here because the one that matters, the lost #avatarId, is judged by the avatar check of T1"
  },
  {
    pattern: /status of 401 \(\)\s+https:\/\/hubs\.local:4000\/https:\/\/hubs\s*$/,
    types: ["error"],
    reason:
      "a shared camera or screen is placed as hubs://clients/<id>/video; media-url-utils.js isHubsServer() prefixes a URL that does not start with http with https://, so the origin becomes https://hubs, and the CORS proxy refuses that host (401). Upstream code, the same on develop; the share itself works (T2.4)"
  },
  {
    pattern: /(status of 404 .*|Manifest fetch from .* failed, code 404 .*)https:\/\/hubs\.local:8080\/(manifest\.webmanifest|hub\.html)/,
    types: ["error"],
    reason:
      "the OLD profile opens the old build's own dev server page (https://hubs.local:8080/hub.html, mapped to hubs-client-old), which serves no manifest.webmanifest; reticulum's room page, which the other profiles open, has one. A difference of how the old build is reached here, not of the build"
  },
  {
    pattern: /^net::ERR_ABORTED (GET|HEAD) /,
    types: ["requestfailed"],
    reason:
      "a request the page itself cancelled: a blob: URL whose element was removed (a stopped share or a placed object going away), a HEAD check of the room page, an image when the room is left, a web font when the harness goes on from the sign-in check to the room page; Chromium reports a cancelled request as failed, but nothing failed to load"
  }
];
