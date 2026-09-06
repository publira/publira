-- Bound the registration token by byte length.
--
-- The token is the primary key of user_push_devices, and a btree index entry
-- holds roughly 2704 bytes. Without this the database would refuse an oversized
-- token at the index rather than at the constraint, which reaches the reader as
-- an internal error instead of the invalid argument it is. octet_length rather
-- than char_length, so a multibyte value cannot pass a character count and then
-- fail the index anyway.
ALTER TABLE ONLY user_push_devices
    ADD CONSTRAINT user_push_devices_token_byte_limit_check CHECK ((octet_length(token) <= 1024));
