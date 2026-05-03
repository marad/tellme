import { connect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const PROTOCOL_VERSION = 1;
const MAX_FRAME = 16 * 1024 * 1024;

export function socketPath() {
	const dir = process.env.TELLME_DAEMON_DIR || join(homedir(), ".tellme");
	return join(dir, "daemon.sock");
}

function encodeFrame(obj) {
	const json = Buffer.from(JSON.stringify(obj), "utf8");
	if (json.length > MAX_FRAME) throw new Error("frame too large");
	const header = Buffer.alloc(4);
	header.writeUInt32BE(json.length, 0);
	return Buffer.concat([header, json]);
}

function makeFrameReader() {
	let buf = Buffer.alloc(0);
	return (chunk) => {
		buf = Buffer.concat([buf, chunk]);
		const out = [];
		while (buf.length >= 4) {
			const len = buf.readUInt32BE(0);
			if (len > MAX_FRAME) throw new Error("frame too large");
			if (buf.length < 4 + len) break;
			out.push(JSON.parse(buf.subarray(4, 4 + len).toString("utf8")));
			buf = buf.subarray(4 + len);
		}
		return out;
	};
}

function withSocket(fn) {
	return new Promise((resolve, reject) => {
		const sock = connect(socketPath());
		let settled = false;
		const finish = (err, val) => {
			if (settled) return;
			settled = true;
			sock.destroy();
			err ? reject(err) : resolve(val);
		};
		sock.once("error", finish);
		sock.once("connect", () => {
			try {
				fn(sock, finish);
			} catch (err) {
				finish(err);
			}
		});
	});
}

export async function speakOneShot(text, opts = {}) {
	return withSocket((sock, finish) => {
		const read = makeFrameReader();
		sock.on("data", (chunk) => {
			let frames;
			try {
				frames = read(chunk);
			} catch (err) {
				return finish(err);
			}
			for (const frame of frames) {
				if (frame.kind === "done") return finish(null, "done");
				if (frame.kind === "error") return finish(new Error(frame.message || "daemon error"));
				if (frame.kind === "stopped") return finish(null, "stopped");
				if (frame.kind === "version-mismatch") return finish(new Error(`version mismatch: expected ${frame.expected}, got ${frame.got}`));
			}
		});
		sock.on("end", () => finish(null, "eof"));
		sock.write(encodeFrame({
			kind: "speak",
			version: PROTOCOL_VERSION,
			text,
			...(opts.lang ? { lang: opts.lang } : {}),
			...(opts.voice ? { voice: opts.voice } : {}),
			...(opts.speed ? { speed: opts.speed } : {}),
			...(opts.raw ? { raw: true } : {}),
		}));
	});
}

export async function stopAll() {
	return withSocket((sock, finish) => {
		const read = makeFrameReader();
		sock.on("data", (chunk) => {
			let frames;
			try {
				frames = read(chunk);
			} catch (err) {
				return finish(err);
			}
			for (const frame of frames) {
				if (frame.kind === "stopped") return finish(null, "stopped");
				if (frame.kind === "error") return finish(new Error(frame.message || "daemon error"));
				if (frame.kind === "version-mismatch") return finish(new Error(`version mismatch`));
			}
		});
		sock.on("end", () => finish(null, "eof"));
		sock.write(encodeFrame({ kind: "stop", version: PROTOCOL_VERSION }));
	});
}
