#!/usr/bin/env python3
"""The custom grader of the analog-attach-linux skill's Tier 3 eval (SkillEvaluator, custom_only).

Harbor runs it in the task's container once the agent is done. It reads the case from
/tests/entry.json, checks the state the agent left in /workspace, and writes the reward:
/logs/verifier/reward.json (overall, one custom metric per check, and why each failed) and
/logs/verifier/reward.txt (overall). `overall` is the share of the case's checks that passed;
config.yml's pass_threshold says how many must pass for the case to pass.

The checks look at the devicetree the overlay makes, not at how the agent wrote it: the
project's workfile is preprocessed and compiled, applied to the base (compiled with symbols when
the image was built) with fdtoverlay, and the merged tree is read by the small parser below. So
an overlay written by hand, with the CLI, in fragment or reference syntax, all grade the same.

Run by hand: AA_EVAL_WORKSPACE, AA_EVAL_ROOT, HARBOR_TESTS_DIR and HARBOR_LOGS_DIR move the paths.
"""

from __future__ import annotations

import json
import os
import re
import struct
import subprocess
import tempfile
from pathlib import Path
from typing import Callable

WORKSPACE = Path(os.environ.get("AA_EVAL_WORKSPACE", "/workspace"))
ROOT = Path(os.environ.get("AA_EVAL_ROOT", "/opt/aa-eval"))  # what the image built: base.dtb, originals/
LINUX = Path(os.environ.get("AA_EVAL_LINUX", "/opt/linux"))
TESTS = Path(os.environ.get("HARBOR_TESTS_DIR", "/tests"))
LOGS = Path(os.environ.get("HARBOR_LOGS_DIR", "/logs"))
VERIFIER = Path(os.environ.get("HARBOR_VERIFIER_DIR", LOGS / "verifier"))

BASE_DTS = LINUX / "arch/arm/boot/dts/broadcom/bcm2711-rpi-4-b.dts"
SPI0 = "/soc/spi@7e204000"
I2C1 = "/soc/i2c@7e804000"
GPIO = "/soc/gpio@7e200000"
IRQ_TYPE_EDGE_RISING = 1
IRQ_TYPE_EDGE_FALLING = 2


class Failed(Exception):
	"""A check that can't be made (the overlay doesn't compile, a file is missing): it fails, with this reason."""


# --- The devicetree --------------------------------------------------------------------------

