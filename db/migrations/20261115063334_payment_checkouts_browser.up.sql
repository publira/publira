-- What a checkout that runs in the reader's browser needs beside its
-- purchase: a payment provider whose payments only the provider's script on a
-- storefront page can create starts no checkout of its own, so the page reads
-- what the checkout shows from here, and the payment the script answers is
-- kept here once it completes the checkout, since such a provider reads a
-- payment by that id alone and lists none.

ALTER TABLE payment_checkouts
    -- What the checkout shows the reader and where it returns them, as the
    -- server encodes it: its line items, its discount, and its success and
    -- cancel URLs. NULL on a checkout started before the column existed.
    ADD COLUMN request jsonb,
    -- The provider's id of the payment that completed the checkout, which
    -- reconciliation reads the payment by. NULL until a payment completes it,
    -- and for a provider that names its payments by nothing it needs kept.
    ADD COLUMN payment_id text,
    ADD CONSTRAINT payment_checkouts_request_object_check CHECK ((jsonb_typeof(request) = 'object'::text));
