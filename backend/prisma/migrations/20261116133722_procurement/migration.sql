-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_key" VARCHAR(150) NOT NULL,
    "contact_person" VARCHAR(150),
    "phone" VARCHAR(30),
    "email" VARCHAR(254),
    "address" VARCHAR(300),
    "tin" VARCHAR(9),
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchases" (
    "id" UUID NOT NULL,
    "reference" VARCHAR(40) NOT NULL,
    "supplier_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL DEFAULT 'TZS',
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "supplier_reference" VARCHAR(100),
    "expected_delivery_date" DATE,
    "notes" VARCHAR(1000),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_id" UUID NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_by_id" UUID,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "approval_note" VARCHAR(500),
    "rejected_by_id" UUID,
    "rejected_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(500),
    "cancelled_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancellation_reason" VARCHAR(500),

    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_items" (
    "id" UUID NOT NULL,
    "purchase_id" UUID NOT NULL,
    "line_number" INTEGER NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" VARCHAR(200) NOT NULL,
    "quantity_ordered" INTEGER NOT NULL,
    "quantity_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "line_total" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "purchase_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_sequences" (
    "scope" VARCHAR(100) NOT NULL,
    "last_value" INTEGER NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "document_sequences_pkey" PRIMARY KEY ("scope")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_name_key_key" ON "suppliers"("name_key");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_tin_key" ON "suppliers"("tin");

-- CreateIndex
CREATE INDEX "suppliers_is_active_idx" ON "suppliers"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "purchases_reference_key" ON "purchases"("reference");

-- CreateIndex
CREATE INDEX "purchases_branch_id_status_idx" ON "purchases"("branch_id", "status");

-- CreateIndex
CREATE INDEX "purchases_supplier_id_status_idx" ON "purchases"("supplier_id", "status");

-- CreateIndex
CREATE INDEX "purchases_status_idx" ON "purchases"("status");

-- CreateIndex
CREATE INDEX "purchases_created_at_idx" ON "purchases"("created_at");

