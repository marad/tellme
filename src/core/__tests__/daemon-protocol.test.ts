import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { writeMessage, readMessages } from "../daemon-protocol.js";

describe("daemon-protocol framing", () => {
	it("roundtrips multiple messages through a stream", async () => {
		const stream = new PassThrough();
		const messages: any[] = [];

		const reader = (async () => {
			for await (const msg of readMessages(stream)) {
				messages.push(msg);
			}
		})();

		await writeMessage(stream, { kind: "speak", text: "hello" });
		await writeMessage(stream, { kind: "ack" });
		await writeMessage(stream, { kind: "done", ok: true });
		stream.end();

		await reader;

		expect(messages).toEqual([
			{ kind: "speak", text: "hello" },
			{ kind: "ack" },
			{ kind: "done", ok: true },
		]);
	});

	it("buffers partial frames across data events", async () => {
		const stream = new PassThrough();
		const messages: any[] = [];
		const reader = (async () => {
			for await (const msg of readMessages(stream)) messages.push(msg);
		})();

		const json = Buffer.from(JSON.stringify({ kind: "test", value: 42 }), "utf-8");
		const header = Buffer.alloc(4);
		header.writeUInt32BE(json.length, 0);
		const full = Buffer.concat([header, json]);

		// Write the header + half the JSON, wait, then the rest.
		stream.write(full.subarray(0, 4 + Math.floor(json.length / 2)));
		await new Promise((r) => setTimeout(r, 10));
		stream.write(full.subarray(4 + Math.floor(json.length / 2)));
		stream.end();

		await reader;
		expect(messages).toEqual([{ kind: "test", value: 42 }]);
	});

	it("handles multiple messages arriving in a single chunk", async () => {
		const stream = new PassThrough();
		const messages: any[] = [];
		const reader = (async () => {
			for await (const msg of readMessages(stream)) messages.push(msg);
		})();

		const j1 = Buffer.from(JSON.stringify({ a: 1 }), "utf-8");
		const j2 = Buffer.from(JSON.stringify({ b: 2 }), "utf-8");
		const h1 = Buffer.alloc(4); h1.writeUInt32BE(j1.length, 0);
		const h2 = Buffer.alloc(4); h2.writeUInt32BE(j2.length, 0);
		stream.write(Buffer.concat([h1, j1, h2, j2]));
		stream.end();

		await reader;
		expect(messages).toEqual([{ a: 1 }, { b: 2 }]);
	});
});
