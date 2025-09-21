import postgres from "postgres";

export function connectionFrom(connection: Connection) {
  return typeof connection === "string" ? postgres(connection) : connection;
}

export type Connection = string | postgres.Sql;
