import { Pgmq } from "../pgmq/Pgmq.ts";

export interface RawPgmqMessage {
  msg_id: number;
  read_ct: number;
  enqueued_at: string;
  vt: string;
  payload: unknown;
}

export interface Task {
  queueName: string;
  message: RawPgmqMessage;
}

export type GenericPgmq = InstanceType<typeof Pgmq>;
