import { FixedThreadPool, PoolEvents } from "poolifier";
import { connectionFrom } from "../connectionFrom.ts";
import { Pgmq } from "../pgmq/Pgmq.ts";
import { GenericPgmq, Task } from "../types/types.ts";
import { QueueRunnerOptions } from "./QueueRunnerOptions.ts";

export async function startQueueRunner(options: QueueRunnerOptions) {
  const sql = connectionFrom(options.connection);
  const POOL_SIZE = options.poolSize ?? 1;
  const MESSAGE_TIMEOUT = options.messageTimeout ?? 5;
  const SLEEP_TIMEOUT = options.sleepTimeout ?? 1000;

  const queueNames = Array.isArray(options.queues)
    ? options.queues
    : Object.keys(options.queues);
  const schemas = !Array.isArray(options.queues) ? options.queues : {};

  if (typeof options.connection === "string") {
    Deno.env.set("DATABASE_URL", options.connection);
  } else if (!options.worker) {
    throw new Error(
      "When using a sql client, a custom worker file must be provided in options.worker"
    );
  }

  const workerFileURL = options.worker
    ? options.worker
    : new URL("../worker/defaultWorker.ts", import.meta.url);
  const pool = new FixedThreadPool(POOL_SIZE, workerFileURL, {
    errorEventHandler: (e: ErrorEvent) => {
      // Prevent worker error taking down the main thread
      e.preventDefault();
      console.log("Worker pool error event:");
      console.error(e);
    },
    restartWorkerOnError: true,
    enableEvents: true,
    startWorkers: true,
    enableTasksQueue: true,
    tasksQueueOptions: {
      size: POOL_SIZE,
    },
  });

  let busy = false;
  let shuttingDown = false;

  pool.eventTarget?.addEventListener(PoolEvents.busy, () => {
    busy = true;
  });
  pool.eventTarget?.addEventListener(PoolEvents.busyEnd, () => {
    busy = false;
  });

  await new Promise((resolve) => {
    const abortController = new AbortController();
    pool.eventTarget?.addEventListener(
      PoolEvents.ready,
      () => {
        resolve(void 0);
        abortController.abort();
      },
      { signal: abortController.signal }
    );
  });

  // Handle shutdown signals for graceful termination
  function handleShutdown() {
    if (!shuttingDown) {
      console.log("Received quit signal, starting graceful shutdown...");
      shuttingDown = true;
    }
  }

  Deno.addSignalListener("SIGTERM", handleShutdown);
  Deno.addSignalListener("SIGINT", handleShutdown);

  async function waitForReady() {
    if (!busy) return;
    await new Promise<void>((resolve) => {
      const listener = () => {
        resolve();
      };
      pool.eventTarget?.addEventListener(PoolEvents.busyEnd, listener);
    });
  }

  if (options.onReady) {
    await options.onReady();
  }

  const defaultOptions = {
    messageTimeout: MESSAGE_TIMEOUT,
    qty: 1,
  };

  async function processQueue(queueName: string): Promise<number> {
    // Don't read new messages if we're shutting down
    if (shuttingDown) return 0;

    const schema = schemas[queueName];
    const pgmq: GenericPgmq = schema
      ? new Pgmq(sql, queueName, {
          ...defaultOptions,
          schema,
          onInvalid: async (message, error) => {
            if (options.onInvalidMessage) {
              await options.onInvalidMessage(error, { pgmq, message });
            } else {
              // Automatically archive invalid messages
              await pgmq.archive(message.msg_id);
              console.log(
                `Archived invalid message ${message.msg_id} from queue ${queueName}:`,
                error,
                JSON.stringify(message.message)
              );
            }
          },
        })
      : new Pgmq(sql, queueName, defaultOptions);

    // Allow custom logic before processing
    if (options.onBeforeProcess) {
      await options.onBeforeProcess({ pgmq });
    }

    try {
      const messages = await pgmq.read();

      if (messages.length > 0) {
        const task: Task = { queueName, message: messages[0].data };

        if (options.onBeforeExecute) {
          try {
            await options.onBeforeExecute({ pgmq, task });
          } catch (_err) {
            return 1; // Skip processing this task
          }
        }

        pool.execute(task);
      }

      return messages.length;
    } catch (err) {
      if (options.onError) {
        await options.onError(err as Error, { pgmq });
      }
    }

    return 0;
  }

  while (!shuttingDown) {
    await waitForReady();
    const messageCounts = await Promise.all(
      queueNames.map((q) => processQueue(q))
    ).catch((err) => {
      console.error("Error processing queues:", err);
      return [0];
    });
    // If any messages were processed, immediately check again for more
    if (messageCounts.some((count) => count > 0)) continue;
    // If no messages were processed, wait a bit before checking again
    await new Promise((r) => setTimeout(r, SLEEP_TIMEOUT));
  }

  // Call custom shutdown logic
  if (options.onShutdown) {
    await options.onShutdown();
  }

  // Wait for all currently processing jobs to finish
  console.log("Closing worker pool...");
  await pool.destroy();
  console.log("Pool closed. Graceful shutdown complete.");
}
