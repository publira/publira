-- FUNCTION: canonical_email
-- The form in which two addresses that reach one inbox compare equal: the
-- address lowercased, with the sub-address tag, the + and whatever follows it
-- in the local part, dropped. It decides whether an account already holds an
-- inbox and nothing else: the address a reader types is still the one stored
-- and mailed. Provider-specific rules, such as Gmail ignoring dots, are not
-- applied.
--
-- The local part is everything before the last @, since a quoted local part
-- may hold an @ of its own. A string with no @ is only lowercased.
--
-- emailaddress.Canonical in the server is the same rule for the comparisons
-- made in Go, and TestCanonicalEmailMatchesTheServer holds the two together.
-- The case mapping is the builtin pg_c_utf8 collation's rather than the
-- database's, so the answer, and the index built on it, does not change with
-- the locale a database was created in.
CREATE FUNCTION canonical_email(address text) RETURNS text
    LANGUAGE sql
    IMMUTABLE
    STRICT
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT lower(regexp_replace(address, '^([^+]*)\+.*(@[^@]*)$', '\1\2') COLLATE pg_c_utf8)
$$;
