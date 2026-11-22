/** Concurrency limiting and retry with exponential backoff. */

export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** Runs at most `max` tasks at once; the rest wait in FIFO order. */
export function createLimiter(max: number): Limiter {
	let active = 0;
	const queue: (() => void)[] = [];
	const next = () => {
		if (active >= max) return;
		const start = queue.shift();
		if (start) start();
	};
	return <T>(task: () => Promise<T>) =>
		new Promise<T>((resolve, reject) => {
			const start = () => {
				active++;
				task()
					.then(resolve, reject)
					.finally(() => {
						active--;
						next();
					});
			};
			queue.push(start);
			next();
		});
}

export class HttpError extends Error {
	readonly status: number;
	readonly retryAfterMs: number | null;
	readonly body: string;
	constructor(
		status: number,
		message: string,
		body = "",
		retryAfterMs: number | null = null,
	) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.body = body;
		this.retryAfterMs = retryAfterMs;
	}
}

export function isRetryableStatus(status: number): boolean {
	return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

export const sleep = (ms: number, signal?: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
		const t = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(t);
				reject(signal.reason ?? new Error("Aborted"));
			},
			{ once: true },
		);
	});

export type RetryOptions = {
	retries?: number;
	baseDelayMs?: number;
	maxDelayMs?: number;
	signal?: AbortSignal;
	/** Default: HttpError with a retryable status, or a network TypeError */
	shouldRetry?: (error: unknown, attempt: number) => boolean;
};

function defaultShouldRetry(error: unknown): boolean {
	if (error instanceof HttpError) return isRetryableStatus(error.status);
	// fetch() rejects with TypeError on network failure
	return error instanceof TypeError;
}

/** Retries `fn` with full-jitter exponential backoff, honoring Retry-After. */
export async function withRetry<T>(
	fn: (attempt: number) => Promise<T>,
	opts: RetryOptions = {},
): Promise<T> {
	const retries = opts.retries ?? 3;
	const base = opts.baseDelayMs ?? 500;
	const maxDelay = opts.maxDelayMs ?? 8_000;
	const shouldRetry = opts.shouldRetry ?? defaultShouldRetry;
	for (let attempt = 0; ; attempt++) {
		try {
			return await fn(attempt);
		} catch (error) {
			if (
				opts.signal?.aborted ||
				attempt >= retries ||
				!shouldRetry(error, attempt)
			) {
				throw error;
			}
			const hinted = error instanceof HttpError ? error.retryAfterMs : null;
			const backoff = Math.min(maxDelay, base * 2 ** attempt);
			const delay =
				hinted ?? Math.round(backoff / 2 + Math.random() * (backoff / 2));
			await sleep(Math.min(delay, 30_000), opts.signal);
		}
	}
}

export function parseRetryAfter(header: string | null): number | null {
	if (!header) return null;
	const secs = Number(header);
	if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
	const at = Date.parse(header);
	return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}
