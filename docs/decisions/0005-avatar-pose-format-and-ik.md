# 5. One packet per body pose, interpolation, and a new body solver behind a preference

Date: 2026-11-05

## Status

Accepted

## Context

Full-body avatars are a chutvrc addition.  Each client sent its pose as
four data channel messages (rig, head, left hand, right hand) about 67
times a second, each 24 bytes of position and Euler rotation followed by a
36-byte client id, with no sequence number, timestamp or tracking flag.  A
packet that arrived late overwrote a newer one, the four parts could show
different moments in time, and there was no interpolation, so remote
avatars moved as jerkily as the network delivered.  Slow movements were
not sent at all because the change detection compared against a sample
that a timer refreshed every 15 ms.  Twenty people in a room meant about
5,000 packets a second arriving at every client.

The inverse kinematics wrote bones through a cyclic coordinate descent
solver with two or three iterations, no pole targets, joint limits that
were partly ignored, an eye position treated as the head position, and
several per-frame allocations and reparenting operations.  The symptoms
were lagging hands, an over-tilted head when leaning, twisted spines and
knees, and inverted elbows.  Sync, model loading, recording and the solver
lived in two large classes that reached into each other and into the media
server adapter.

## Decision

The avatar code moves to `src/avatar/` in the client, split by concern:
`rig/` (one description per avatar model: bones, rest pose, lengths, eye
offset, built from the VRM humanoid extension when present, otherwise from
bone name keywords), `pose/` (a page-global pose store filled by the local
sampler, the network, and NPCs), `net/` (codecs, interpolation, the sender)
and `ik/` (the solver).

The pose is sent as one packet per body on the `#avatar-pose` channel:
version, flags (tracked parts, VR mode, animation state), a sequence
number, a millisecond timestamp, the rig position and heading, the head and
hand positions relative to the rig, the head and hand rotations as
compressed quaternions, and the sender's client id.  The client id stays in
the packet because the public speaking relay re-broadcasts bytes under the
relay agent's identity and because Sora does not report the sender of a
data message.  The channel is unreliable and unordered on every media
server; stale packets are dropped by sequence number.  Receivers keep
understanding the old four-channel format for one quarter; senders switch
at once, so a browser still on an older build must reload to see users on
the new build move.  Remote poses go through an interpolation buffer that
displays them about 100 ms in the past and extrapolates for at most 100 ms.

The new body solver is a set of pure functions over the rig description
and a pose (analytic two-bone arms and legs with pole targets, a spine
chain with limits relative to the rest pose, head placement from the eye
offset, damped body heading, grounded feet, height calibration), applied to
the bones once per frame.  It sits behind the `avatarIkV2` preference,
which defaults to the old solver until the two have been compared in a
room; the old solver is deleted only after that comparison.

## Consequences

Bandwidth per sender drops from about 16 kB/s to about 3.5 kB/s and the
packet rate from about 270 to at most 45 a second.  Remote movement is
smoother at the cost of about 100 ms of delay.  The solver can be compared
and tuned without touching the sync code, and tested offline because it
does not depend on the scene.  Adding a pose source (hand tracking,
replay) means writing into the pose store.  Until the old format is
removed, two decoders and two channel sets must be kept working.
