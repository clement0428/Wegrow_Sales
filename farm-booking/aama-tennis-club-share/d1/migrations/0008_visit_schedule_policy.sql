UPDATE farm_slots
SET status = 'closed', version = version + 1
WHERE farm_id = 'wegrow-madou' AND status = 'open';

UPDATE farm_experiences
SET rain_policy = '雨天活動照常；如遇豪雨或颱風，農場將另行通知取消。'
WHERE id = 'wegrow-greenhouse-visit';

WITH RECURSIVE calendar(day) AS (
  VALUES('2026-09-17')
  UNION ALL
  SELECT date(day, '+1 day') FROM calendar WHERE day < '2027-12-31'
)
INSERT OR IGNORE INTO farm_slots (
  id, farm_id, experience_id, capacity_policy_id, starts_at, ends_at,
  booking_cutoff_at, buffer_minutes, status, version
)
SELECT
  'wegrow-' || replace(day, '-', '') || '-pm',
  'wegrow-madou',
  'wegrow-greenhouse-visit',
  'wegrow-policy-v1',
  day || 'T14:00:00+08:00',
  day || 'T18:00:00+08:00',
  date(day, '-1 day') || 'T18:00:00+08:00',
  30,
  'open',
  1
FROM calendar
WHERE strftime('%w', day) IN ('2', '3', '4');
