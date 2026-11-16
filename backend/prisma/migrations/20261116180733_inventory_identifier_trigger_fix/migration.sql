-- Fix for 20261116180009_inventory: a PL/pgSQL CASE expression referenced
-- NEW."product_unit_id" while firing for product_units rows (which have no
-- such column), failing every serialized receipt. Use IF so only the branch
-- matching the firing table is evaluated. Behaviour is otherwise unchanged.
CREATE OR REPLACE FUNCTION "product_units_check_identifiers"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unit_id uuid;
  p RECORD;
  n integer;
  wrong integer;
BEGIN
  IF TG_TABLE_NAME = 'product_units' THEN
    unit_id := NEW."id";
  ELSE
    unit_id := NEW."product_unit_id";
  END IF;
  SELECT pr."tracking_mode", pr."identifier_type", pr."identifiers_per_unit"
    INTO p FROM "product_units" u JOIN "products" pr ON pr."id" = u."product_id"
    WHERE u."id" = unit_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF p."tracking_mode" <> 'SERIALIZED' THEN
    RAISE EXCEPTION 'product units are only allowed for SERIALIZED products'
      USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE "type" <> p."identifier_type")
    INTO n, wrong FROM "unit_identifiers" WHERE "product_unit_id" = unit_id;
  IF n <> p."identifiers_per_unit" OR wrong > 0 THEN
    RAISE EXCEPTION 'unit % must have exactly % % identifier(s) (has %, % of the wrong type)',
      unit_id, p."identifiers_per_unit", p."identifier_type", n, wrong
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
