# Local Supabase

## Prerequisites

- Docker
- Supabase CLI 2.118 or newer

The CLI can be run without a global install through `npx supabase@2.118.0`.

## Google OAuth for local development

1. Copy `supabase/.env.example` to an ignored file such as `.env.local`.
2. Create a Google OAuth web client with this authorized redirect URI:
   `http://127.0.0.1:54321/auth/v1/callback`.
3. Set the two Google credentials in `.env.local`.

Email and password sign-up is enabled only by this local CLI configuration so
integration tests do not depend on Google. Production must keep the email
provider disabled.

## Commands

```bash
npx supabase@2.118.0 start --env-file .env.local
npx supabase@2.118.0 db reset --env-file .env.local
npx supabase@2.118.0 test db --env-file .env.local
npx supabase@2.118.0 stop
```

When Google OAuth is not under test, dummy non-secret values may be exported
for the two variables in `supabase/.env.example`.
