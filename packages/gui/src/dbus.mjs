// A small D-Bus client, for the desktop portal's file chooser (portal.mjs): the session bus over
// its Unix socket, EXTERNAL authentication, and the wire format (little-endian) of the types the
// portal uses. No dependency: the server is bundled into the CLI and its standalone binary.
//
// A value's JavaScript form, by its type: y n q i u d a number, x t a bigint, b a boolean, s o g a
// string, v [signature, value], a struct an array, an array an array (`ay` also a Buffer), a dict
// (a{..}) an array of [key, value] to write and an object to read.

import net from "node:net";
import process from "node:process";

/** The session bus's socket: the first unix address of $DBUS_SESSION_BUS_ADDRESS, else $XDG_RUNTIME_DIR/bus. */
export function session_bus_socket(environment = process.env) {
	const address = environment.DBUS_SESSION_BUS_ADDRESS;
	if (!address) {return environment.XDG_RUNTIME_DIR ? `${environment.XDG_RUNTIME_DIR}/bus` : undefined;}
	for (const one of address.split(";")) {
		if (!one.startsWith("unix:")) continue;
		const keys = Object.fromEntries(one.slice(5).split(",").map(pair => [pair.slice(0, pair.indexOf("=")), decodeURIComponent(pair.slice(pair.indexOf("=") + 1))]));
		if (keys.path) return keys.path;
		// An abstract socket: Node's path for it starts with a NUL.
		if (keys.abstract) {return `\0${keys.abstract}`;}
	}
	return;
}

/** The end of the complete type that starts at `at` in `signature`. */
function type_end(signature, at) {
	const code = signature[at];
	if (code === "a") return type_end(signature, at + 1);
	if (code === "(" || code === "{") {
		const close = code === "(" ? ")" : "}";
		let next = at + 1;
		while (signature[next] !== close) {
			if (next >= signature.length) {throw new Error(`Bad D-Bus signature ${signature}`);}
			next = type_end(signature, next);
		}
		return next + 1;
	}
	if (!(code in ALIGN)) {throw new Error(`Bad D-Bus signature ${signature}`);}
	return at + 1;
}

/** The complete types of a signature, in order. */
export function signature_types(signature) {
	const found = [];
	for (let at = 0; at < signature.length;) {
		const end = type_end(signature, at);
		found.push(signature.slice(at, end));
		at = end;
	}
	return found;
}

const ALIGN = { y: 1, b: 4, n: 2, q: 2, i: 4, u: 4, x: 8, t: 8, d: 8, s: 4, o: 4, g: 1, a: 4, "(": 8, "{": 8, v: 1, h: 4 };

/** Values written in the wire format, each aligned from the start of what is written. */
class Writer {
	buffer = Buffer.alloc(256);
	length = 0;

	room(size) {
		if (this.length + size <= this.buffer.length) return;
		const larger = Buffer.alloc(Math.max(this.buffer.length * 2, this.length + size));
		this.buffer.copy(larger, 0, 0, this.length);
		this.buffer = larger;
	}

	align(size) {
		const pad = (size - (this.length % size)) % size;
		this.room(pad);
		this.buffer.fill(0, this.length, this.length + pad);
		this.length += pad;
	}

	number(method, size, value) {
		this.align(size);
		this.room(size);
		this.buffer[method](value, this.length);
		this.length += size;
	}

	text(value, length_size) {
		const bytes = Buffer.from(value, "utf8");
		if (length_size === 1) this.number("writeUInt8", 1, bytes.length);
		else this.number("writeUInt32LE", 4, bytes.length);
		this.room(bytes.length + 1);
		bytes.copy(this.buffer, this.length);
		this.buffer[this.length + bytes.length] = 0;
		this.length += bytes.length + 1;
	}

	write(type, value) {
		switch (type[0]) {
			case "y": { this.number("writeUInt8", 1, value); return; }
			case "b": { this.number("writeUInt32LE", 4, value ? 1 : 0); return; }
			case "n": { this.number("writeInt16LE", 2, value); return; }
			case "q": { this.number("writeUInt16LE", 2, value); return; }
			case "i": { this.number("writeInt32LE", 4, value); return; }
			case "u": case "h": { this.number("writeUInt32LE", 4, value); return; }
			case "x": { this.number("writeBigInt64LE", 8, BigInt(value)); return; }
			case "t": { this.number("writeBigUInt64LE", 8, BigInt(value)); return; }
			case "d": { this.number("writeDoubleLE", 8, value); return; }
			case "s": case "o": { this.text(value, 4); return; }
			case "g": { this.text(value, 1); return; }
			case "v": {
				const [signature, inner] = value;
				this.text(signature, 1);
				this.write(signature, inner);
				return;
			}
			case "a": {
				const element = type.slice(1);
				this.align(4);
				const at = this.length;
				this.number("writeUInt32LE", 4, 0);
				// The padding to the first element isn't counted in the array's length.
				this.align(ALIGN[element[0]]);
				const start = this.length;
				for (const item of value) this.write(element, item);
				this.buffer.writeUInt32LE(this.length - start, at);
				return;
			}
			case "(": case "{": {
				this.align(8);
				for (const [index, member] of signature_types(type.slice(1, -1)).entries()) {
					this.write(member, value[index]);
				}
				return;
			}
			default: { throw new Error(`Can't write D-Bus type ${type}`);
			}
		}
	}

