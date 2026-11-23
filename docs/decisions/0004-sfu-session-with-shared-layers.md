# 4. One session object per media server role, with shared layers

Date: 2026-11-05

## Status

Accepted

## Context

The chutvrc client talks to one of three media servers per room (Dialog,
Sora or LiveKit) through an adapter class each.  The adapters were written
one after another and share a base class whose methods were all empty, so
nothing enforced a common contract.  About a fifth of the three adapters
(3,200 lines) was the same code written three times: building the
connection parameters, the data channel label lists, sending and recording
data channel messages, the relay queue used for public speaking, the
bookkeeping of remote media streams and pending stream requests, and the
microphone state.  Outside code picked one of three pre-created adapters at
join time, created a fresh one on room migration, subscribed to events on
all three because it could not know which would be used, and read private
fields directly.  Several real bugs lived in the gaps: the public speaking
sender never became ready on LiveKit, an intentional LiveKit disconnect
scheduled a reconnect, and avatars of a previous room stayed in the scene
on Dialog and Sora.

A fourth media server (Cloudflare Realtime) is planned.  Adding it to the
old structure would have copied the duplication and the bugs a fourth time.

## Decision

Outside code sees one `SfuSession` object per role (`APP.sfu` for the room,
plus the sender, mirror and agent sessions of public speaking).  The session
is stable for the life of the page; the adapter for the room's media server
is created inside it when needed and swapped when the room's server
changes.  Events of the adapter are forwarded to the session, so subscribers
only ever subscribe to the session.  Private fields are not read from
outside; the session exposes accessors.

The parts that do not depend on the media server live in three shared
layers in `src/sfu-adapters/`:

- `SfuConfig` (`sfu-config.ts`): one typed description of a connection,
  built in one place from reticulum's join reply.
- `DataChannelBus` (`data-channel-bus.ts`): the table of data channel
  labels and their options, sending, raw recording and the public speaking
  relay queue.
- `MediaSession` (`media-session.ts`): remote stream cache, pending stream
  requests, the local track ledger and the microphone state.

An adapter is a driver: it implements the abstract methods of `SfuAdapter`
(connect and close the connection, send data on a label, publish, replace
and unpublish a local track, mute the microphone) and reports remote tracks
and data to the shared layers.  `disconnect()` is a template method in the
base class with one written-down order: close the connection, unpublish
local tracks without stopping them, settle pending requests, clear caches
and the relay queue, remove the remote avatars, stop avatar sync, clean up
handlers.

## Consequences

Adding a media server means implementing the driver methods and nothing
else; the channel options and the recording format cannot drift between
servers because they are in one table.  The refactoring kept the bytes on
the wire and the public method and event names unchanged, so callers did not
move; the intended behaviour changes are the bug fixes above and the media
server switch that now follows a room settings change without a reload.
Sora could not be tested during the change, so its driver is a mechanical
move of the old code and its known bugs (mute by `track.enabled` only, one
video track for camera and screen share) are still open.  The pose channels
keep their old delivery options on Dialog and Sora until the pose format
carries sequence numbers.
