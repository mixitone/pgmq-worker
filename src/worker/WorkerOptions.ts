import postgres from "postgres";
import { PgmqMessage } from "../pgmq/mod.ts";

export interface WorkerOptions {
  /** Postgres URL or postgres.Sql object */
  connection: string | postgres.Sql;
  queuesPath?: string;
  /** Optional callback before processing each message */
  onBeforeProcess?: (ctx: {
    pgmqMessage: PgmqMessage<unknown>;
    importPath: string;
  }) => Promise<string> | string;
  /** Optional callback after processing each message */
  onAfterProcess?: (
    pgmqMessage: PgmqMessage<unknown>,
    // deno-lint-ignore no-explicit-any
    result: any
  ) => Promise<void> | void;
  /** Optional callback on any error while processing a message */
  onError?: (
    error: Error,
    pgmqMessage: PgmqMessage<unknown>
  ) => Promise<void> | void;
}
