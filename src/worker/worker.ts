import { Pgmq } from "../pgmq/Pgmq.ts";
import { PgmqMessage } from "../pgmq/PgmqMessage.ts";
import { Task } from "../types/types.ts";
import postgres from "postgres";
import { WorkerOptions } from "./WorkerOptions.ts";

export interface WorkerContext {
  sql: postgres.Sql;
}

export interface QueueHandler<T> {
  (message: PgmqMessage<T>, context: WorkerContext): Promise<void>;
}

export class HandlerError extends Error {}

export async function processMessage(
  pgmqMessage: PgmqMessage<unknown>,
  sql: postgres.Sql
): Promise<void> {
  const queueName = pgmqMessage.queueName;

  // Sanitize queue name for valid filename (spaces and dashes to underscores)
  const sanitizedQueueName = queueName.replace(/\s\-/g, "_");
  // Dynamically load the queue handler
  let handlerModule;
  try {
    handlerModule = await import(`../queues/${sanitizedQueueName}.ts`);
  } catch (e) {
    throw new HandlerError(
      `Failed to load handler for queue ${queueName}: ${(e as Error).message}`,
      {
        cause: e,
      }
    );
  }
  if (!handlerModule) {
    throw new HandlerError(
      `Handler module for queue ${queueName} not found after import.`
    );
  }

  const handler = handlerModule.default;

  if (typeof handler === "function") {
    const context: WorkerContext = { sql };
    try {
      await handler(pgmqMessage, context);
    } catch (e) {
      throw new HandlerError(
        `Handler for queue ${queueName} failed: ${(e as Error).message}`,
        {
          cause: e,
        }
      );
    }
  } else {
    throw new HandlerError(
      `Handler for queue ${queueName} is not a function or not found.`
    );
  }
}

export function createWorker(
  options: WorkerOptions
): (task: Task | undefined) => Promise<void> {
  const sql =
    typeof options.connection === "string"
      ? postgres(options.connection)
      : options.connection;

  async function enhancedProcess(task: Task | undefined) {
    if (!task) throw new Error("No task provided to worker.");

    const pgmq = new Pgmq(sql, task.queueName, {});
    const pgmqMessage = new PgmqMessage<unknown>(pgmq, task.message);

    if (options.onBeforeProcess) {
      await options.onBeforeProcess(pgmqMessage);
    }
    let result;
    try {
      result = await processMessage(pgmqMessage, sql);
    } catch (e) {
      if (e instanceof HandlerError) {
        if ("preventDefault" in e && typeof e.preventDefault === "function")
          e.preventDefault();

        if (options.onError) {
          result = await options.onError(e as Error, pgmqMessage);
        } else if (task) {
          console.error(
            `Error processing message from queue ${task.queueName}:`,
            e
          );
          console.error("Archiving message due to processing error.");
          await pgmqMessage.archive();
        }
      } else {
        throw e;
      }
    }
    if (options.onAfterProcess) {
      await options.onAfterProcess(pgmqMessage, result);
    }
    return result;
  }

  return enhancedProcess;
}
