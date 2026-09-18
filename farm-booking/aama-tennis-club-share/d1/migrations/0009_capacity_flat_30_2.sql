-- 2026-09-18: capacity rule change approved by Clement, overrides the old
-- tiered 1-team/50, 2-team/30, 3-team/15 rule entirely.
-- New rule: every session caps at 30 total people AND at most 2 groups.
-- Not tiered by group count — 1 group of 30 is fine, 2 groups totaling 30
-- is fine, a 3rd group is never allowed regardless of its size.
--
-- Implemented as a values-only change, not a schema/query rewrite: the
-- existing farm_capacity_policies columns (max_groups, limit_one_group,
-- limit_two_groups, limit_three_groups) and the CASE-based capacity check
-- in the booking INSERT already support an arbitrary limit per group-count
-- tier. Setting max_groups=2 means a 3rd group is rejected by the group-count
-- check before the people-count CASE ever reaches WHEN 3, so limiting BOTH
-- limit_one_group and limit_two_groups to the same flat value (30) makes the
-- existing tiered mechanism implement the new flat rule exactly, with zero
-- changes to the booking INSERT query or the availability query.
--
-- New policy version, not an UPDATE of the existing row: farm_bookings
-- snapshots the policy it was created under into policy_snapshot_json, so
-- historical bookings are unaffected either way — but versioning keeps an
-- auditable record of the rule change itself, consistent with farm_slots
-- referencing a specific capacity_policy_id per session.
INSERT INTO farm_capacity_policies (id, farm_id, version, max_groups, limit_one_group, limit_two_groups, limit_three_groups, effective_at)
SELECT 'wegrow-policy-v2', farm_id, version + 1, 2, 30, 30, 0, datetime('now')
FROM farm_capacity_policies WHERE id = 'wegrow-policy-v1';

-- Repoint only future, still-open sessions at the new policy. Per spec:
-- "未來未占用場次改為30人／2團；舊規則不能...復活" — past sessions and any
-- non-open (paused/closed/cancelled) sessions are left alone. Production
-- dry-run on 2026-09-18 found ZERO active bookings on any future open
-- session, so this repoint has no effect on any existing customer booking.
UPDATE farm_slots
SET capacity_policy_id = 'wegrow-policy-v2'
WHERE status = 'open'
  AND datetime(starts_at) > datetime('now')
  AND capacity_policy_id = 'wegrow-policy-v1';
