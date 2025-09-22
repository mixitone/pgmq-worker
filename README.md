# @mixitone/pgmq-worker

A worker runtime for Deno and [pgmq](https://pgmq.github.io/pgmq/), providing background
job processing with worker pools, message schemas, and graceful shutdown
handling.

## Why?

Supabase offers pgmq for hosting queues in with similar semantics to SQS.
However, they don't have a way to host long running background tasks. This
package provides a simple runtime that you can easily deploy to your own
hosting.

## Features

- **Message Queue Processing**: Built on top of PGMQ for reliable message queuing
- **Worker Pools**: Configurable thread pools using [Poolifier](https://github.com/poolifier/poolifier)
- **Schema Validation**: Optional [Zod](https://zod.dev) schemas for message validation

## Quick Start

Install from [jsr](https://jsr.io/@mixitone/pgmq-worker)

### Basic Setup

Create a pgmq queue:

```sql
SELECT * FROM pgmq.create('my_queue');
```

Create a `main.ts` file:

```typescript
import { startQueueRunner } from "jsr:@mixitone/pgmq-worker@0.1.0";

await startQueueRunner({
  connection: "postgres://username:password@host:port/postgres",
  queues: ["my_queue"],
  onReady: () => {
    console.log("Ready to process messages");
  },
});
```

Create a queue file `queues/my_queue.ts`:

```typescript
import { QueueHandler } from "jsr:@mixitone/pgmq-worker@0.1.0";

interface MyMessage {
  output: string;
}

const handleMessage: QueueHandler<MyMessage> = async (message) {
  console.log("Message:", message.payload.output);
  await message.delete();
};

export default handleMessage;
```

Send a message:

```sql
PERFORM pgmq.send('my_queue', '{"output": "hello"}');
```

Or using the built in pgmq class:

```typescript
import { Pgmq } from "jsr:@mixitone/pgmq-worker";

const pgmq = new Pgmq("postgres://username@host/db", "my_queue");
await pgmq.send({ output: "hello" });
```

## Message schemas

pgmq-worker can use [Zod](https://zod.dev/) to validate messages, both when
sending and receiving:

Create a Zod schema in `schema.ts`:

```typescript schema.ts
export const myMessageSchema = z.object({
  output: z.string(),
});
```

Update `main.ts`

```typescript main.ts
import { myMessageSchema } from "./schema.ts";

await startQueueRunner({
  connection: "postgres://username:password@host:port/postgres",
  queues: {
    "my_queue": myMessageSchema
  },
  onReady: () => { console.log('Ready to process messages'); }
  onInvalidMessage: async (errors, { pgmq, message }) => {
    console.error("Message did not conform to schema", errors);
    await pgmq.archive(message.msg_id);
  }
});
```

Note that if you do not provide an `onInvalidMessage` callback then the message
will be archived. If you do provide the callback then you must deal with the
message.

Update `queues/my_queue.ts`

```typescript
import { myMessageSchema } from "../schema.ts";

const handleMessage: QueueHandler<z.infer<MyMessageSchema>> = async (message) {
  console.log("Message:", message.payload.output);
  await message.delete();
};

export default handleMessage;
```

Sending a message using the schema:

```typescript
import { Pgmq } from "jsr:@mixitone/pgmq-worker";
import { myMessageSchema } from "./schema.ts";

const pgmq = new Pgmq("postgres://username@host/db", "my_queue", {
  schema: MyMessageSchema,
});
await pgmq.send({ invalidProp: "hello" }); // Error
await pgmq.send({ output: "hello" }); // Success
```

## Message timeouts

The default timeout time, that is the time the message will become unavailable
on the queue while you process it, is 5 seconds. It's important to note that if
you do not delete or archive the message within this timeout window then it will
appear back on the queue and will be re-processed. You can change the default by
passing messageTimeout to the runner:

```
await startQueueRunner({
  messageTimeout: 30
});
```

You can also modify the timeout later, which is ideal for messages that take
longer to process:

```typescript
const handleMessage: QueueHandler<MyMessage> = async (message) {
  await message.setTimeout(300);
  // ... long process, up to 5 minutes
  await message.delete();
};
```

## Custom worker

You can customize the worker process to get more control over message
processing. For example, maybe we want to capture all errors and send them to
Sentry:

Create `custom-worker.ts`:

```typescript
import * as Sentry from "npm:@sentry/deno";
import { createWorker } from "jsr:@mixitone/pgmq-worker";

Sentry.init({});

export default createWorker({
  onError: async (error, message) => {
    Sentry.captureException(error, {
      extra: { queueName: message.queueName, payload: message.payload },
    });
    console.error(
      "Custom worker: Error processing task",
      "cause" in error ? error.cause : error
    );
    // Archive the message for later analysis
    await message.archive();
  },
});
```

Update `main.ts`:

```typescript
import { startQueueRunner } from "jsr:@mixitone/pgmq-worker@0.1.0";

await startQueueRunner({
  connection: "postgres://username:password@host:port/postgres",
  worker: new URL("./custom-worker.ts", import.meta.url),
  queues: ["my_queue"],
  onReady: () => {
    console.log("Ready to process messages");
  },
});
```

See [WorkerOptions.ts](./src/worker/WorkerOptions.ts) for more hooks.

## Connection options

If you need more control over the postgres connection then you can create the connection and pass it to the runner and a custom worker. You MUST define a custom worker file to do this:

Update `main.ts`:

```typescript
import { startQueueRunner } from "jsr:@mixitone/pgmq-worker@0.1.0";
import postgres from "npm:postgres@3.4.7";

const connection = postgres("postgres://...", {
  idle_timeout: 5,
  connect_timeout: 5,
  max_lifetime: 10,
});

await startQueueRunner({
  connection,
  worker: new URL("./custom-worker.ts", import.meta.url),
  queues: ["my_queue"],
  onReady: () => {
    console.log("Ready to process messages");
  },
});
```

Update `custom-worker.ts`:

```typescript
import { createWorker } from "jsr:@mixitone/pgmq-worker";

const connection = postgres("postgres://...", {
  idle_timeout: 5,
  connect_timeout: 5,
  max_lifetime: 10,
});

export default createWorker({ connection });
```

Note that the runner and each worker will have a connection to postgres. The number of postgres connections will be N+1 where N is the poolSize (defaults to 1) given to startQueueRunner.

## Deploying

Now that you've defined your queues and processing code, you can deploy this out with docker very easily.

Create a `Dockerfile`:

```Dockerfile
FROM denoland/deno:latest

# Create working directory
WORKDIR /app

# Copy source
COPY . .

# Compile the main app
RUN deno cache main.ts
# Compile the worker app
RUN deno cache custom-worker.ts
RUN deno cache queues/*.ts

# Run the app
CMD ["deno", "run", "--allow-all", "main.ts"]
```

```bash
docker build . -t my/workers
docker run my/workers
```

As external references, like the database connection string, are controlled by your own main.ts file supporting a different environment would work like this:

Update `main.ts`

```typescript
import { startQueueRunner } from "jsr:@mixitone/pgmq-worker@0.1.0";

await startQueueRunner({
  connection: Deno.env.get("DATABASE_URL"),
  queues: ["my_queue"],
  onReady: () => {
    console.log("Ready to process messages");
  },
});
```

```bash
docker run -e DATABASE_URL=postgres://connection_url my/workers
```
