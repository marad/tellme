/**
 * Incremental sentence detector for streaming text.
 *
 * `push(text)` appends text and returns every complete sentence newly
 * available, each trimmed. A sentence boundary is `[.!?]` followed by
 * whitespace. A trailing terminator with no following whitespace yet is
 * NOT a boundary — keep buffering so the next push can decide.
 *
 * `flush()` returns whatever residue remains as a final sentence (or
 * `null` if the buffer is empty/whitespace).
 */
export class SentenceBuffer {
	private buf: string = "";

	push(text: string): string[] {
		if (!text) return [];
		this.buf += text;

		const sentences: string[] = [];
		let start = 0;
		// Scan up to (length - 1) so we always have at least one char to
		// inspect after a candidate terminator.
		for (let i = 0; i < this.buf.length - 1; i++) {
			const ch = this.buf[i];
			if (ch === "." || ch === "!" || ch === "?") {
				const next = this.buf[i + 1];
				if (next === " " || next === "\t" || next === "\n" || next === "\r") {
					const sentence = this.buf.slice(start, i + 1).trim();
					if (sentence.length > 0) sentences.push(sentence);
					start = i + 2;
					i = start - 1; // -1 because the loop will ++
				}
			}
		}

		this.buf = this.buf.slice(start);
		return sentences;
	}

	flush(): string | null {
		const residue = this.buf.trim();
		this.buf = "";
		return residue.length > 0 ? residue : null;
	}
}
