-- Only the newly provisioned production/copy database. Archive/source unchanged.
CREATE OR REPLACE FUNCTION central_money_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.cents < 0 AND NEW.account ~ '^(cash|bank)(:|$)|^account:'
 AND EXISTS(SELECT 1 FROM central_operation_policy WHERE NOT financial_opening_approved)
 THEN RAISE EXCEPTION 'RUY_FINANCIAL_OPENING_REQUIRED'; END IF;
 RETURN NEW;
END $$;
