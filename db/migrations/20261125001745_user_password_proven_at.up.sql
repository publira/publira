-- When the account's password was last set by someone who had proved the
-- address is theirs: a password reset through the mailed link, an accepted
-- invitation, or an account an administrator created. A sign-up's password
-- stays null when its confirmation link is followed, because following the
-- link proves who reads the mailbox, not who chose the password. Changing the
-- address clears it, since whoever set the password proved the old one.
ALTER TABLE users ADD COLUMN password_proven_at timestamp with time zone;
