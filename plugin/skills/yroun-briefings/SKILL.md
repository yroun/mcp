---
name: yroun-briefings
description: Read Yroun's daily market briefings and public market data. Use when the user asks what happened in the Korean, US or Japanese market on a day, what a listed company is doing, or how a name has moved.
---

# Yroun briefings and market data

Yroun publishes one briefing per market per day — Korea, the United States and
Japan — and freezes it. An edition is that day's record: a lead, the day's
movers by trading value, the stories it cites with their sources, and a short
market read. Nothing in an edition changes after the day closes, so a date is
a stable thing to quote.

## Reading a day

`yroun_briefing_list_editions` gives the published days, newest first, and
takes `countryCode` (KR, US or JP) when the user cares about one market.
`yroun_briefing_get_edition` takes that country and a `YYYY-MM-DD` date and
returns the day itself.

A day that was never published answers 404. That is the honest answer, not an
error to work around — say the day has no edition rather than reaching for a
neighbouring date without telling the user.

## Reading a company

Start with `yroun_finance_search_stocks` whenever the user names a company
rather than a ticker. It takes the name and returns the symbol the other two
tools need. `yroun_finance_get_stock` gives the current state — price, day
change, trading value. `yroun_finance_get_candles` gives price history, which
is what answers "how has it moved" rather than "where is it now".

## What to say and what not to

These tools report what a market did. They do not advise. Say what the numbers
are and what an edition's cited sources said; do not tell the user to buy,
sell or hold, and do not describe a name as a recommendation. If the user asks
what they should do with a position, give them the facts and say plainly that
this is information, not advice.

An edition names the outlet behind each story. When you repeat a claim from an
edition, name that outlet too — the reader should be able to reach the
original. Editions also carry a disclosure that Yroun's founder may hold or
trade a name an edition features; repeat it when you pass on a specific name.
