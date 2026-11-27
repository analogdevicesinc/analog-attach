// `aa` in the fast mode (run.sh --fast): the call goes to the test server ($AA_SERVER, the
// socket of dist/test-server.js) with this process's words, cwd and environment, and its
// output and exit status are this process's.
import net from "node:net";

const connection = net.connect(process.env.AA_SERVER);
let reply = "";
connection.setEncoding("utf8");
connection.on("data", chunk => { reply += chunk; });
connection.on("error", error => {
	process.stderr.write(`fast-client: no test server at ${process.env.AA_SERVER}: ${error.message}\n`);
	process.exitCode = 2;
});
connection.on("end", () => {
	const { code, stdout, stderr } = JSON.parse(reply);
	process.stdout.write(stdout);
	process.stderr.write(stderr);
	process.exitCode = code;
});
connection.end(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), env: process.env }));
