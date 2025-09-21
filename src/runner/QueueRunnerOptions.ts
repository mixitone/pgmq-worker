import z from "zod";
import { Connection } from "../connectionFrom.ts";
import { GenericPgmq, RawPgmqMessage, Task } from "../types/types.ts";

export interface QueueRunnerOptions {
  /** Postgres URL or postgres.Sql object */
  connection: Connection;
  /** Number of worker threads to spawn, defaults to 1 */
  poolSize?: number;
  /** List of queue names to process, or an object mapping queue names to Zod schemas for message validation */
  queues: string[] | Record<string, z.ZodTypeAny>;
  /** Default message timeout on read, in seconds. Defaults to 5 seconds. */
  messageTimeout?: number;
  /** Time to wait when no messages are found before checking again, in milliseconds. Defaults to 1000ms. */
  sleepTimeout?: number;
  /** Optional custom worker file. This must be provided if using a sql client instead of a connection string. */
  worker?: URL;
  /** Optional callback before processing each queue */
  onBeforeProcess?: (ctx: { pgmq: GenericPgmq }) => Promise<void> | void;
  /** Optional callback before executing each message */
  onBeforeExecute?: (ctx: {
    pgmq: GenericPgmq;
    task: Task;
  }) => Promise<void> | void;
  /** Optional callback on any error while reading messages. Note that this is
   * only in the context of the reading from the queue and passing to workers.
   * For customizing worker errors provide a custom worker file. */
  onError?: (error: Error, ctx: { pgmq: GenericPgmq }) => Promise<void> | void;
  /** Optional callback when an invalid message is received. This error can only
   * occur if you provide a Zod schema for the queue.
   *
   * If this is not provided, invalid messages will be automatically archived.
   * If you do provide this, you must handle the invalid message (e.g. by
   * archiving it or deleting it) yourself.
   */
  onInvalidMessage?: (
    error: Error,
    ctx: { pgmq: GenericPgmq; message: RawPgmqMessage }
  ) => Promise<void> | void;
  /** Optional callback when the runner is ready and about to start processing */
  onReady?: () => Promise<void> | void;
  /** Optional callback when the runner is shutting down */
  onShutdown?: () => Promise<void> | void;
}
