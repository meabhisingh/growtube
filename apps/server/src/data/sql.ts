import { type Database, getTableName, type SQL, sql } from "@open-vidiq/db";

/** A drizzle client or an open transaction. */
export type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Tx;

type NamedColumn = { name: string };
type NamedTable = Parameters<typeof getTableName>[0];

const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** `excluded."col"` inside `ON CONFLICT DO UPDATE`. */
export function excluded(column: NamedColumn): SQL {
	return sql.raw(`excluded.${ident(column.name)}`);
}

/** Fully-qualified `"table"."col"` (the existing row in `ON CONFLICT DO UPDATE`). */
export function qualified(table: NamedTable, column: NamedColumn): SQL {
	return sql.raw(`${ident(getTableName(table))}.${ident(column.name)}`);
}

/** Upsert setter that never overwrites a known value with NULL/undefined. */
export function keepKnown(table: NamedTable, column: NamedColumn): SQL {
	return sql`coalesce(${excluded(column)}, ${qualified(table, column)})`;
}

/** `VALUES (...), (...)` list for `UPDATE ... FROM (VALUES ...)` batches. */
export function valuesList(rows: SQL[]): SQL {
	return sql.join(rows, sql`, `);
}

export function toIso(date: Date | null | undefined): string | null {
	return date ? date.toISOString() : null;
}

/** `YYYY-MM-DD` of the UTC day containing `date`. */
export function utcDay(date: Date): string {
	return date.toISOString().slice(0, 10);
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size)
		out.push(items.slice(i, i + size));
	return out;
}
