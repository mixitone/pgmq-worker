import { RawPgmqMessage } from "../types/types.ts";
import { Pgmq } from "./Pgmq.ts";

export class PgmqMessage<T> {
  constructor(
    // deno-lint-ignore no-explicit-any
    private readonly queue: Pgmq<any>,
    readonly data: RawPgmqMessage
  ) {}

  get id(): number {
    return this.data.msg_id;
  }

  get queueName(): string {
    return this.queue.queueName;
  }

  get readCount(): number {
    return this.data.read_ct;
  }

  get enqueuedAt(): Date {
    return new Date(this.data.enqueued_at);
  }

  get visibleAt(): Date {
    return new Date(this.data.vt);
  }

  get payload(): T {
    return this.data.message as T;
  }

  async delete(): Promise<void> {
    await this.queue.delete(this.data.msg_id);
  }

  async archive(): Promise<void> {
    await this.queue.archive(this.data.msg_id);
  }

  async setTimeout(seconds: number): Promise<void> {
    await this.queue.setTimeout(this.data.msg_id, seconds);
  }
}
