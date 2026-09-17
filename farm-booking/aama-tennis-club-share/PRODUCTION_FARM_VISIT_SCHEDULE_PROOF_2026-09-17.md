# WeGrow Farm Visit Schedule Production Proof

- Date: 2026-09-17 Asia/Taipei
- Production URL: https://booking.wegrow-orbit.com/
- Git commits: `fd6507c`, `f828ded`
- Cloudflare Worker version: `f6aa4a8c-42b2-4b3e-a322-ec3a3eeea0ce`
- D1 migration: `0008_visit_schedule_policy.sql`

## Verified policy

- Tuesday, Wednesday and Thursday: direct booking, 14:00-18:00.
- Friday, Saturday and Sunday: contact WeGrow customer service before a time slot is opened.
- Monday: no public booking slot.
- Customer-service holiday slots use a 20% ticket surcharge (NT$360 instead of NT$300).
- Rain activities continue; heavy rain or typhoon cancellation is separately notified.
- Visitors change into slippers. The ground is uneven; running is prohibited and careful walking is required.
- Google Maps: https://maps.app.goo.gl/mde8o1215UvvtbBu8
- Roadside parking is available without blocking entrances.

## Verification

- Full Vitest suite: 70/70 passed.
- Next production build: passed.
- Production D1 migration: passed.
- Production mobile DOM at 390px: no horizontal overflow.
- First 12 public dates: Tuesday/Wednesday/Thursday only.
- Public slot time: 14:00-18:00.
- Weekend date visible in public booking UI: false.
- `/visit-info` direct link renders WeGrow visit information, not the legacy AAMA login.
- LINE Pay and credit card remain clearly disabled; no fake payment success.

## Screenshots

- `qa/production-schedule-mobile-fd6507c.png`
- `qa/production-visit-info-mobile-fd6507c.png`
