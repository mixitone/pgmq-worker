/**
 * Real Postgres + pgmq integration check for Pgmq.send() cast SQL.
 *
 * Run from your machine with DATABASE_URL pointing at mixone Postgres
 * (usually via SSH port forward — see integration/README.md).
 */
import postgres from "postgres";

const databaseUrl = Deno.env.get("PGMQ_INTEGRATION_DATABASE_URL") ??
  Deno.env.get("DATABASE_URL");

if (!databaseUrl) {
  console.error(
    "Set DATABASE_URL or PGMQ_INTEGRATION_DATABASE_URL (postgresql://…)",
  );
  Deno.exit(1);
}
const url = databaseUrl;

const queueName = Deno.env.get("PGMQ_INTEGRATION_QUEUE") ??
  "pgmq_worker_integration";

const payload = {
  source: "pgmq-worker integration",
  apostrophe: "don't break",
  name: "O'Reilly",
};

async function main() {
  const sql = postgres(url, { max: 1 });

  try {
    // Clean slate (ok if queue did not exist)
    await sql`SELECT pgmq.drop_queue(${queueName}::text)`;

    await sql`SELECT pgmq.create(${queueName}::text)`;

    const payloadJson = JSON.stringify(payload);
    await sql`
      SELECT pgmq.send(${queueName}::text, ${payloadJson}::jsonb, ${0}::integer)
    `;

    const rows = await sql<
      { msg_id: number; message: unknown }[]
    >`SELECT * FROM pgmq.read(${queueName}::text, ${30}::integer, ${1}::integer)`;

    if (rows.length !== 1) {
      throw new Error(`expected 1 message, got ${rows.length}`);
    }

    const gotRaw = rows[0].message;
    const got = typeof gotRaw === "string" ? JSON.parse(gotRaw) : gotRaw;
    const expected = payload;
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      throw new Error(
        `payload mismatch:\nexpected ${JSON.stringify(expected)}\ngot ${JSON.stringify(got)}`,
      );
    }

    await sql`SELECT pgmq.delete(${queueName}::text, ${rows[0].msg_id}::bigint)`;
    await sql`SELECT pgmq.drop_queue(${queueName}::text)`;

    console.log("OK: pgmq.send(text, jsonb, integer) round-trip succeeded");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
