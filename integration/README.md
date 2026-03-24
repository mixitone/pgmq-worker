# Integration tests (real Postgres + pgmq)

Unit tests mock the SQL driver. To verify the **cast SQL** works against a real `pgmq` extension, run the script below against your server’s Postgres (e.g. mixone).

## 1. Find the DB port on the server

```bash
ssh installer@mixone "docker port supabase-db 5432"
```

Example output: `0.0.0.0:54322` — the host port is **54322**.

## 2. SSH port forward (leave this running)

From your Mac:

```bash
ssh -N -L 15432:127.0.0.1:54322 installer@mixone
```

Use the port from step 1 instead of `54322` if different.

## 3. Connection string

Use the **postgres superuser** password from your secrets (same as `POSTGRES_PASSWORD` for self-hosted Supabase), not the pooler tenant user:

```bash
export DATABASE_URL='postgresql://postgres:YOUR_POSTGRES_PASSWORD@127.0.0.1:15432/postgres'
```

Optional:

- `PGMQ_INTEGRATION_QUEUE` — queue name (default `pgmq_worker_integration`)
- `PGMQ_INTEGRATION_DATABASE_URL` — overrides `DATABASE_URL` for this script only

## 4. Run the check

From the `pgmq-worker` repo root (with mise + Deno 2.7+ as in `.mise.toml`):

```bash
mise install
mise exec -- deno task integration:pgmq-send
```

You should see:

`OK: pgmq.send(text, jsonb, integer) round-trip succeeded`

## Why not run Deno on mixone?

You can, but you’d need Deno installed on the server and network access from that process to `supabase-db`. Port-forwarding + local Deno is usually simpler.