	bytes() {
		return this.buffer.subarray(0, this.length);
	}
}

/** Values read from the wire format, aligned from the start of `buffer`. */
class Reader {
	constructor(buffer) {
		this.buffer = buffer;
		this.at = 0;
	}

	align(size) {
		this.at += (size - (this.at % size)) % size;
	}

	number(method, size) {
		this.align(size);
		if (this.at + size > this.buffer.length) throw new Error("D-Bus message too short");
		const value = this.buffer[method](this.at);
		this.at += size;
		return value;
	}

	text(length_size) {
		const length = length_size === 1 ? this.number("readUInt8", 1) : this.number("readUInt32LE", 4);
		const value = this.buffer.toString("utf8", this.at, this.at + length);
		this.at += length + 1;
		return value;
	}

	read(type) {
		switch (type[0]) {
			case "y": { return this.number("readUInt8", 1);
			}
			case "b": { return this.number("readUInt32LE", 4) !== 0;
			}
			case "n": { return this.number("readInt16LE", 2);
			}
			case "q": { return this.number("readUInt16LE", 2);
			}
			case "i": { return this.number("readInt32LE", 4);
			}
			case "u": case "h": { return this.number("readUInt32LE", 4);
 }
			case "x": { return this.number("readBigInt64LE", 8);
			}
			case "t": { return this.number("readBigUInt64LE", 8);
			}
			case "d": { return this.number("readDoubleLE", 8);
			}
			case "s": case "o": { return this.text(4);
 }
			case "g": { return this.text(1);
			}
			case "v": { return this.read(this.text(1));
			}
			case "a": {
				const element = type.slice(1);
				const length = this.number("readUInt32LE", 4);
				this.align(ALIGN[element[0]]);
				const end = this.at + length;
				const items = [];
				while (this.at < end) items.push(this.read(element));
				return element[0] === "{" ? Object.fromEntries(items) : items;
			}
			case "(": case "{": {
				this.align(8);
				return signature_types(type.slice(1, -1)).map(member => this.read(member));
			}
			default: { throw new Error(`Can't read D-Bus type ${type}`);
			}
		}
	}
}

/** The header fields of a message, by their codes. */
const FIELDS = { path: [1, "o"], interface: [2, "s"], member: [3, "s"], error_name: [4, "s"], reply_serial: [5, "u"], destination: [6, "s"], sender: [7, "s"], signature: [8, "g"] };
const FIELD_NAMES = Object.fromEntries(Object.entries(FIELDS).map(([name, [code]]) => [code, name]));
export const MESSAGE = { call: 1, return: 2, error: 3, signal: 4 };
/** A call that wants no reply (a signal never has one). */
export const NO_REPLY = 1;

/** A message's bytes: `type` (MESSAGE), its header fields (path, interface, …), and `body`, the values of `signature`. */
export function encode_message({ type, serial, flags = 0, signature = "", body = [], ...fields }) {
	const content = new Writer();
	for (const [index, member] of signature_types(signature).entries()) {
		content.write(member, body[index]);
	}
	const header = new Writer();
	for (const byte of ["l".codePointAt(0), type, flags, 1]) header.write("y", byte);
	header.write("u", content.length);
	header.write("u", serial);
	const present = Object.entries({ ...fields, ...(signature === "" ? {} : { signature }) }).filter(([name, value]) => name in FIELDS && value !== undefined);
	header.write("a(yv)", present.map(([name, value]) => [FIELDS[name][0], [FIELDS[name][1], value]]));
	header.align(8);
	return Buffer.concat([header.bytes(), content.bytes()]);
}

/** The length of the message at the start of `buffer`, or undefined while it hasn't all come. */
function message_length(buffer) {
	if (buffer.length < 16) return;
	const fields = buffer.readUInt32LE(12);
	const header = 16 + fields + ((8 - ((16 + fields) % 8)) % 8);
	const total = header + buffer.readUInt32LE(4);
	return buffer.length < total ? undefined : total;
}

