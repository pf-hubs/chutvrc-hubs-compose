// Console errors, page errors and failed requests that do not fail a test (plan T6.10: "none outside a
// reviewed allow-list"). Each entry says why it is accepted; the report lists how often each matched.
// Add an entry only with a reason that a reviewer can check, and prefer narrow patterns.
import type { AllowEntry } from "../probes/errors";

export const CONSOLE_ALLOW_LIST: AllowEntry[] = [
  {
    pattern: /Executing inline script violates the following Content Security Policy directive/,
    types: ["error"],
    reason:
      "reticulum's content security policy does not list the hash of an inline script the development build's pages run; seen on every page load of the local stack since step 2 (TRIALS.md); whether develop shows it too is for the baseline run (plan step 5)"
  },
  {
    pattern: /^Warning: %s: Support for defaultProps will be removed from (function|memo) components/,
    types: ["error"],
    reason:
      "React's development-build deprecation notice for defaultProps (printed through console.error) on the client's and libraries' components; a notice, not a failure; listed in step 2 (TRIALS.md)"
  },
  {
    pattern: /^net::ERR_ABORTED GET .*https:\/\/fonts\.gstatic\.com\//,
    types: ["requestfailed"],
    reason:
      "a web font request of the home page cancelled by the browser when the harness goes on from the sign-in check to the room page; a cancellation, not a failed request"
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
  }
];
