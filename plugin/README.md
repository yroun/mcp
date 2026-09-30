# Yroun

Yroun publishes a daily market briefing for Korea, the United States and Japan,
and gives you a hub — a workspace whose pages can hold live data from the APIs
you already run. This plugin brings both into Claude.

## What you can do with it

**Read today's market without an account.** Ask what happened in the Korean
market yesterday, what a company is doing now, or how a name has moved over a
month. Editions are published documents and the market data is public, so
these answer before you connect anything.

**Work in your own hub, as yourself.** Once you connect, Claude can read and
write the pages, posts, schedules and series in the hubs you own — draft a
page, keep a status document current, plan a serialized work against its own
story bible.

## What it runs, sends and fetches

The plugin starts one local MCP server: `npx -y @yroun/mcp@0.3.0`, pinned to
an exact version. The server runs on your machine and talks only to
`api.yroun.com`.

* **Briefings and market data** are anonymous reads. No account, no token.
* **Everything else** goes through your own Yroun account. `yroun_connect`
  opens your browser for an OAuth sign-in (Authorization Code with PKCE); the
  token is stored on your machine and never leaves it. `yroun_auth_status`
  shows the connection and `yroun_sign_out` ends it.
* The plugin asks for the scopes it needs to read and write hubs, posts and
  series, and nothing beyond them.

## What it deliberately cannot do

This connector ships **end-user capabilities only**. It acts as you, with your
own grant, against Yroun's public API. Administration, moderation, operations
tooling and privileged credentials are out of scope by design, not by
configuration — a test in the package fails the release if a privileged path
or credential class appears in its source, so the boundary cannot drift.

It cannot reach another person's private hub, and it has no way to read or
write anything your own account could not.

## Getting started

Add the plugin, then ask Claude something like *"what did the Korean market do
yesterday"* — that works immediately. When you want Claude to write into your
own workspace, ask it to connect your Yroun account and follow the browser
sign-in once.

Yroun is at [www.yroun.com](https://www.yroun.com). The connector's source is
in this repository and its package is [`@yroun/mcp`](https://www.npmjs.com/package/@yroun/mcp).

MIT licensed.
