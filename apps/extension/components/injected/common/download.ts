/** Saves text as a file from a content script (blob URL + temporary <a download>). */
export function downloadText(
	filename: string,
	text: string,
	type = "text/plain",
): void {
	const blob = new Blob([text], { type: `${type};charset=utf-8` });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.rel = "noopener";
	a.style.display = "none";
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "My Video: Title?" -> "my-video-title" (safe for file names). */
export function slugify(text: string, max = 60): string {
	return (
		text
			.toLowerCase()
			.normalize("NFKD")
			.replace(/[̀-ͯ]/g, "")
			.replace(/[^\p{L}\p{N}]+/gu, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, max) || "video"
	);
}
