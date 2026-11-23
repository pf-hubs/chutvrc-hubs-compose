// Console errors, page errors and failed requests that do not fail a test (plan T6.10: "none outside a
// reviewed allow-list"). Each entry says why it is accepted; the report lists how often each matched.
// Add an entry only with a reason that a reviewer can check, and prefer narrow patterns.
import type { AllowEntry } from "../probes/errors";

export const CONSOLE_ALLOW_LIST: AllowEntry[] = [
  {
    pattern: /^Removing invalid preference from store: is not allowed to have the additional property "avatarIkV2"/,
    types: ["error"],
    reason:
      "a browser profile signed in before the preference was removed still holds avatarIkV2 (earlier runs of this harness set it); the client's store (storage/store.js) logs this once and deletes it from the profile"
  },
  {
    pattern: /^(net::ERR_NO_BUFFER_SPACE (GET|POST|HEAD) |Failed to load resource: net::ERR_NO_BUFFER_SPACE)/,
    types: ["requestfailed", "error"],
    reason:
      "a Windows socket error of this PC (no buffer space for a new socket) while many browsers run, seen in T5 as well; the environment, not the client (the request is the page's own, and the test's checks show what it cost)"
  },
  {
    pattern: /(^Connecting to 'https:\/\/github\.com\/' violates the following Content Security Policy directive: "connect-src|^csp HEAD https:\/\/github\.com\/$)/,
    types: ["error", "requestfailed"],
    reason:
      "T6.4, a media URL on raw.githubusercontent.com: before loading, the client asks whether the URL's origin is a Hubs server with a HEAD request through the CORS proxy (media-url-utils.js isHubsServer); the proxy passes on that origin's redirect to https://github.com/, which the page's content security policy blocks, so the answer is \"not a Hubs server\", the right one. Upstream code, unchanged since develop; the media loads (T6.4)"
  },
  {
    pattern: /^entity registered with system despite being removed /,
    types: ["error"],
    reason:
      "networked-aframe's own guard (components/networked.js, with the comment \"TODO: Find out why tick is still being called\"): logged when a networked object is removed between two frames of its sync loop; the removal itself completes (T6.3); library code, not changed by this work"
  },
  {
    pattern: /^Warning: A component is changing an uncontrolled input to be controlled\./,
    types: ["error"],
    reason:
      "React's development-build warning from Change Name & Avatar when the profile has no pronouns yet: AvatarSettingsContent.js passes value={pronouns} as undefined until the first key press; code identical on develop (the upstream intake changed only the pronouns pattern)"
  },
  {
    pattern: /(^net::ERR_CONNECTION_REFUSED (GET|PATCH)|^Failed to load resource: net::ERR_CONNECTION_REFUSED) http:\/\/localhost:3333\//,
    types: ["error", "requestfailed"],
    reason:
      "admin pages (T6.1): the admin build's .defaults.env sets ITA_SERVER=http://localhost:3333, a configuration service the local stack does not run; on the refused request admin/src/utils/ita.js logs \"ita not available\" and uses reticulum's /api/v1/server_configs instead, as designed (the saves work)"
  },
  {
    pattern: /^Warning: Can't perform a React state update on an unmounted component\.[\s\S]*SystemEditorComponent/,
    types: ["error"],
    reason:
      "admin pages (T6.1): React's development-build warning when the admin home page (SystemEditor) finishes a request after the test has gone on to another admin page; a missing clean-up in upstream admin code, no effect on the settings"
  },
  {
    pattern: /^ResizeObserver loop completed with undelivered notifications\./,
    types: ["pageerror"],
    reason:
      "WebKit (IOS profile) reports the ResizeObserver loop notice as an uncaught error without an error object (the harness names it from the page's error event); the specification makes it a notice that observations were deferred to the next frame, not a failure (TRIALS.md, trial c)"
  },
  {
    pattern: /^InvalidStateError: The object is in an invalid state\. /,
    types: ["error"],
    reason:
      "WebKit's wording (IOS profile) of Chromium's \"Failed to execute 'send' on 'RTCDataChannel'\" (the [e2e] send watch names the channel next to it): sends on a data channel that is still connecting; whether the channel ever opened is judged by the grids (known failure 21 when it does not)"
  },
  {
    pattern: /(status of 404 \(Not Found\)|^Load request cancelled GET) https:\/\/hubs\.local:4000\/manifest\.webmanifest$/,
    types: ["error", "requestfailed"],
    reason:
      "IOS profile: reticulum answers 404 to Safari user agents for the web app manifest on purpose (page_controller.ex: \"For iOS, do not render the manifest since we don't want to trigger the PWA functionality, since WebRTC doesn't work then\"); WebKit logs the 404 and cancels the load"
  },
  {
    pattern: /^Refused to execute a script because its hash, its nonce, or 'unsafe-inline' does not appear in the script-src directive of the Content Security Policy\./,
    types: ["error"],
    reason: "WebKit's wording (IOS profile) of the first entry: the same inline script of the development build's page, blocked by reticulum's content security policy"
  },
  {
    pattern: /^Viewport argument key "minimal-ui" not recognized and ignored\./,
    types: ["error"],
    reason: "Linux WebKit (IOS profile) does not know the viewport key minimal-ui of hub.html, which iOS Safari reads; an engine notice, not a failure"
  },
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

/**
 * Known failure 2 of BASELINE.md (Dialog: the microphone wish lost at entry, already on develop), for tests
 * that are about something else; the tests about the microphone (T1, T2.2) judge it and do not take this
 */
export const KNOWN_MIC_WISH_LOST: AllowEntry = {
  pattern: /^Tried to toggle mic but there's no producer\./,
  types: ["error"],
  reason: "known failure 2 of BASELINE.md (Dialog: the microphone wish lost at entry), already on develop; this test is about something else"
};

/**
 * The browsers inside the netclient container (poor network, IOS) do not trust the local mkcert certificate
 * authority (TRIALS.md, trial f): Playwright's ignoreHTTPSErrors covers pages and requests but not the
 * service worker's script fetch, so its registration fails there. Entry and everything after it work
 */
export const CONTAINER_CERTIFICATE: AllowEntry[] = [
  {
    pattern: /^An SSL certificate error occurred when fetching the script\./,
    types: ["error"],
    reason: "netclient container: the service worker's script fetched with a certificate the container's browser does not trust (TRIALS.md, trial f)"
  },
  {
    pattern: /^Service worker registration failed SecurityError: Failed to register a ServiceWorker for scope \('https:\/\/hubs\.local:4000\/'\) with script \('https:\/\/hubs\.local:4000\/hub\.service\.js'\): An SSL certificate error/,
    types: ["error"],
    reason: "netclient container: the same service worker registration, refused for the untrusted certificate (TRIALS.md, trial f)"
  },
  {
    pattern: /^Permissions policy violation: unload is not allowed in this document\./,
    types: ["error"],
    reason:
      "Playwright's Chromium 159 in the netclient container blocks unload handlers by default (Chrome's unload deprecation); a handler in the client's store bundle is refused there. Edge 157 on this PC does not block it yet; noted for real Chrome in BASELINE.md"
  }
];

// The container's messages concern the environment of whichever test runs a client there, so the
// whole-run scan (report/run-scans.ts) takes them as well
CONSOLE_ALLOW_LIST.push(...CONTAINER_CERTIFICATE);
