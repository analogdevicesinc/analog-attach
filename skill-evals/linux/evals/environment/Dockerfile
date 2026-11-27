# The analog-attach-linux skill's Tier 3 environment: the CLI and the tools it runs, a Linux tree,
# and the projects the cases start from (setup/make-projects.sh). SkillEvaluator rebases it onto
# its own base image (python:3.12-slim with its verifier packages) and adds the skill, for the
# with-skill arm only, and the agent.
#
# assets/ is written by ../../run.sh: the standalone analog-attach binary and the sparse Linux
# tree of the functional tests (packages/cli/test/functional/linux-tree.sh), as a tar, which ADD
# unpacks: the tree has symlinks, which SkillEvaluator refuses in this folder.
FROM python:3.12-slim

# dtc (with fdtoverlay, for the grader) and cpp, which the CLI runs; libatomic1, which the
# standalone binary's Node links and slim images lack.
RUN apt-get -o Acquire::Retries=3 update \
	&& apt-get -o Acquire::Retries=3 install -y --no-install-recommends device-tree-compiler cpp libatomic1 \
	&& rm -rf /var/lib/apt/lists/*

# dt-schema 2026.9 exactly, in its own venv: the CLI runs its scripts on the Python that
# dt-mk-schema's first line names, and the verifier's packages stay apart. Its pylibfdt builds
# from source (gcc, swig), which go once it is built.
RUN apt-get -o Acquire::Retries=3 update \
	&& apt-get -o Acquire::Retries=3 install -y --no-install-recommends gcc libc6-dev swig \
	&& python -m venv /opt/dtschema \
	&& /opt/dtschema/bin/pip install --no-cache-dir dtschema==2026.9 ruamel.yaml.clib \
	&& ln -s /opt/dtschema/bin/dt-mk-schema /opt/dtschema/bin/dt-validate /usr/local/bin/ \
	&& apt-get purge -y --auto-remove gcc libc6-dev swig \
	&& rm -rf /var/lib/apt/lists/*

# Claude Code, the agent. Harbor installs it in every attempt's container unless the version
# SkillEvaluator pins is on PATH already (about 20s an attempt); procps is what its install adds
# besides. The version is SkillEvaluator 1.2.0's (PINNED_RUNTIME_VERSIONS in
# skillevaluator/tier3/harbor/local_runtime.py): with another SkillEvaluator, change it to match.
ARG CLAUDE_CODE_VERSION=2.1.292
RUN apt-get -o Acquire::Retries=3 update \
	&& apt-get -o Acquire::Retries=3 install -y --no-install-recommends curl ca-certificates procps \
	&& curl -fsSL https://downloads.claude.ai/claude-code-releases/bootstrap.sh | bash -s -- "$CLAUDE_CODE_VERSION" \
	&& ln -s /root/.local/bin/claude /usr/local/bin/claude \
	&& claude --version \
	&& rm -rf /var/lib/apt/lists/*

ADD assets/linux.tar /opt/linux/
COPY assets/analog-attach /usr/local/bin/analog-attach
COPY setup/ /opt/aa-eval/setup/

# The binary's unpacked assets, wherever the agent's HOME is; setup removes their skills.
ENV XDG_CACHE_HOME=/opt/aa-cache
RUN chmod +x /usr/local/bin/analog-attach && bash /opt/aa-eval/setup/make-projects.sh

WORKDIR /workspace
