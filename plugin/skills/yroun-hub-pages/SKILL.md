---
name: yroun-hub-pages
description: Work in a Yroun hub the user owns — read and write its pages, posts, schedules and series. Use when the user wants to keep notes, a status page, a dashboard or a serialized work in their own hub.
---

# Working in a Yroun hub

A hub is a workspace the user owns. Its pages hold documents and live widgets,
its posts hold a feed, its schedules hold dated entries, and a series holds a
serialized work with its own story bible and cast.

Everything here runs **as the user**, through their own grant. You can reach
only what they can reach, and a hub they do not own answers with a refusal
rather than an empty result. Treat a refusal as the answer, not as something
to retry differently.

## Finding your way before you write

`yroun_hub_list` gives the user's hubs. `yroun_hub_list_pages` gives one
hub's page tree with titles and one-line descriptions and **no bodies** —
that is deliberate, so you can navigate a large hub cheaply. Read the tree
first, pick at most a few pages, then `yroun_hub_get_page` for the ones you
actually need. Do not pull every page to answer one question.

## Writing

`yroun_hub_create_page` and `yroun_hub_update_page` take plain text and
convert it to the page format; a full page document passes through unchanged.
Deletes are soft and recoverable.

Before creating a page, list the tree and check whether one already covers
the subject. A second page with the same job is worse than a longer first
one — the user has to remember which is current.

## Series

`yroun_series_get_bible` and `yroun_series_list_episodes` are where a
revision session starts: read the worldview, the planned beats and the
existing episodes before writing a new one. `yroun_series_upsert_episode` is
idempotent by episode number, so a re-run corrects rather than duplicates.

## A note on scope

This plugin ships end-user capabilities only. There is no administration,
moderation or operations surface in it, and there is no way to reach another
person's private hub. If the user asks for something that would need that,
say so plainly instead of looking for a way around.