/** A message from its bytes: { type, flags, serial, path, interface, member, …, signature, body }. */
export function decode_message(buffer) {
	if (buffer[0] !== "l".codePointAt(0)) throw new Error("A big-endian D-Bus message: not read");
	const reader = new Reader(buffer);
	reader.at = 12;
	const fields = Object.fromEntries(reader.read("a(yv)").filter(([code]) => code in FIELD_NAMES).map(([code, value]) => [FIELD_NAMES[code], value]));
	reader.align(8);
	const body = new Reader(buffer.subarray(reader.at, reader.at + buffer.readUInt32LE(4)));
	const signature = fields.signature ?? "";
	return { type: buffer[1], flags: buffer[2], serial: buffer.readUInt32LE(8), ...fields, signature, body: signature_types(signature).map(member => body.read(member)) };
}

/**
 * A connection to the bus at `socket` (session_bus_socket), authenticated and said Hello to:
 * { unique_name, call, send, on_message, on_end, close }. Rejects after `timeout` ms.
 */
export function connect_bus(socket, { timeout = 3000 } = {}) {
	return new Promise((resolve, reject) => {
		const connection = net.createConnection(socket);
		const timer = setTimeout(() => fail(new Error("The session bus didn't answer")), timeout);
		let serial = 0;
		let pending = Buffer.alloc(0);
		let authenticated = false;
		let ended = false;
		const replies = new Map();
		const listeners = [];
		const enders = [];
		function fail(error) {
			clearTimeout(timer);
			connection.destroy();
			reject(error);
		}
		const send = message => {
			serial += 1;
			connection.write(encode_message({ ...message, serial }));
			return serial;
		};
		const bus = {
			unique_name: "",
			send,
			/** A method call: resolves with the reply's body, rejects with the error's name and message. */
			call: ({ timeout: wait = timeout, ...message }) => new Promise((done, refused) => {
				if (ended) {
					refused(new Error("The session bus connection is closed"));
					return;
				}
				const sent = send({ ...message, type: MESSAGE.call });
				const timer_of_call = setTimeout(() => { replies.delete(sent); refused(new Error(`${message.member}: no answer`)); }, wait);
				replies.set(sent, reply => {
					clearTimeout(timer_of_call);
					if (reply.type === MESSAGE.error) {refused(new Error(`${reply.error_name}${typeof reply.body[0] === "string" ? `: ${reply.body[0]}` : ""}`));}
					else done(reply.body);
				});
			}),
			on_message: listener => { listeners.push(listener); },
			on_end: ender => { enders.push(ender); },
			close: () => connection.end(),
		};
		const take = () => {
			for (let length = message_length(pending); length !== undefined; length = message_length(pending)) {
				const message = decode_message(pending.subarray(0, length));
				pending = pending.subarray(length);
				const reply = message.reply_serial === undefined ? undefined : replies.get(message.reply_serial);
				if (reply !== undefined && (message.type === MESSAGE.return || message.type === MESSAGE.error)) {
					replies.delete(message.reply_serial);
					reply(message);
				} else for (const listener of listeners) listener(message);
			}
		};
		connection.on("connect", () => {
			// The NUL, then AUTH EXTERNAL with the user id, in hex of its decimal digits.
			const uid = Buffer.from(String(process.getuid?.() ?? 0)).toString("hex");
			connection.write(`\0AUTH EXTERNAL ${uid}\r\n`);
		});
		connection.on("data", chunk => {
			pending = Buffer.concat([pending, chunk]);
			if (!authenticated) {
				const end = pending.indexOf("\r\n");
				if (end === -1) return;
				const line = pending.toString("latin1", 0, end);
				pending = pending.subarray(end + 2);
				if (!line.startsWith("OK ")) {
					fail(new Error(`The session bus refused: ${line}`));
					return;
				}
				authenticated = true;
				connection.write("BEGIN\r\n");
				bus.call({ destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus", member: "Hello" })
					.then(([name]) => { clearTimeout(timer); bus.unique_name = name; resolve(bus); }, fail);
			}
			try {
				take();
			} catch (error) {
				fail(error);
			}
		});
		connection.on("error", error => fail(error));
		connection.on("close", () => {
			ended = true;
			for (const reply of replies.values()) {reply({ type: MESSAGE.error, error_name: "Disconnected", body: [] });}
			replies.clear();
			for (const ender of enders) ender();
		});
	});
}
