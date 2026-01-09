# FFSCTrapperApp — AI Context Pack

## What we are building
A stable day-to-day ops tool ("Trapper Dashboard") that makes messy trapping locations make sense in data.
Airtable stays primary until Trapper App is complete and trusted. We run both in parallel during transition.

## Core problem: location ambiguity
Cats aren’t always at a clean street address.
Examples: trail segments (Joe Rodota Trail), parks, apartment complexes, corner-lots, “behind the barn”.
We need an “anchor location” concept that preserves context without pretending precision.

## Systems roles
- Airtable: current operational system (big, structured, replaces paper + MyMaps)
- ClinicHQ: historical appointments/history system of record (keep using for history)
- Supabase/Postgres/PostGIS: Trapper App backend (address registry + places + requests + review queues)

## Important correction about geocoding
Many requests are already geocoded during the existing geocode Zap flow.
So the Supabase function `geocode-addresses-batch` returning selected=0 is often normal: nothing missing or eligible.

## Current state (as of today)
- Local folder (legacy name OK): /Users/benmisdiaz/Projects/ffsc-trapper-cockpit
- GitHub repo: FFSCTrapperApp
- Supabase SQL editor open
- Edge function batch geocode loop returns selected=0, attempted=0, updated=0

## Working rules
- Never commit secrets/tokens to git. Use local `.env`.
- Prefer PostGIS radius/nearby matching over exact strings.
- Prioritize small, shippable ops value: upcoming clinics, request/place context, “what should I do this week?”
- Preserve “anchor vs exact location” as first-class data.

## Next steps after repo is stable
1) Commit this context pack + baseline files.
2) Run 3 sanity SQL checks:
   - counts (requests/addresses/places)
   - how many addresses have geometry
   - what is in `v_address_review_queue` and why
3) Confirm how we represent “approximate places” like trail segments without losing notes/context.
