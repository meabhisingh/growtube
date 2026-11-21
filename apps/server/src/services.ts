import { createAuth as createConfiguredAuth } from "@open-vidiq/auth";
import { type Database, createDb } from "@open-vidiq/db";

import { ENV } from "./env.server";

export function getDb(): Database {
  return createDb(ENV);
}
export async function createAuth(database?: Database) {
  return createConfiguredAuth(ENV, database ?? (await getDb()));
}
