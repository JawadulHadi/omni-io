# ADR 0007: urql for the console; a separate Shadow-DOM bundle for the widget

- **Status:** Accepted
- **Date:** 2026-09-29

## Context

The console is CRUD-shaped: lists, forms, a handful of mutations and one subscription. The widget runs on customers' pages, where bundle weight and CSS collisions matter.

## Decision

- **Console: urql.** Its document cache invalidates results by typename after mutations. `@urql/exchange-auth` handles token refresh, and `graphql-ws` carries subscriptions. Apollo Client's normalized cache would add weight and configuration the console doesn't need.
- **Widget: a separate IIFE build (`widget.js`)**, with no router, urql or Tailwind.
  - It renders into a **Shadow DOM** with plain, prefixed CSS.
  - It is built ASCII-only, so pages that don't declare UTF-8 still render it correctly.
  - It calls the API with absolute URLs.

## Consequences

- A customer's page downloads about 72 kB gzipped, and never loads the console.
- Widget styling is hand-written CSS, because Tailwind v4's `@property`-based utilities don't register inside a shadow root.
