# 3. Cherry-pick upstream changes instead of merging upstream

Date: 2026-11-05

## Status

Accepted

## Context

chutvrc forks four Hubs Foundation repositories (hubs, reticulum, dialog and
Spoke).  Earlier upstream catch-ups were merged as squashed commits, so the
merge base git sees is far older than the content the repositories actually
share (for hubs, 2024-02 versus 2024-12).  A full merge of upstream master
therefore conflicts in files that were already synchronized (23 files in
hubs).  Re-establishing the ancestry is possible, but it adds merge commits
whose only purpose is bookkeeping and it would have to be protected by a
permanent ban on squash merges.

Upstream activity since the last catch-up is mostly CI, dependency and
branding changes.  The one large feature, the add-on API, lives only on the
unmerged upstream `addons` branch.

## Decision

We do not keep chutvrc's history or content aligned with upstream.

Once a quarter we list upstream's new pull requests and bring in only the ones
we need, with `git cherry-pick -x -m 1 <merge commit>`, resolving conflicts in
favour of chutvrc's values.  Work that exists only on an upstream branch, such
as the add-on API, is applied as a single patch of that branch's diff from its
fork point.  Each intake records what was taken, what was skipped and why, and
the last upstream commit reviewed, in `MAINTAINING.md`.

## Consequences

Intakes stay small and reversible, and no history rewriting or force push is
ever needed.  The gap to upstream grows over time, so later cherry-picks may
need manual adaptation; the record in `MAINTAINING.md` is what keeps that
tractable.  Upstream merge commits are no longer meaningful ancestors, so
`git merge upstream/master` should not be attempted without revisiting this
decision.
