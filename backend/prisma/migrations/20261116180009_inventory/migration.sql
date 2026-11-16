-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING_BALANCE', 'PURCHASE_RECEIPT', 'ADJUSTMENT_INCREASE', 'ADJUSTMENT_DECREASE', 'TRANSFER_OUT', 'TRANSFER_IN');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('IN_STOCK', 'IN_TRANSIT', 'RESERVED', 'SOLD', 'RETURNED', 'UNDER_REPAIR', 'WRITTEN_OFF');

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "purchase_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "received_by_id" UUID NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supplier_delivery_ref" VARCHAR(100),
    "supplier_invoice_ref" VARCHAR(100),
    "notes" VARCHAR(1000),
    "idempotency_key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_item_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_units" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "UnitStatus" NOT NULL DEFAULT 'IN_STOCK',
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "goods_receipt_item_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unit_identifiers" (
    "id" UUID NOT NULL,
    "product_unit_id" UUID NOT NULL,
    "type" "IdentifierType" NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "unit_identifiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_balances" (
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_balances_pkey" PRIMARY KEY ("product_id","branch_id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "movement_type" "MovementType" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "value_delta" DECIMAL(16,2) NOT NULL,
    "product_unit_id" UUID,
    "reference_type" VARCHAR(30) NOT NULL,
    "reference_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_valuations" (
    "product_id" UUID NOT NULL,
    "average_cost" DECIMAL(18,4) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_valuations_pkey" PRIMARY KEY ("product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_reference_key" ON "goods_receipts"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipts_idempotency_key_key" ON "goods_receipts"("idempotency_key");

-- CreateIndex
CREATE INDEX "goods_receipts_purchase_id_idx" ON "goods_receipts"("purchase_id");

-- CreateIndex
CREATE INDEX "goods_receipts_branch_id_received_at_idx" ON "goods_receipts"("branch_id", "received_at");

-- CreateIndex
CREATE INDEX "goods_receipt_items_purchase_item_id_idx" ON "goods_receipt_items"("purchase_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "goods_receipt_items_goods_receipt_id_purchase_item_id_key" ON "goods_receipt_items"("goods_receipt_id", "purchase_item_id");

-- CreateIndex
CREATE INDEX "product_units_product_id_branch_id_status_idx" ON "product_units"("product_id", "branch_id", "status");

-- CreateIndex
CREATE INDEX "product_units_branch_id_status_idx" ON "product_units"("branch_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "unit_identifiers_value_key" ON "unit_identifiers"("value");

-- CreateIndex
CREATE INDEX "unit_identifiers_product_unit_id_idx" ON "unit_identifiers"("product_unit_id");

-- CreateIndex
CREATE INDEX "stock_balances_branch_id_idx" ON "stock_balances"("branch_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_branch_id_created_at_idx" ON "stock_movements"("product_id", "branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_branch_id_created_at_idx" ON "stock_movements"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_reference_type_reference_id_idx" ON "stock_movements"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_movements_product_unit_id_idx" ON "stock_movements"("product_unit_id");

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_received_by_id_fkey" FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_goods_receipt_id_fkey" FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_purchase_item_id_fkey" FOREIGN KEY ("purchase_item_id") REFERENCES "purchase_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_goods_receipt_item_id_fkey" FOREIGN KEY ("goods_receipt_item_id") REFERENCES "goods_receipt_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_identifiers" ADD CONSTRAINT "unit_identifiers_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_unit_id_fkey" FOREIGN KEY ("product_unit_id") REFERENCES "product_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (ADR-029, ADR-030). The DB is the final guard.
-- ---------------------------------------------------------------------------

-- Goods receipts -----------------------------------------------------------------
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_reference_chk"
  CHECK ("reference" ~ '^GRN-[A-Z0-9-]{2,20}-[0-9]{4}-[0-9]{6}$');
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_request_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "goods_receipt_items" ADD CONSTRAINT "goods_receipt_items_chk"
  CHECK ("quantity" > 0 AND "unit_cost" > 0);

-- BR-14 (+ I4, I22): the PO's creator, submitter (any cycle) and approver can
-- never receive it — whatever their role, SYSTEM_ADMIN included.
CREATE FUNCTION "goods_receipts_enforce_br14"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  po RECORD;
BEGIN
  SELECT "created_by_id", "submitted_by_id", "approved_by_id", "branch_id", "status"
    INTO po FROM "purchases" WHERE "id" = NEW."purchase_id";
  IF NEW."received_by_id" IN (po."created_by_id", po."submitted_by_id", po."approved_by_id")
     OR EXISTS (SELECT 1 FROM "audit_logs"
                WHERE "entity_type" = 'Purchase' AND "entity_id" = NEW."purchase_id"
                  AND "action" = 'purchase.submitted' AND "actor_id" = NEW."received_by_id") THEN
    RAISE EXCEPTION 'BR-14: the creator, submitter or approver of a purchase order cannot receive it'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."branch_id" <> po."branch_id" THEN
    RAISE EXCEPTION 'goods receipt branch must equal the purchase order branch'
      USING ERRCODE = 'check_violation';
  END IF;
  IF po."status" NOT IN ('APPROVED', 'PARTIALLY_RECEIVED') THEN
    RAISE EXCEPTION 'goods can only be received against APPROVED or PARTIALLY_RECEIVED orders (status %)', po."status"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "goods_receipts_br14"
  BEFORE INSERT ON "goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION "goods_receipts_enforce_br14"();

-- Receipts and their lines are insert-only.
CREATE FUNCTION "inventory_prevent_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$;
CREATE TRIGGER "goods_receipts_append_only" BEFORE UPDATE OR DELETE ON "goods_receipts"
  FOR EACH ROW EXECUTE FUNCTION "inventory_prevent_change"();
CREATE TRIGGER "goods_receipt_items_append_only" BEFORE UPDATE OR DELETE ON "goods_receipt_items"
  FOR EACH ROW EXECUTE FUNCTION "inventory_prevent_change"();

-- Ledger -------------------------------------------------------------------------
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_chk"
  CHECK ("quantity_delta" <> 0
     AND ("product_unit_id" IS NULL OR "quantity_delta" IN (1, -1))
     AND "unit_cost" >= 0
     AND "value_delta" = "quantity_delta" * "unit_cost");
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reference_type_chk"
  CHECK ("reference_type" IN ('GOODS_RECEIPT', 'ADJUSTMENT', 'TRANSFER'));
CREATE TRIGGER "stock_movements_append_only" BEFORE UPDATE OR DELETE ON "stock_movements"
  FOR EACH ROW EXECUTE FUNCTION "inventory_prevent_change"();

-- Balances (BR-16) -----------------------------------------------------------------
ALTER TABLE "stock_balances" ADD CONSTRAINT "stock_balances_non_negative_chk"
  CHECK ("on_hand" >= 0 AND "reserved" >= 0 AND "reserved" <= "on_hand");

-- Valuation ------------------------------------------------------------------------
ALTER TABLE "inventory_valuations" ADD CONSTRAINT "inventory_valuations_cost_chk"
  CHECK ("average_cost" >= 0);

-- Units & identifiers (D3, BR-17) ----------------------------------------------------
ALTER TABLE "product_units" ADD CONSTRAINT "product_units_cost_chk" CHECK ("unit_cost" >= 0);
ALTER TABLE "unit_identifiers" ADD CONSTRAINT "unit_identifiers_format_chk"
  CHECK (("type" = 'IMEI' AND "value" ~ '^[0-9]{15}$')
      OR ("type" = 'SERIAL' AND "value" ~ '^[A-Z0-9][A-Z0-9./-]{3,63}$'));
CREATE UNIQUE INDEX "unit_identifiers_one_primary"
  ON "unit_identifiers" ("product_unit_id") WHERE "is_primary";

-- Every unit belongs to a SERIALIZED product and carries exactly
-- identifiers_per_unit identifiers of the product's identifier_type.
-- DEFERRABLE: checked at commit, after units and identifiers are inserted.
CREATE FUNCTION "product_units_check_identifiers"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unit_id uuid;
  p RECORD;
  n integer;
  wrong integer;
BEGIN
  unit_id := CASE WHEN TG_TABLE_NAME = 'product_units' THEN NEW."id" ELSE NEW."product_unit_id" END;
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
CREATE CONSTRAINT TRIGGER "product_units_identifiers_valid"
  AFTER INSERT ON "product_units" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "product_units_check_identifiers"();
CREATE CONSTRAINT TRIGGER "unit_identifiers_valid"
  AFTER INSERT OR UPDATE ON "unit_identifiers" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "product_units_check_identifiers"();
-- Identifiers are never deleted or re-pointed (never reused, BR-17).
CREATE TRIGGER "unit_identifiers_no_delete" BEFORE DELETE ON "unit_identifiers"
  FOR EACH ROW EXECUTE FUNCTION "inventory_prevent_change"();
