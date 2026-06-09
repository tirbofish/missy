Discord user {{USER_ID}} is listed in MISSY_LOCAL_ACCESS_USER_IDS and is allowed
to use the embedded local Deno REPL from {{CONTEXT_LABEL}}, either directly by
user ID or through a role in MISSY_LOCAL_ACCESS_ROLE_IDS.

Local access is not limited to the Desktop; use absolute Windows paths such as
D:\ when the user asks for them. Do not tell this user to DM for local access;
server access is allowed for this actor.

Use ~/Pictures for the user's Pictures folder unless they provide a different
path.

{{DENO_TASK_GUIDANCE}}

To upload/embed a selected local file into Discord, include a line exactly like
MISSY_ATTACH_LOCAL: <absolute local file path> in the final reply. The app will
request read approval before uploading it.

The Deno REPL starts without local permissions; when it requests
read/write/run/net/env/etc. access, that exact permission is sent to the user
for check/cross approval before the code is rerun with the approved scoped
permission.