class Node:
	def __init__(self, name: str, path: str):
		self.name = name
		self.path = path
		self.props: dict[str, bytes] = {}
		self.children: list[Node] = []

	def u32s(self, prop: str) -> list[int] | None:
		value = self.props.get(prop)
		if value is None:
			return None
		return list(struct.unpack(f">{len(value) // 4}I", value[: len(value) // 4 * 4]))

	def strings(self, prop: str) -> list[str] | None:
		value = self.props.get(prop)
		if value is None:
			return None
		return [part.decode(errors="replace") for part in value.split(b"\0")[:-1]]

	def compatible(self, compatible: str) -> bool:
		return compatible in (self.strings("compatible") or [])

	def status(self) -> str:
		return (self.strings("status") or ["okay"])[0]

	def phandle(self) -> int | None:
		value = self.u32s("phandle") or self.u32s("linux,phandle")
		return value[0] if value else None

	def walk(self):
		yield self
		for child in self.children:
			yield from child.walk()


class Tree:
	def __init__(self, root: Node):
		self.root = root
		self.by_path = {node.path: node for node in root.walk()}

	def node(self, path: str) -> Node | None:
		return self.by_path.get(path)

	def find(self, compatible: str, under: str | None = None) -> list[Node]:
		"""The nodes with `compatible`, anywhere, or the children of `under` only."""
		if under is not None:
			parent = self.node(under)
			return [child for child in (parent.children if parent else []) if child.compatible(compatible)]
		return [node for node in self.root.walk() if node.compatible(compatible)]

	def phandle_of(self, path: str) -> int | None:
		node = self.node(path)
		return node.phandle() if node else None

	def by_phandle(self, phandle: int) -> Node | None:
		return next((node for node in self.root.walk() if node.phandle() == phandle), None)


def parse_dtb(data: bytes) -> Tree:
	magic, _total, off_struct, off_strings = struct.unpack(">4I", data[:16])
	if magic != 0xD00DFEED:
		raise Failed("not a flattened devicetree")
	strings = data[off_strings:]
	offset = off_struct
	stack: list[Node] = []
	root: Node | None = None
	while True:
		(token,) = struct.unpack(">I", data[offset : offset + 4])
		offset += 4
		if token == 1:  # FDT_BEGIN_NODE
			end = data.index(b"\0", offset)
			name = data[offset:end].decode()
			offset = (end + 4) & ~3
			parent = stack[-1] if stack else None
			path = "/" if parent is None else (parent.path.rstrip("/") + "/" + name)
			node = Node(name, path)
			if parent is None:
				root = node
			else:
				parent.children.append(node)
			stack.append(node)
		elif token == 2:  # FDT_END_NODE
			stack.pop()
		elif token == 3:  # FDT_PROP
			length, name_offset = struct.unpack(">2I", data[offset : offset + 8])
			offset += 8
			name = strings[name_offset : strings.index(b"\0", name_offset)].decode()
			stack[-1].props[name] = data[offset : offset + length]
			offset = (offset + length + 3) & ~3
		elif token == 4:  # FDT_NOP
			continue
		elif token == 9:  # FDT_END
			break
		else:
			raise Failed(f"bad devicetree token {token}")
	if root is None:
		raise Failed("empty devicetree")
	return Tree(root)


def run(command: list[str], cwd: Path | None = None, timeout: int = 300) -> subprocess.CompletedProcess[str]:
	return subprocess.run(command, cwd=cwd, capture_output=True, text=True, timeout=timeout, check=False)


def compile_overlay(source: Path, work: Path) -> Path:
	if not source.is_file():
		raise Failed(f"no overlay file {source}")
	preprocessed = work / "overlay.pp.dts"
	result = run(["cpp", "-nostdinc", "-undef", "-x", "assembler-with-cpp", "-P", "-I", str(LINUX / "include"),
		"-I", str(source.parent), "-o", str(preprocessed), str(source)])
	if result.returncode != 0:
		raise Failed(f"cpp failed on {source.name}: {result.stderr.strip()[:300]}")
	dtbo = work / "overlay.dtbo"
	result = run(["dtc", "-q", "-@", "-I", "dts", "-O", "dtb", "-o", str(dtbo), str(preprocessed)])
	if result.returncode != 0:
		raise Failed(f"dtc failed on {source.name}: {result.stderr.strip()[:300]}")
	return dtbo


def apply_overlay(dtbo: Path, work: Path) -> Tree:
	merged = work / "merged.dtb"
	result = run(["fdtoverlay", "-i", str(ROOT / "base.dtb"), "-o", str(merged), str(dtbo)])
	if result.returncode != 0:
		raise Failed(f"fdtoverlay failed: {result.stderr.strip()[:300]}")
	return parse_dtb(merged.read_bytes())


# --- The project -----------------------------------------------------------------------------

def settings(project: Path) -> dict:
	path = project / ".analog-attach" / "config.json"
	if not path.is_file():
		raise Failed(f"no {path}")
	data = json.loads(path.read_text())
	return data.get("linux", {}) if isinstance(data.get("linux"), dict) else {}


def workfile(project: Path) -> Path:
	configured = settings(project).get("workfile")
	if not configured:
		raise Failed("no workfile configured")
	path = Path(configured)
	return path if path.is_absolute() else project / path


_trees: dict[Path, Tree] = {}


def merged(project: Path) -> Tree:
	"""The base with the project's workfile applied (once per project)."""
	if project not in _trees:
		with tempfile.TemporaryDirectory() as work:
			_trees[project] = apply_overlay(compile_overlay(workfile(project), Path(work)), Path(work))
	return _trees[project]


_validations: dict[Path, dict] = {}


def validation(project: Path) -> dict:
	"""`analog-attach --json validate` in the project (once per project)."""
	if project not in _validations:
		result = run(["analog-attach", "--json", "validate"], cwd=project, timeout=600)
		lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
		if not lines:
			raise Failed(f"validate printed no JSON: {(result.stderr or result.stdout).strip()[:300]}")
		_validations[project] = json.loads(lines[-1])
	return _validations[project]


def final_message() -> str:
	"""The agent's last message, from the ATIF trajectory Harbor writes."""
	for path in [LOGS / "agent" / "trajectory.json", *sorted((LOGS / "agent").glob("**/*.json"))]:
		try:
			data = json.loads(path.read_text())
		except (OSError, ValueError):
			continue
		steps = data.get("steps") if isinstance(data, dict) else None
		if isinstance(steps, list):
			messages = [step.get("message") for step in steps if isinstance(step, dict) and step.get("source") == "agent"]
			texts = [message for message in messages if isinstance(message, str) and message.strip()]
			if texts:
				return texts[-1]
	raise Failed("no agent message in the trajectory")


# --- Checks ----------------------------------------------------------------------------------

Check = tuple[str, Callable[[], tuple[bool, str]]]


def one(nodes: list[Node], what: str) -> Node:
	if len(nodes) != 1:
		raise Failed(f"{len(nodes)} {what} found, expected 1")
	return nodes[0]


def expect(name: str, actual, wanted) -> tuple[bool, str]:
	return (actual == wanted, f"{name} is {actual!r}, expected {wanted!r}")


def device(project: Path, compatible: str, under: str) -> Callable[[], Node]:
	return lambda: one(merged(project).find(compatible, under), f"{compatible} nodes under {under}")


def check_validates(project: Path) -> Check:
	def check() -> tuple[bool, str]:
		errors = validation(project).get("errors") or []
		return (not errors, "; ".join(str(error.get("message", ""))[:200] for error in errors) or "no errors")
	return ("validate_clean", check)


def check_no_warnings(project: Path, kinds: tuple[str, ...] = ("resource-conflict", "unresolved")) -> Check:
	def check() -> tuple[bool, str]:
		warnings = [warning for warning in validation(project).get("warnings") or [] if warning.get("error_type") in kinds]
		return (not warnings, "; ".join(str(warning.get("message", ""))[:200] for warning in warnings) or "no warnings")
	return ("validate_no_conflicts", check)


def check_status(project: Path, path: str, wanted: str, name: str) -> Check:
	def check() -> tuple[bool, str]:
		node = merged(project).node(path)
		if node is None:
			raise Failed(f"no {path}")
		return expect(f"{path} status", node.status(), wanted)
	return (name, check)


def check_prop(name: str, node: Callable[[], Node], prop: str, wanted: list[int]) -> Check:
	return (name, lambda: expect(prop, node().u32s(prop), wanted))


def check_flag(name: str, node: Callable[[], Node], prop: str) -> Check:
	return (name, lambda: (prop in node().props, f"{prop} {'set' if prop in node().props else 'missing'}"))


def check_interrupt(project: Path, node: Callable[[], Node], line: int, trigger: int) -> list[Check]:
	def parent() -> tuple[bool, str]:
		value = node().u32s("interrupt-parent")
		gpio = merged(project).phandle_of(GPIO)
		return (value == [gpio], f"interrupt-parent is {value}, expected the gpio controller's phandle {gpio}")
	return [("interrupt_parent_gpio", parent), check_prop("interrupts", node, "interrupts", [line, trigger])]


def check_not_built(project: Path) -> Check:
	"""For a request that doesn't ask for a build: the skill builds only on request. The CLI's own
	state (.analog-attach/, where validate keeps a temp.dtb) doesn't count."""
	def check() -> tuple[bool, str]:
		built = sorted(str(path.relative_to(project)) for pattern in ("*.dtbo", "*.dtb") for path in project.rglob(pattern)
			if path.relative_to(project).parts[0] != ".analog-attach")
		return (not built, f"built unasked: {built}" if built else "nothing built")
	return ("not_built_unasked", check)


def ad7124_spi0_cs1() -> list[Check]:
	project = WORKSPACE / "rpi4"
	adc = device(project, "adi,ad7124-8", SPI0)
	def channel() -> tuple[bool, str]:
		channels = [child for child in adc().children if child.u32s("reg") == [0]]
		return expect("channel 0 diff-channels", channels[0].u32s("diff-channels") if channels else None, [0, 1])
	return [
		("on_spi0", lambda: (bool(adc()), "found")),
		check_prop("chip_select_1", adc, "reg", [1]),
		*check_interrupt(project, adc, 25, IRQ_TYPE_EDGE_FALLING),
		("channel0_ain0_ain1", channel),
		check_status(project, f"{SPI0}/spidev@1", "disabled", "spidev1_disabled"),
		check_status(project, SPI0, "okay", "spi0_enabled"),
		check_validates(project),
		check_no_warnings(project),
		check_not_built(project),
	]


def adxl345_i2c1() -> list[Check]:
	project = WORKSPACE / "rpi4"
	accel = device(project, "adi,adxl345", I2C1)
	return [
		("on_i2c1", lambda: (bool(accel()), "found")),
		check_prop("address_0x53", accel, "reg", [0x53]),
		*check_interrupt(project, accel, 4, IRQ_TYPE_EDGE_RISING),
		check_status(project, I2C1, "okay", "i2c1_enabled"),
		check_validates(project),
		check_no_warnings(project),
		check_not_built(project),
	]


def adxl345_spi0_cs0() -> list[Check]:
	project = WORKSPACE / "rpi4"
	accel = device(project, "adi,adxl345", SPI0)
	return [
		("on_spi0", lambda: (bool(accel()), "found")),
		check_prop("chip_select_0", accel, "reg", [0]),
		check_prop("spi_5mhz", accel, "spi-max-frequency", [5_000_000]),
		check_flag("spi_cpol", accel, "spi-cpol"),
		check_flag("spi_cpha", accel, "spi-cpha"),
		*check_interrupt(project, accel, 17, IRQ_TYPE_EDGE_RISING),
		check_status(project, f"{SPI0}/spidev@0", "disabled", "spidev0_disabled"),
		check_status(project, SPI0, "okay", "spi0_enabled"),
		check_validates(project),
		check_no_warnings(project),
		check_not_built(project),
	]


def hmc425a_gpios() -> list[Check]:
	project = WORKSPACE / "rpi4"
	attenuator = lambda: one(merged(project).find("adi,hmc425a"), "adi,hmc425a nodes")
	def rows() -> tuple[bool, str]:
		gpio = merged(project).phandle_of(GPIO)
		wanted = [value for line in (5, 6, 13, 19, 26, 21) for value in (gpio, line, 0)]
		return expect("ctrl-gpios", attenuator().u32s("ctrl-gpios"), wanted)
	return [
		("present", lambda: (bool(attenuator()), "found")),
		("ctrl_gpios_v1_to_v6", rows),
		check_validates(project),
		check_not_built(project),
	]


def setup_fresh() -> list[Check]:
	project = WORKSPACE / "fresh"
	def backend() -> tuple[bool, str]:
		data = json.loads((project / ".analog-attach" / "config.json").read_text())
		return expect("backend", data.get("backend"), "linux")
	def tree() -> tuple[bool, str]:
		value = settings(project).get("linux")
		return (bool(value) and Path(value).resolve() == LINUX.resolve(), f"linux is {value!r}")
	def base() -> tuple[bool, str]:
		value = settings(project).get("devicetree")
		return (bool(value) and Path(value).resolve() == BASE_DTS.resolve(), f"devicetree is {value!r}, expected {BASE_DTS}")
	def overlay() -> tuple[bool, str]:
		path = workfile(project)
		return (path.name == "rpi4.dtso" and path.resolve().parent == project.resolve() and path.is_file(), f"workfile {path}, exists: {path.is_file()}")
	def usable() -> tuple[bool, str]:
		result = run(["analog-attach", "--json", "list", "parent", "adi,ad7124-8"], cwd=project, timeout=600)
		lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
		ok = bool(lines) and json.loads(lines[-1]).get("ok") is True
		return (ok, "list parent works" if ok else (result.stdout + result.stderr).strip()[:300])
	return [("backend_linux", backend), ("linux_tree", tree), ("rpi4_base", base), ("workfile_created", overlay), ("project_usable", usable), check_not_built(project)]


def import_ad7124_overlay() -> list[Check]:
	"""rpi-ad7124-8-all-diff-overlay.dts: the ADC on spi0, its 8 channels the pairs AIN0/1 … AIN14/15."""
	project = WORKSPACE / "rpi4"
	adc = device(project, "adi,ad7124-8", SPI0)
	def pairs() -> tuple[bool, str]:
		found = sorted(child.u32s("diff-channels") or [] for child in adc().children)
		return expect("diff-channels of the channels", found, [[n, n + 1] for n in range(0, 16, 2)])
	return [
		("configured_workfile_has_it", lambda: (bool(adc()), f"in {workfile(project)}")),
		("all_diff_channels", pairs),
		check_not_built(project),
	]


def fix_validation() -> list[Check]:
	project = WORKSPACE / "rpi4-broken"
	adc = device(project, "adi,ad7124-8", SPI0)
	def channel0() -> Node:
		return one([child for child in adc().children if child.u32s("reg") == [0]], "channel 0 nodes")
	return [
		*check_interrupt(project, adc, 25, IRQ_TYPE_EDGE_FALLING),
		("channel0_ain2_ain3", lambda: expect("diff-channels", channel0().u32s("diff-channels"), [2, 3])),
		("internal_reference", lambda: ("adi,reference-select" not in channel0().props,
			f"adi,reference-select is {channel0().u32s('adi,reference-select')} (none selects the internal reference)")),
		check_validates(project),
		check_not_built(project),
	]


def refin1_regulator() -> list[Check]:
	project = WORKSPACE / "rpi4-adc"
	adc = device(project, "adi,ad7124-8", SPI0)
	def supply() -> tuple[bool, str]:
		value = adc().u32s("refin1-supply")
		if not value:
			return (False, "refin1-supply missing")
		node = merged(project).by_phandle(value[0])
		if node is None or not node.compatible("regulator-fixed"):
			return (False, f"refin1-supply names {node.path if node else value}, not a regulator-fixed")
		volts = (node.u32s("regulator-min-microvolt"), node.u32s("regulator-max-microvolt"))
		return (volts == ([2_500_000], [2_500_000]), f"{node.path} min/max microvolt {volts}")
	return [("refin1_fixed_2v5", supply), check_validates(project), check_not_built(project)]


def rewire_cs0() -> list[Check]:
	project = WORKSPACE / "rpi4-adc"
	adc = device(project, "adi,ad7124-8", SPI0)
	return [
		check_prop("chip_select_0", adc, "reg", [0]),
		check_status(project, f"{SPI0}/spidev@0", "disabled", "spidev0_disabled"),
		check_validates(project),
		check_no_warnings(project),
		check_not_built(project),
	]


def build_overlay() -> list[Check]:
	project = WORKSPACE / "rpi4-adc"
	dtbo = project / "build" / "overlay.dtbo"
	def built() -> tuple[bool, str]:
		if not dtbo.is_file():
			return (False, f"no {dtbo}")
		with tempfile.TemporaryDirectory() as work:
			tree = apply_overlay(dtbo, Path(work))
		return (bool(tree.find("adi,ad7124-8", SPI0)), "the .dtbo applies to the base and adds the ADC")
	return [("dtbo_built", built)]


def deploy_settings() -> list[Check]:
	project = WORKSPACE / "rpi4-adc"
	variables = lambda: settings(project).get("variables") or {}
	def secret() -> tuple[bool, str]:
		value = variables().get("BOARD_PASSWORD")
		return (value == {"secret": True}, f"BOARD_PASSWORD is stored as {value!r}")
	return [
		("board_ip", lambda: expect("BOARD_IP", variables().get("BOARD_IP"), "192.168.2.10")),
		("board_user", lambda: expect("BOARD_USER", variables().get("BOARD_USER"), "pi")),
		("password_not_stored", secret),
		check_not_built(project),
	]


def ask_wiring() -> list[Check]:
	project = WORKSPACE / "rpi4"
	def asked() -> tuple[bool, str]:
		message = final_message()
		topics = re.search(r"\b(spi|bus|chip[- ]select|cs|interrupt|irq|gpio|wired|connected)\b", message, re.IGNORECASE)
		return ("?" in message and topics is not None, f"final message: {message[:300]!r}")
	def not_guessed() -> tuple[bool, str]:
		adcs = merged(project).find("adi,ad7124-8")
		return (not adcs, f"{len(adcs)} adi,ad7124-8 nodes placed without the wiring: {[adc.path for adc in adcs]}")
	return [("asked_for_wiring", asked), ("no_guessed_node", not_guessed), check_not_built(project)]


def negative_count_dts() -> list[Check]:
	def counted() -> tuple[bool, str]:
		wanted = len([path for path in (LINUX / "arch/arm/boot/dts/broadcom").glob("*.dts") if "bcm2711" in path.name])
		path = WORKSPACE / "output" / "count.txt"
		if not path.is_file():
			return (False, f"no {path}")
		found = re.findall(r"\d+", path.read_text())
		return (found == [str(wanted)], f"count.txt has {found}, expected {wanted}")
	def untouched() -> tuple[bool, str]:
		original = ROOT / "originals" / "rpi4" / "overlay.dtso"
		current = WORKSPACE / "rpi4" / "overlay.dtso"
		same = current.is_file() and current.read_bytes() == original.read_bytes()
		return (same, "the project's overlay is unchanged" if same else "the project's overlay was changed")
	return [("count_correct", counted), ("overlay_untouched", untouched)]


CASES: dict[str, Callable[[], list[Check]]] = {
	"ad7124-spi0-cs1": ad7124_spi0_cs1,
	"adxl345-i2c1": adxl345_i2c1,
	"adxl345-spi0-cs0": adxl345_spi0_cs0,
	"hmc425a-gpios": hmc425a_gpios,
	"setup-fresh": setup_fresh,
	"import-ad7124-overlay": import_ad7124_overlay,
	"fix-validation": fix_validation,
	"refin1-regulator": refin1_regulator,
	"rewire-cs0": rewire_cs0,
	"build-overlay": build_overlay,
	"deploy-settings": deploy_settings,
	"ask-wiring": ask_wiring,
	"negative-count-dts": negative_count_dts,
}


def metric_name(name: str) -> str:
	return "aa_" + name  # never one of the evaluator's reserved names


def grade(case: str) -> dict:
	checks = CASES[case]()
	metrics: dict[str, float] = {}
	details: dict[str, dict] = {}
	for name, check in checks:
		try:
			passed, reason = check()
		except Failed as error:
			passed, reason = False, str(error)
		except Exception as error:  # a check that breaks fails alone, the others still count
			passed, reason = False, f"{type(error).__name__}: {error}"
		metrics[metric_name(name)] = 1.0 if passed else 0.0
		details[metric_name(name)] = {"score": metrics[metric_name(name)], "reason": reason}
	overall = sum(metrics.values()) / len(metrics) if metrics else 0.0
	return {"overall": round(overall, 4), "custom_metrics": metrics, "details": details}


def main() -> None:
	entry = json.loads((TESTS / "entry.json").read_text())
	case = str(entry.get("id", ""))
	if case not in CASES:
		reward = {"overall": 0.0, "custom_metrics": {}, "details": {"aa_case": {"score": 0.0, "reason": f"unknown case {case!r}"}}}
	else:
		reward = grade(case)
	VERIFIER.mkdir(parents=True, exist_ok=True)
	(VERIFIER / "reward.json").write_text(json.dumps(reward, indent=2) + "\n")
	(VERIFIER / "reward.txt").write_text(f"{reward['overall']}\n")
	print(json.dumps(reward, indent=2))


if __name__ == "__main__":
	main()
