# Agent-native parity findings

## Scope

The requested feature lets users choose the stock-data source (問財 Skill Hub or local deterministic simulation), with fallback behavior when Skill Hub is unavailable.

## Findings

- The existing natural-language analyst should expose data-source choice as an explicit input to the agent workflow, not infer it from prose or silently override it. The selected source should be carried through the generated visualization Schema and rendered in the result metadata.
- The workflow should preserve parity across sources: the same normalized stock identifier, metric, date range, chart types, units, cutoff timestamp, highlight rules, and conclusion shape should be produced regardless of whether data came from Skill Hub or the simulator.
- Source selection and fallback are meaningful agent state. The workflow should report `requestedSource`, `resolvedSource`, and a human-readable fallback reason when the requested Skill Hub source is unavailable. This keeps the system inspectable and avoids presenting fallback data as live Skill Hub data.
- Follow-up instructions must retain the current source selection unless the user explicitly changes it. Re-parsing “改为最近 10 天” or “把成交量改成涨跌幅” should not reset the source to the default.
- Errors should be structured and recoverable: unsupported source, Skill Hub timeout/auth/configuration failure, invalid Schema, unknown metric, and empty data should each become a visible workflow state rather than an uncaught exception. A Skill Hub failure may transition to local simulation only when fallback is enabled and should remain visible to the user.
- The agent does not need autonomous source switching beyond the approved fallback rule. User control is the key parity requirement: the selected source must be visible, editable, and honored for initial analysis and follow-ups.

## Plan implications

Add source selection to the natural-language analysis request and Schema contract; add source/fallback events to the progress state machine; validate both source adapters against one normalized result contract; and add deterministic tests covering explicit local mode, explicit Skill Hub mode, fallback, and follow-up preservation.

