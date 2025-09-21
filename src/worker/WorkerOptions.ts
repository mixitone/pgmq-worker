import postgres from "postgres";
import { PgmqMessage } from "../pgmq/mod.ts";

export interface WorkerOptions {
  /** Postgres URL or postgres.Sql object */
  connection: string | postgres.Sql;
  /** Optional callback before processing each message */
  onBeforeProcess?: (pgmqMessage: PgmqMessage<unknown>) => Promise<void> | void;
  /** Optional callback after processing each message */
  // deno-lint-ignore no-explicit-any
  onAfterProcess?: (pgmqMessage: PgmqMessage<unknown>, result: any) => Promise<void> | void;
  /** Optional callback on any error while processing a message */
  onError?: (error: Error, pgmqMessage: PgmqMessage<unknown>) => Promise<void> | void;
}
