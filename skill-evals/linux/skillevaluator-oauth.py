"""Run skillevaluator for a Claude Code agent on a subscription (CLAUDE_CODE_OAUTH_TOKEN).

SkillEvaluator 1.2.0 knows only API keys for Claude Code. Before a run it lists the models
with the provider's ANTHROPIC_API_KEY (x-api-key), which an OAuth token can't pass; then it
gives each task's agent that key, which Claude Code prefers to the token. So this changes two
things, for the anthropic provider only: the check is answered here, and the agent gets
CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_FORCE_OAUTH (harbor's claude-code agent then drops any API
key) in place of the key. The tasks name them as ${...}: the token is not written to them.
Everything else is skillevaluator unchanged. Run it with skillevaluator's own Python:
python skillevaluator-oauth.py tier3 evaluate ...
"""
import os
import sys

from skillevaluator.cli import cli
from skillevaluator.tier3.harbor import runner, runtime_preflight

if not os.environ.get("CLAUDE_CODE_OAUTH_TOKEN", "").strip() or os.environ.get("CLAUDE_FORCE_OAUTH") != "1":
	sys.exit("skillevaluator-oauth: set CLAUDE_CODE_OAUTH_TOKEN and CLAUDE_FORCE_OAUTH=1")

probe_model = runtime_preflight.probe_model


def probe_oauth(provider, *args, **kwargs):
	if provider.provider.casefold() != "anthropic":
		return probe_model(provider, *args, **kwargs)
	return runtime_preflight.ModelProbeResult(
		ok=True,
		provider=provider.provider,
		model=provider.model,
		detail="not checked: the agent logs in with CLAUDE_CODE_OAUTH_TOKEN",
	)


agent_credentials = runner._agent_credentials


def agent_credentials_oauth(*args, provider, agent, **kwargs):
	if provider.provider.casefold() != "anthropic" or agent != "claude-code":
		return agent_credentials(*args, provider=provider, agent=agent, **kwargs)
	return {"CLAUDE_CODE_OAUTH_TOKEN": os.environ["CLAUDE_CODE_OAUTH_TOKEN"], "CLAUDE_FORCE_OAUTH": "1"}


runtime_preflight.probe_model = probe_oauth
runner._agent_credentials = agent_credentials_oauth
sys.argv[0] = "skillevaluator"
sys.exit(cli())
