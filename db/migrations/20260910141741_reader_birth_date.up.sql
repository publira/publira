-- The date a reader was born on, which is what an age rule is decided from.

-- COLUMN: users birth_date
-- Nullable because almost every account has none: a tenant that carries no
-- rated work never asks, and the accounts that predate the column were never
-- asked either. Absent is therefore a state the age rule has to answer, not a
-- gap to be filled in later, and it answers it as "not old enough to be let
-- through".
--
-- A date rather than a timestamp. What is stored is the calendar day the
-- reader names, and the day an age is counted against is the tenant's own
-- calendar day: pinning either to an instant would put a reader's birthday a
-- few hours out for every tenant that keeps a different time zone.
ALTER TABLE users
    ADD COLUMN birth_date date;