-- CreateIndex
CREATE INDEX "purchase_items_product_id_idx" ON "purchase_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_purchase_id_product_id_key" ON "purchase_items"("purchase_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_items_purchase_id_line_number_key" ON "purchase_items"("purchase_id", "line_number");

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_rejected_by_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (ADR-027). The database is the final guarantee.
-- ---------------------------------------------------------------------------

-- Suppliers ------------------------------------------------------------------
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_name_chk"
  CHECK (length(btrim("name")) > 0 AND "name_key" = lower("name_key") AND length("name_key") > 0);
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tin_chk"
  CHECK ("tin" IS NULL OR "tin" ~ '^[0-9]{9}$');
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_email_chk"
  CHECK ("email" IS NULL OR "email" = lower("email"));

-- Document sequences -----------------------------------------------------------
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_value_chk"
  CHECK ("last_value" >= 1);

-- Purchases --------------------------------------------------------------------
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_reference_chk"
  CHECK ("reference" ~ '^PO-[A-Z0-9-]{2,20}-[0-9]{4}-[0-9]{6}$');
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_currency_chk"
  CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_subtotal_chk"
  CHECK ("subtotal" >= 0);

-- Separation of duties (BR-11, ADR-023/027): an approver or rejecter can never
-- be the creator or the submitter, whatever their role.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_sod_approver_chk"
  CHECK ("approved_by_id" IS NULL OR (
    "approved_by_id" <> "created_by_id"
    AND ("submitted_by_id" IS NULL OR "approved_by_id" <> "submitted_by_id")));
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_sod_rejecter_chk"
  CHECK ("rejected_by_id" IS NULL OR (
    "rejected_by_id" <> "created_by_id"
    AND ("submitted_by_id" IS NULL OR "rejected_by_id" <> "submitted_by_id")));

-- Status consistency: who/when columns must match the status.
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_status_consistency_chk"
  CHECK (
    CASE "status"
      WHEN 'DRAFT' THEN "submitted_by_id" IS NULL AND "approved_by_id" IS NULL
                        AND "rejected_by_id" IS NULL AND "cancelled_by_id" IS NULL
      WHEN 'SUBMITTED' THEN "submitted_by_id" IS NOT NULL AND "submitted_at" IS NOT NULL
                        AND "approved_by_id" IS NULL AND "rejected_by_id" IS NULL
                        AND "cancelled_by_id" IS NULL
      WHEN 'APPROVED' THEN "submitted_by_id" IS NOT NULL AND "approved_by_id" IS NOT NULL
                        AND "approved_at" IS NOT NULL AND "cancelled_by_id" IS NULL
      WHEN 'REJECTED' THEN "submitted_by_id" IS NOT NULL AND "rejected_by_id" IS NOT NULL
                        AND "rejected_at" IS NOT NULL AND "rejection_reason" IS NOT NULL
                        AND "cancelled_by_id" IS NULL
      WHEN 'PARTIALLY_RECEIVED' THEN "approved_by_id" IS NOT NULL AND "cancelled_by_id" IS NULL
      WHEN 'RECEIVED' THEN "approved_by_id" IS NOT NULL AND "cancelled_by_id" IS NULL
      WHEN 'CANCELLED' THEN "cancelled_by_id" IS NOT NULL AND "cancelled_at" IS NOT NULL
                        AND "cancellation_reason" IS NOT NULL
    END
  );
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_reasons_chk"
  CHECK (("rejection_reason" IS NULL OR length(btrim("rejection_reason")) >= 5)
     AND ("cancellation_reason" IS NULL OR length(btrim("cancellation_reason")) >= 5));

-- Reference, creator, branch and currency never change after creation.
CREATE FUNCTION "purchases_prevent_immutable_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."reference" IS DISTINCT FROM OLD."reference"
     OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."branch_id" IS DISTINCT FROM OLD."branch_id"
     OR NEW."currency" IS DISTINCT FROM OLD."currency" THEN
    RAISE EXCEPTION 'purchase reference, creator, branch and currency are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "purchases_immutable_fields"
  BEFORE UPDATE ON "purchases"
  FOR EACH ROW EXECUTE FUNCTION "purchases_prevent_immutable_change"();

-- Purchase items -----------------------------------------------------------------
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_quantities_chk"
  CHECK ("quantity_ordered" BETWEEN 1 AND 1000000
     AND "quantity_received" >= 0 AND "quantity_received" <= "quantity_ordered");
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_cost_chk"
  CHECK ("unit_cost" > 0 AND "line_total" = "quantity_ordered" * "unit_cost");
ALTER TABLE "purchase_items" ADD CONSTRAINT "purchase_items_line_number_chk"
  CHECK ("line_number" >= 1);

-- Lines may only change while the order is DRAFT. The single exception is
-- quantity_received while APPROVED / PARTIALLY_RECEIVED: Module 5's receiving hook.
CREATE FUNCTION "purchase_items_lock_outside_draft"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status "PurchaseStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "purchases"
    WHERE "id" = COALESCE(NEW."purchase_id", OLD."purchase_id");
  IF parent_status IS NULL OR parent_status = 'DRAFT' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE'
     AND parent_status IN ('APPROVED', 'PARTIALLY_RECEIVED')
     AND NEW."quantity_received" IS DISTINCT FROM OLD."quantity_received"
     AND (NEW."purchase_id", NEW."line_number", NEW."product_id", NEW."product_name",
          NEW."quantity_ordered", NEW."unit_cost", NEW."line_total")
         IS NOT DISTINCT FROM
         (OLD."purchase_id", OLD."line_number", OLD."product_id", OLD."product_name",
          OLD."quantity_ordered", OLD."unit_cost", OLD."line_total") THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'purchase order lines are locked once the order leaves DRAFT (status %)', parent_status
    USING ERRCODE = 'check_violation';
END;
$$;
CREATE TRIGGER "purchase_items_locked"
  BEFORE INSERT OR UPDATE OR DELETE ON "purchase_items"
  FOR EACH ROW EXECUTE FUNCTION "purchase_items_lock_outside_draft"();
