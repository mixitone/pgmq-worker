import { createWorker } from "../mod.ts";

export default createWorker({ connection: Deno.env.get("DATABASE_URL")! });
