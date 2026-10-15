ALTER TABLE unapplied_disputes
    DROP COLUMN lost_at;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_dispute_lost_revokes_check;

ALTER TABLE purchases
    DROP COLUMN dispute_lost_at;
