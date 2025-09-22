// deno-lint-ignore-file no-explicit-any
import { assertEquals } from "https://deno.land/std/assert/mod.ts";
// deno-lint-ignore no-unversioned-import
import { Stub, stub } from "jsr:@std/testing/mock";
import { RawPgmqMessage } from "../types/types.ts";
import { PgmqMessage } from "./PgmqMessage.ts";

// Mock Pgmq interface for testing
interface MockPgmq {
  queueName: string;
  delete: (msgId: number) => Promise<void>;
  archive: (msgId: number) => Promise<void>;
  setTimeout: (msgId: number, seconds: number) => Promise<void>;
}

// Create a mock Pgmq instance
function createMockPgmq(queueName: string): {
  pgmq: MockPgmq;
  deleteStub: Stub;
  archiveStub: Stub;
  setTimeoutStub: Stub;
} {
  const mockPgmq: MockPgmq = {
    queueName,
    delete: async (_msgId: number) => {},
    archive: async (_msgId: number) => {},
    setTimeout: async (_msgId: number, _seconds: number) => {},
  };

  const deleteStub = stub(mockPgmq, "delete");
  const archiveStub = stub(mockPgmq, "archive");
  const setTimeoutStub = stub(mockPgmq, "setTimeout");

  return {
    pgmq: mockPgmq,
    deleteStub,
    archiveStub,
    setTimeoutStub,
  };
}

Deno.test("PgmqMessage - getters", () => {
  const { pgmq } = createMockPgmq("test_queue");
  const rawMessage: RawPgmqMessage = {
    msg_id: 123,
    read_ct: 2,
    enqueued_at: "2023-01-01T00:00:00.000Z",
    vt: "2023-01-01T00:05:00.000Z",
    message: { text: "Hello", count: 42 },
  };

  const pgmqMessage = new PgmqMessage(pgmq as any, rawMessage);

  assertEquals(pgmqMessage.id, 123);
  assertEquals(pgmqMessage.queueName, "test_queue");
  assertEquals(pgmqMessage.readCount, 2);
  assertEquals(pgmqMessage.enqueuedAt, new Date("2023-01-01T00:00:00.000Z"));
  assertEquals(pgmqMessage.visibleAt, new Date("2023-01-01T00:05:00.000Z"));
  assertEquals(pgmqMessage.payload, { text: "Hello", count: 42 });
});

Deno.test("PgmqMessage - delete", async () => {
  const { pgmq, deleteStub } = createMockPgmq("test_queue");
  const rawMessage: RawPgmqMessage = {
    msg_id: 456,
    read_ct: 1,
    enqueued_at: "2023-01-01T00:00:00.000Z",
    vt: "2023-01-01T00:05:00.000Z",
    message: { action: "delete" },
  };

  const pgmqMessage = new PgmqMessage(pgmq as any, rawMessage);

  await pgmqMessage.delete();

  assertEquals(deleteStub.calls.length, 1);
  assertEquals(deleteStub.calls[0].args, [456]);
});

Deno.test("PgmqMessage - archive", async () => {
  const { pgmq, archiveStub } = createMockPgmq("test_queue");
  const rawMessage: RawPgmqMessage = {
    msg_id: 789,
    read_ct: 1,
    enqueued_at: "2023-01-01T00:00:00.000Z",
    vt: "2023-01-01T00:05:00.000Z",
    message: { action: "archive" },
  };

  const pgmqMessage = new PgmqMessage(pgmq as any, rawMessage);

  await pgmqMessage.archive();

  assertEquals(archiveStub.calls.length, 1);
  assertEquals(archiveStub.calls[0].args, [789]);
});

Deno.test("PgmqMessage - setTimeout", async () => {
  const { pgmq, setTimeoutStub } = createMockPgmq("test_queue");
  const rawMessage: RawPgmqMessage = {
    msg_id: 101,
    read_ct: 1,
    enqueued_at: "2023-01-01T00:00:00.000Z",
    vt: "2023-01-01T00:05:00.000Z",
    message: { action: "timeout" },
  };

  const pgmqMessage = new PgmqMessage(pgmq as any, rawMessage);

  await pgmqMessage.setTimeout(30);

  assertEquals(setTimeoutStub.calls.length, 1);
  assertEquals(setTimeoutStub.calls[0].args, [101, 30]);
});
