# Founder live check

Read-only. Signs in as the founder and calls every read the founder console pages use.

```bash
FOUNDER_EMAIL=founder@tryouthq.ca FOUNDER_PASSWORD='your password' npm run test:founder
```

Without the two variables every test is skipped. Supabase URL and anon key come from `.env.local`.
It is not part of `npm test`.
