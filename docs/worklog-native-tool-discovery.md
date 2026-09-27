# Native tool discovery correction — 2026-09-27

An ordinary ChatGPT web session incorrectly reported that Core exposed only read.
An explicit code-mode prompt subsequently executed tools.exec_command successfully.
A guided Plugins probe also returned a route and a Desktop Commander file result.
Those prove connectivity, not autonomous selection from a normal user request.

The durable correction belongs in the existing discovery and instruction owners.
Core now projects enabled plugin names from the manager's current exposure, explains
cross-connector selection without requiring the user to name tools, and gives the
Core exec command form only when execution is enabled. Code-mode declarations list
their registered operations so tool discovery can match the task's operation. Their
cache identity includes that list. No handler, permission, routing executor or
transport is replaced. Plugin names are bounded and constrained to name characters;
upstream descriptions are not promoted into Core instructions.

Two identical user messages were observed during the preceding guided shell probe;
their input origin remains unproven. A later single-message read-only probe recorded
distinct HTTP calls for repeated reads/routing (including both nested and direct
calls). These are not collapsed as duplicate ledger entries. Native guidance now
explicitly states that nested calls execute immediately and must not be repeated
directly. This is model guidance, not an exactly-once execution guarantee. Do not
introduce argument-based deduplication: intentional repeated reads and commands are
valid, and identical arguments are not an operation identity.

Regression coverage: Core live exposure and empty exposure, command/read-only
eligibility, and real MCP tools/list across command capability changes. Existing
code-mode execution and declaration tests retain their original permission and
schema assertions. A normal task without named tools is required for live acceptance.
