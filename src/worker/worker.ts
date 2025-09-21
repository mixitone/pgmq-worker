import { Pgmq } from "../pgmq/Pgmq.ts";
import { PgmqMessage } from "../pgmq/PgmqMessage.ts";
import { Task } from "../types/types.ts";
import postgres from "postgres";
import { WorkerOptions } from "./WorkerOptions.ts";
import { ThreadWorker } from "poolifier";

export interface WorkerContext {
  sql: postgres.Sql;
}

export interface QueueHandler<T> {
  (message: PgmqMessage<T>, context: WorkerContext): Promise<void>;
}

export class HandlerError extends Error {}

export async function processMessage(
  importPath: string,
  pgmqMessage: PgmqMessage<unknown>,
  sql: postgres.Sql
): Promise<void> {
  const queueName = pgmqMessage.queueName;

  // Dynamically load the queue handler
  let handlerModule;
  try {
    handlerModule = await import(importPath);
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

function getImportPath(queueName: string, queuesPath?: string) {
  // Sanitize queue name for valid filename (spaces and dashes to underscores)
  const sanitizedQueueName = queueName.replace(/\s\-/g, "_");
  return queuesPath
    ? `${queuesPath}/${sanitizedQueueName}.ts`
    : `${Deno.cwd()}/queues/${sanitizedQueueName}.ts`;
}

export function createWorker(
  options: WorkerOptions
): ThreadWorker<Task, Promise<void>> {
  const sql =
    typeof options.connection === "string"
      ? postgres(options.connection)
      : options.connection;

  async function enhancedProcess(task: Task | undefined) {
    if (!task) throw new Error("No task provided to worker.");

    const pgmq = new Pgmq(sql, task.queueName, {});
    const pgmqMessage = new PgmqMessage<unknown>(pgmq, task.message);
    let importPath = getImportPath(task.queueName, options.queuesPath);

    if (options.onBeforeProcess) {
      importPath = await options.onBeforeProcess({ pgmqMessage, importPath });
    }
    let result;
    try {
      result = await processMessage(importPath, pgmqMessage, sql);
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

  return new ThreadWorker(enhancedProcess);
}
