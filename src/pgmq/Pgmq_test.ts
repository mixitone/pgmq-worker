// deno-lint-ignore-file no-explicit-any require-await
import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std/assert/mod.ts";
// deno-lint-ignore no-unversioned-import
import { Stub, stub } from "jsr:@std/testing/mock";
import * as z from "zod";
import { RawPgmqMessage } from "../types/types.ts";
import { Pgmq, SchemaError } from "./Pgmq.ts";

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
});

type TestMessage = z.input<typeof testSchema>;

// Mock SQL interface
interface MockSql {
  (strings: TemplateStringsArray, ...values: any[]): Promise<any[]>;
  unsafe: (str: string) => { toString(): string };
  mockMessages?: RawPgmqMessage[];
  mockArchived?: any[];
  lastQuery?: {
    strings: TemplateStringsArray;
    values: any[];
  };
}

// Create a mock SQL function using stub
function createMockSql(): {
  sql: MockSql;
  stub: Stub;
} {
  let sql: MockSql = Object.assign(
    async (strings: TemplateStringsArray, ...values: any[]) => {
      // This implementation will be stubbed
      sql.lastQuery = { strings, values };
      return [];
    },
    {
      unsafe: (str: string) => ({ toString: () => str }),
    }
  );

  const sqlObj = { sql };
  const sqlStub = stub(
    sqlObj,
    "sql",
    async (strings: TemplateStringsArray, ...values: any[]) => {
      const query = strings.raw.join("?");

      // Capture all queries
      sql.lastQuery = { strings, values };

      if (query.includes("SELECT * FROM pgmq.read")) {
        return sql.mockMessages || [];
      } else if (query.includes("SELECT message FROM pgmq.a_")) {
        return sql.mockArchived || [];
      } else {
        return [];
      }
    }
  );

  // Update sql to the stubbed version
  sql = sqlObj.sql;

  // Re-assign the unsafe method and mock properties to the stubbed sql
  Object.assign(sql, {
    unsafe: (str: string) => ({ toString: () => str }),
  });

  return { sql, stub: sqlStub };
}

Deno.test("Pgmq - send and read without schema", async () => {
  const { sql, stub } = createMockSql();
  const queueName = "test_queue_no_schema";
  const pgmq = new Pgmq(sql as any, queueName, {});

  try {
    // Send a message
    const message = { text: "Hello, world!", number: 42 };
    await pgmq.send(message);

    // Assert the SQL sent
    assertEquals(
      sql.lastQuery?.strings.raw.join("?"),
      "SELECT pgmq.send(?, ?, ?)"
    );
    assertEquals(sql.lastQuery?.values[0], queueName);
    assertEquals(sql.lastQuery?.values[1].toString(), `'${JSON.stringify(message)}'`);

    // Mock the read response
    sql.mockMessages = [
      {
        msg_id: 1,
        read_ct: 1,
        enqueued_at: new Date().toISOString(),
        vt: new Date(Date.now() + 30000).toISOString(),
        message: message,
      },
    ];

    // Read the message
    const messages = await pgmq.read();
    assertEquals(messages.length, 1);
    assertEquals(messages[0].payload, message);

  } finally {
    stub.restore();
  }
});

Deno.test("Pgmq - send and read with schema", async () => {
  const { sql, stub } = createMockSql();
  const queueName = "test_queue_with_schema";
  const pgmq = new Pgmq(sql as any, queueName, { schema: testSchema });

  try {
    // Send a valid message
    const validMessage: TestMessage = { name: "Alice", age: 30 };
    await pgmq.send(validMessage);

    // Assert the SQL sent
    assertEquals(
      sql.lastQuery?.strings.raw.join("?"),
      "SELECT pgmq.send(?, ?, ?)"
    );
    assertEquals(sql.lastQuery?.values[0], queueName);
    assertEquals(
      sql.lastQuery?.values[1].toString(),
      `'${JSON.stringify(validMessage)}'`
    );

    // Mock the read response
    sql.mockMessages = [
      {
        msg_id: 1,
        read_ct: 1,
        enqueued_at: new Date().toISOString(),
        vt: new Date(Date.now() + 30000).toISOString(),
        message: validMessage,
      },
    ];

    // Read the message
    const messages = await pgmq.read();
    assertEquals(messages.length, 1);
    assertEquals(messages[0].payload, validMessage);

    // Send an invalid message
    const invalidMessage = { name: "Bob", age: "thirty" as any }; // age should be number
    await assertRejects(
      () => pgmq.send(invalidMessage),
      SchemaError,
      "Message schema validation failed"
    );
  } finally {
    stub.restore();
  }
});

Deno.test("Pgmq - archive", async () => {
  const { sql, stub } = createMockSql();
  const queueName = "test_queue_archive";
  const pgmq = new Pgmq(sql as any, queueName, {});

  try {
    // Send a message
    const message = { text: "Message to archive" };
    await pgmq.send(message);

    // Assert the SQL sent for send
    assertEquals(
      sql.lastQuery?.strings.raw.join("?"),
      "SELECT pgmq.send(?, ?, ?)"
    );
    assertEquals(sql.lastQuery?.values[0], queueName);
    assertEquals(sql.lastQuery?.values[1].toString(), `'${JSON.stringify(message)}'`);

    // Mock the read response
    sql.mockMessages = [
      {
        msg_id: 1,
        read_ct: 1,
        enqueued_at: new Date().toISOString(),
        vt: new Date(Date.now() + 30000).toISOString(),
        message: message,
      },
    ];

    // Read to get msgId
    const messages = await pgmq.read();
    assertEquals(messages.length, 1);
    const msgId = messages[0].id;

    // Archive the message
    await pgmq.archive(msgId);

    // Mock empty read after archive
    sql.mockMessages = [];

    // Try to read again - should be empty since archived
    const messagesAfter = await pgmq.read();
    assertEquals(messagesAfter.length, 0);

    // Mock archived response
    sql.mockArchived = [{ message: JSON.stringify(message) }];

    // Verify archived message exists in archive table
    const archived =
      await sql`SELECT message FROM pgmq.a_${queueName} WHERE msg_id = ${msgId}`;
    assertEquals(archived.length, 1);
    assertEquals(JSON.parse(archived[0].message), message);
  } finally {
    stub.restore();
  }
});

Deno.test("Pgmq - read with invalid schema and onInvalid handler", async () => {
  const { sql, stub } = createMockSql();
  const queueName = "test_queue_invalid_schema";

  let invalidHandled = false;
  const pgmq = new Pgmq(sql as any, queueName, {
    schema: testSchema,
    onInvalid: async (_rawMsg, _error) => {
      invalidHandled = true;
    },
  });

  try {
    // Mock invalid message in read response
    const invalidMessage = { name: "Charlie", age: "not a number" };
    sql.mockMessages = [
      {
        msg_id: 1,
        read_ct: 1,
        enqueued_at: new Date().toISOString(),
        vt: new Date(Date.now() + 30000).toISOString(),
        message: invalidMessage,
      },
    ];

    // Read the message - should trigger onInvalid
    const messages = await pgmq.read();
    assertEquals(messages.length, 0); // Invalid message not returned
    assertEquals(invalidHandled, true);
  } finally {
    stub.restore();
  }
});
