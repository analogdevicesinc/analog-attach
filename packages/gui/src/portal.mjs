// The native file picker through the desktop portal (xdg-desktop-portal's FileChooser, on the
// session bus): the desktop's own dialog, GNOME's, KDE's or GTK's, whatever the desktop's portal
// is, with no program of its own to install. The request belongs to the connection that made it,
// and the portal closes the dialog when that connection goes, so the server holds one open until
// the Response signal (dbus.mjs; a `gdbus call` would end, and the dialog with it).

import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { connect_bus, session_bus_socket } from "./dbus.mjs";

const PORTAL = { destination: "org.freedesktop.portal.Desktop", path: "/org/freedesktop/portal/desktop" };
const BUS = { destination: "org.freedesktop.DBus", path: "/org/freedesktop/DBus", interface: "org.freedesktop.DBus" };
/** The FileChooser version that picks folders (its `directory` option). */
const DIRECTORY_VERSION = 3;

/** The FileChooser's version on `bus` (the portal started if it isn't running), or undefined without one. */
async function file_chooser_version(bus) {
	try {
		const [version] = await bus.call({ ...PORTAL, interface: "org.freedesktop.DBus.Properties", member: "Get", signature: "ss", body: ["org.freedesktop.portal.FileChooser", "version"], timeout: 5000 });
		return typeof version === "number" ? version : undefined;
	} catch {
		return;
	}
}

/** Whether the session bus has the portal's file chooser: its version, or undefined. */
export async function portal_version() {
	const socket = session_bus_socket();
	if (socket === undefined) return;
	const bus = await connect_bus(socket).catch(() => {});
	if (bus === undefined) return;
	try {
		return await file_chooser_version(bus);
	} finally {
		bus.close();
	}
}

/**
 * Pick a path in the portal's dialog: `dir` a folder, else a file (`extensions` a filter, beside
 * all files), `title`, `start` the folder it opens in. Resolves with { path }, { cancelled }, or
 * { error } (no portal, one that can't pick folders, a failure), once the dialog is closed;
 * `signal` aborted (the page gone) closes it.
 */
export async function portal_pick({ dir, extensions, title, start }, signal) {
	const socket = session_bus_socket();
	if (socket === undefined) {return { error: "No session bus" };}
	let bus;
	try {
		bus = await connect_bus(socket);
	} catch (error) {
		return { error: `The session bus: ${error.message}` };
	}
	try {
		const version = await file_chooser_version(bus);
		if (version === undefined) {return { error: "No desktop portal with a file chooser on the session bus" };}
		if (dir && version < DIRECTORY_VERSION) {return { error: `The desktop portal's file chooser (version ${version}) can't pick folders` };}
		// The request's path is the portal's of our name and a token of ours: its Response is
		// listened for before it is asked, so it can't come first.
		const token = `aa_${crypto.randomBytes(8).toString("hex")}`;
		const expected = `/org/freedesktop/portal/desktop/request/${bus.unique_name.slice(1).replaceAll(".", "_")}/${token}`;
		let handle = expected;
		const response = new Promise(resolve => {
			bus.on_message(message => {
				if (message.interface === "org.freedesktop.portal.Request" && message.member === "Response" && (message.path === handle || message.path === expected)) resolve(message.body);
			});
			bus.on_end(() => resolve());
		});
		await bus.call({ ...BUS, member: "AddMatch", signature: "s", body: ["type='signal',interface='org.freedesktop.portal.Request',member='Response'"] });
		const options = [["handle_token", ["s", token]], ["modal", ["b", true]], ["current_folder", ["ay", Buffer.from(`${start}\0`)]]];
		if (dir) options.push(["directory", ["b", true]]);
		else if (extensions.length > 0) {
			const patterns = extensions.map(extension => `*${extension}`);
			options.push(["filters", ["a(sa(us))", [[patterns.join(" "), patterns.map(pattern => [0, pattern])], ["All files", [[0, "*"]]]]]]);
		}
		if (signal.aborted) {return { cancelled: true };}
		[handle] = await bus.call({ ...PORTAL, interface: "org.freedesktop.portal.FileChooser", member: "OpenFile", signature: "ssa{sv}", body: ["", title, options] });
		// The page gone: close the dialog (the connection's end would too).
		const close = () => { bus.call({ destination: PORTAL.destination, path: handle, interface: "org.freedesktop.portal.Request", member: "Close" }).catch(() => {}).finally(() => bus.close()); };
		signal.addEventListener("abort", close, { once: true });
		const answer = await response;
		signal.removeEventListener("abort", close);
		if (answer === undefined) {return signal.aborted ? { cancelled: true } : { error: "The session bus closed while the dialog was open" };}
		const [code, results] = answer;
		if (code === 1) {return { cancelled: true };}
		const uri = results?.uris?.[0];
		if (code !== 0) {return { error: "The desktop portal ended the dialog" };}
		if (typeof uri !== "string" || !uri.startsWith("file://")) {return { error: `The desktop portal picked ${uri ?? "nothing"}, not a local file` };}
		const picked = fileURLToPath(uri);
		return { path: picked.length > 1 ? picked.replace(/\/$/, "") : picked };
	} catch (error) {
		return { error: `The desktop portal: ${error.message}` };
	} finally {
		bus.close();
	}
}
