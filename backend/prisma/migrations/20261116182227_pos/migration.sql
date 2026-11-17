-- CreateEnum
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER');

-- CreateTable
CREATE TABLE "tax_settings" (
    "id" UUID NOT NULL,
    "name" VARCHAR(30) NOT NULL DEFAULT 'VAT',
    "rate_percent" DECIMAL(5,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "notes" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "receipt_number" VARCHAR(40) NOT NULL,
    "branch_id" UUID NOT NULL,
    "cashier_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "subtotal" DECIMAL(14,2) NOT NULL,
    "discount_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL,
    "tax_amount" DECIMAL(14,2) NOT NULL,
    "total" DECIMAL(14,2) NOT NULL,
    "amount_paid" DECIMAL(14,2) NOT NULL,
    "change_given" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "completed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_items" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "product_unit_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,
    "cost_at_sale" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "sale_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "amount_tendered" DECIMAL(14,2),
    "reference" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_name_idx" ON "customers"("name");

-- CreateIndex
CREATE UNIQUE INDEX "sales_receipt_number_key" ON "sales"("receipt_number");

-- CreateIndex
CREATE UNIQUE INDEX "sales_idempotency_key_key" ON "sales"("idempotency_key");

-- CreateIndex
CREATE INDEX "sales_branch_id_completed_at_idx" ON "sales"("branch_id", "completed_at");

-- CreateIndex
CREATE INDEX "sales_cashier_id_completed_at_idx" ON "sales"("cashier_id", "completed_at");

-- CreateIndex
CREATE INDEX "sales_customer_id_idx" ON "sales"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_product_unit_id_key" ON "sale_items"("product_unit_id");

-- CreateIndex
CREATE INDEX "sale_items_product_id_idx" ON "sale_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "sale_items_sale_id_line_number_key" ON "sale_items"("sale_id", "line_number");

-- CreateIndex
CREATE INDEX "payments_sale_id_idx" ON "payments"("sale_id");

-- AddForeignKey
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_cashier_id_fkey" FOREIGN KEY ("cashier_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (ADR-031). The database is the final guard.
-- ---------------------------------------------------------------------------

-- Module 5 ledger: allow SALE as a movement reference (the only change to an
-- existing table; existing rows are unaffected).
ALTER TABLE "stock_movements" DROP CONSTRAINT "stock_movements_reference_type_chk";
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reference_type_chk"
  CHECK ("reference_type" IN ('GOODS_RECEIPT', 'ADJUSTMENT', 'TRANSFER', 'SALE'));

-- Shared helper: refuse UPDATE/DELETE on append-only tables.
CREATE FUNCTION "pos_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

-- Tax settings (S1, BR-20) ------------------------------------------------------
ALTER TABLE "tax_settings" ADD CONSTRAINT "tax_settings_rate_chk"
  CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100 AND length(btrim("name")) > 0);
-- Exactly one active rate at a time.
CREATE UNIQUE INDEX "tax_settings_one_active" ON "tax_settings" ((true)) WHERE "is_active";
-- History is immutable: the only permitted change is deactivating the old row.
CREATE FUNCTION "tax_settings_only_deactivate"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tax_settings rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD."is_active" AND NOT NEW."is_active"
     AND (NEW."id", NEW."name", NEW."rate_percent", NEW."created_by_id", NEW."created_at")
         IS NOT DISTINCT FROM
         (OLD."id", OLD."name", OLD."rate_percent", OLD."created_by_id", OLD."created_at") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'tax_settings rows are immutable (only deactivation is allowed)'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "tax_settings_immutable" BEFORE UPDATE OR DELETE ON "tax_settings"
  FOR EACH ROW EXECUTE FUNCTION "tax_settings_only_deactivate"();

-- Customers (S6) -------------------------------------------------------------------
ALTER TABLE "customers" ADD CONSTRAINT "customers_fields_chk"
  CHECK (length(btrim("name")) > 0
     AND ("phone" IS NULL OR "phone" ~ '^\+[0-9]{8,15}$')
     AND ("email" IS NULL OR "email" = lower("email")));
CREATE TRIGGER "customers_no_delete" BEFORE DELETE ON "customers"
  FOR EACH ROW EXECUTE FUNCTION "pos_prevent_change"();

-- Sales -------------------------------------------------------------------------------
ALTER TABLE "sales" ADD CONSTRAINT "sales_receipt_number_chk"
  CHECK ("receipt_number" ~ '^RCT-[A-Z0-9-]{2,20}-[0-9]{4}-[0-9]{6}$');
ALTER TABLE "sales" ADD CONSTRAINT "sales_request_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "sales" ADD CONSTRAINT "sales_amounts_chk"
  CHECK ("subtotal" >= 0 AND "tax_amount" >= 0 AND "change_given" >= 0
     AND "tax_rate_percent" >= 0 AND "tax_rate_percent" <= 100
     AND "currency" ~ '^[A-Z]{3}$'
     -- S3: no discounts in the MVP.
     AND "discount_total" = 0
     AND "total" = "subtotal" - "discount_total" + "tax_amount"
     AND "amount_paid" = "total");
CREATE TRIGGER "sales_append_only" BEFORE UPDATE OR DELETE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION "pos_prevent_change"();

-- Sale items ---------------------------------------------------------------------------
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_amounts_chk"
  CHECK ("quantity" BETWEEN 1 AND 1000
     AND "unit_price" >= 0 AND "cost_at_sale" >= 0 AND "line_number" >= 1
     AND "line_total" = "quantity" * "unit_price"
     AND ("product_unit_id" IS NULL OR "quantity" = 1));
CREATE TRIGGER "sale_items_append_only" BEFORE UPDATE OR DELETE ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "pos_prevent_change"();

-- A serialized product's line must carry exactly its own unit; a quantity
-- product's line must not carry a unit.
CREATE FUNCTION "sale_items_check_unit"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mode "TrackingMode";
  unit_product uuid;
BEGIN
  SELECT "tracking_mode" INTO mode FROM "products" WHERE "id" = NEW."product_id";
  IF mode = 'SERIALIZED' THEN
    IF NEW."product_unit_id" IS NULL THEN
      RAISE EXCEPTION 'serialized product lines must reference a unit' USING ERRCODE = 'check_violation';
    END IF;
    SELECT "product_id" INTO unit_product FROM "product_units" WHERE "id" = NEW."product_unit_id";
    IF unit_product IS DISTINCT FROM NEW."product_id" THEN
      RAISE EXCEPTION 'sale line unit belongs to a different product' USING ERRCODE = 'check_violation';
    END IF;
  ELSIF NEW."product_unit_id" IS NOT NULL THEN
    RAISE EXCEPTION 'quantity-tracked product lines cannot reference a unit' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "sale_items_unit_valid" BEFORE INSERT ON "sale_items"
  FOR EACH ROW EXECUTE FUNCTION "sale_items_check_unit"();

-- Payments (S4) -------------------------------------------------------------------------
ALTER TABLE "payments" ADD CONSTRAINT "payments_rules_chk"
  CHECK ("amount" > 0
     AND ("amount_tendered" IS NULL OR ("method" = 'CASH' AND "amount_tendered" >= "amount"))
     AND ("method" NOT IN ('MOBILE_MONEY', 'BANK_TRANSFER')
          OR ("reference" IS NOT NULL AND length(btrim("reference")) > 0)));
CREATE TRIGGER "payments_append_only" BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "pos_prevent_change"();

-- Whole-sale consistency, checked at COMMIT (after header, lines and payments
-- are inserted): ≥ 1 line, Σ line totals = subtotal, ≥ 1 payment,
-- Σ payments = total, change = Σ cash tendered − Σ cash amounts.
CREATE FUNCTION "sales_check_complete"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  sid uuid;
  s RECORD;
  line_count integer;
  line_sum numeric;
  pay_count integer;
  pay_sum numeric;
  change_sum numeric;
BEGIN
  IF TG_TABLE_NAME = 'sales' THEN
    sid := NEW."id";
  ELSE
    sid := NEW."sale_id";
  END IF;
  SELECT "subtotal", "total", "change_given" INTO s FROM "sales" WHERE "id" = sid;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT count(*), COALESCE(sum("line_total"), 0) INTO line_count, line_sum
    FROM "sale_items" WHERE "sale_id" = sid;
  SELECT count(*), COALESCE(sum("amount"), 0),
         COALESCE(sum(COALESCE("amount_tendered", "amount") - "amount") FILTER (WHERE "method" = 'CASH'), 0)
    INTO pay_count, pay_sum, change_sum
    FROM "payments" WHERE "sale_id" = sid;
  IF line_count = 0 OR line_sum <> s."subtotal" THEN
    RAISE EXCEPTION 'sale %: lines (% / %) do not match subtotal %', sid, line_count, line_sum, s."subtotal"
      USING ERRCODE = 'check_violation';
  END IF;
  IF pay_count = 0 OR pay_sum <> s."total" THEN
    RAISE EXCEPTION 'sale %: payments % do not equal total %', sid, pay_sum, s."total"
      USING ERRCODE = 'check_violation';
  END IF;
  IF change_sum <> s."change_given" THEN
    RAISE EXCEPTION 'sale %: change_given % does not match cash tendered (%)', sid, s."change_given", change_sum
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "sales_complete" AFTER INSERT ON "sales"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "sales_check_complete"();
CREATE CONSTRAINT TRIGGER "sale_items_complete" AFTER INSERT ON "sale_items"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "sales_check_complete"();
CREATE CONSTRAINT TRIGGER "payments_complete" AFTER INSERT ON "payments"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "sales_check_complete"();
