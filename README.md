# Pawlido Instagram autopublisher

This repository publishes Pawlido Reels and carousels from GitHub Actions. The
queue is limited to two posts a day (12:30 and 20:30 Asia/Dubai). Every caption
includes the product code so customers can search it on pawlido.com.

## One-time connection

1. Use a public GitHub repository named `pawlido-ig`; the public `media/`
   folder lets Instagram fetch each asset through jsDelivr.
2. In Meta for Developers, use **Instagram API with Instagram Login** and connect
   the Pawlido Instagram professional account. This does not require a Facebook
   Page or Meta Business Suite. Request `instagram_business_basic` and
   `instagram_business_content_publish`.
3. Add `IG_USER_ID` and `IG_TOKEN` as GitHub Actions repository secrets.
4. Run the `post to instagram` workflow once and inspect the first result.

GitHub is the scheduler and media host; Instagram still requires this one-time
account authorization. Refresh the access token before it expires.

## Reliability

The runner validates the entire queue before every attempt, publishes at most one
due item, and keeps overdue items pending. It enforces a two-hour gap while
draining a backlog. Before posting it checks the latest Instagram captions for
the product code, so a successful post is recovered instead of duplicated if a
previous GitHub state commit failed.

State is stored in `ig_scheduled.json`. GitHub scheduled workflows may run a few
minutes late, so exact-to-the-minute delivery is not guaranteed.

## Prepare a new queue

From the main Pawlido project run:

```text
node ops/generate_music.js
node ops/ig_reschedule.js YYYY-MM-DD
node ops/ig_music.js
node ops/ig_deploy.js
```

The three music beds are original, sample-free Pawlido tracks. Their provenance
is recorded in `ops/music/licenses.json`. Validate locally with:

```text
node ig_deploy/publish.js --validate
node ig_deploy/publish.js --due --dry
```
