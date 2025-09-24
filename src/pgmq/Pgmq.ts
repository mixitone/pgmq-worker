import postgres from "postgres";
import * as z from "zod";
import { PgmqMessage } from "./PgmqMessage.ts";
import { RawPgmqMessage } from "../types/types.ts";
import { Connection, connectionFrom } from "../connectionFrom.ts";

export interface PgmqOptionsWithSchema<S extends z.ZodTypeAny> {
  messageTimeout?: number; // in seconds
  qty?: number;
  schema: S;
  onInvalid?: (
    message: RawPgmqMessage,
    error: z.ZodError
  ) => Promise<void> | void;
}
export interface PgmqOptionsWithoutSchema {
  messageTimeout?: number; // in seconds
  qty?: number;
}
export type PgmqOptions<S extends z.ZodTypeAny | undefined> =
  S extends z.ZodTypeAny ? PgmqOptionsWithSchema<S> : PgmqOptionsWithoutSchema;

export class SchemaError extends Error {
  constructor(public queueName: string, public errors: z.ZodError) {
    super("Message schema validation failed for queue: " + queueName);
    this.name = "SchemaError";
    this.cause = errors;
  }
}

export class Pgmq<S extends z.ZodTypeAny | undefined = undefined> {
  private sql: postgres.Sql;

  constructor(
    connection: Connection,
    readonly queueName: string,
    private options: S extends z.ZodTypeAny
      ? PgmqOptionsWithSchema<S>
      : PgmqOptionsWithoutSchema
  ) {
    this.sql = connectionFrom(connection);
  }

  async archive(msgId: number) {
    await this.sql`SELECT pgmq.archive(${this.queueName}, ${msgId})`;
  }

  async read<
    T extends S extends z.ZodTypeAny ? z.output<S> : unknown
  >(): Promise<PgmqMessage<T>[]> {
    const rawMessages = await this.sql<
      RawPgmqMessage[]
    >`SELECT * FROM pgmq.read(${this.queueName}, ${
      this.options.messageTimeout || 30
    }, ${this.options.qty || 1})`;
    const messages: PgmqMessage<T>[] = [];

    for (const rawMessage of rawMessages) {
      if ("schema" in this.options) {
        const message = this.options.schema.safeParse(rawMessage.message);
        if (message.success) {
          messages.push(
            new PgmqMessage<T>(this, { ...rawMessage, message: message.data })
          );
        } else if (this.options.onInvalid) {
          // Automatically archive invalid messages
          await this.options.onInvalid(rawMessage, message.error);
        } else {
          throw new SchemaError(this.queueName, message.error);
        }
      } else {
        messages.push(new PgmqMessage<T>(this, rawMessage));
      }
    }

    return messages;
  }

  async send<T extends S extends z.ZodTypeAny ? z.input<S> : unknown>(
    message: T,
    delay: number = 0
  ) {
    if ("schema" in this.options) {
      const validatedMessage = this.options.schema.safeParse(message);

      if (!validatedMessage.success) {
        throw new SchemaError(this.queueName, validatedMessage.error);
      }

      const serialized = `'${JSON.stringify(validatedMessage.data)}'`;
      await this.sql`SELECT pgmq.send(${this.queueName}, ${this.sql.unsafe(
        serialized
      )}, ${delay})`;
    } else {
      const serialized = `'${JSON.stringify(message)}'`;
      await this.sql`SELECT pgmq.send(${this.queueName}, ${this.sql.unsafe(
        serialized
      )}, ${delay})`;
    }
  }

  async setTimeout(msgId: number, seconds: number) {
    await this.sql`SELECT pgmq.set_vt(${this.queueName}, ${msgId}, ${seconds})`;
  }

  async delete(msgId: number) {
    await this.sql`SELECT pgmq.delete(${this.queueName}, ${msgId})`;
  }
}
