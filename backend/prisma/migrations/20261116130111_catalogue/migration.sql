-- CreateEnum
CREATE TYPE "TrackingMode" AS ENUM ('SERIALIZED', 'QUANTITY');

-- CreateEnum
CREATE TYPE "IdentifierType" AS ENUM ('IMEI', 'SERIAL');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "sku" VARCHAR(40) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "category_id" UUID NOT NULL,
    "brand_id" UUID NOT NULL,
    "tracking_mode" "TrackingMode" NOT NULL,
    "identifier_type" "IdentifierType",
    "identifiers_per_unit" INTEGER,
    "cost_price" DECIMAL(14,2) NOT NULL,
    "selling_price" DECIMAL(14,2) NOT NULL,
    "reorder_level" INTEGER NOT NULL DEFAULT 0,
    "specifications" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key_key" ON "categories"("name_key");

-- CreateIndex
CREATE INDEX "categories_is_active_idx" ON "categories"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "brands_name_key_key" ON "brands"("name_key");

-- CreateIndex
CREATE INDEX "brands_is_active_idx" ON "brands"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");

-- CreateIndex
CREATE INDEX "products_name_idx" ON "products"("name");

-- CreateIndex
CREATE INDEX "products_category_id_idx" ON "products"("category_id");

-- CreateIndex
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");

-- CreateIndex
CREATE INDEX "products_is_active_idx" ON "products"("is_active");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written integrity rules (ADR-025). The database is the final guarantee
-- behind the DTO validation.
-- ---------------------------------------------------------------------------

-- Names: non-blank; name_key is the lower-case form used for uniqueness.
ALTER TABLE "categories" ADD CONSTRAINT "categories_name_chk"
  CHECK (length(btrim("name")) > 0 AND "name_key" = lower("name_key") AND length("name_key") > 0);
ALTER TABLE "brands" ADD CONSTRAINT "brands_name_chk"
  CHECK (length(btrim("name")) > 0 AND "name_key" = lower("name_key") AND length("name_key") > 0);

-- SKU: upper-case, 2-40 chars of A-Z 0-9 . _ - (starting with a letter or digit).
ALTER TABLE "products" ADD CONSTRAINT "products_sku_chk"
  CHECK ("sku" ~ '^[A-Z0-9][A-Z0-9._-]{1,39}$');
ALTER TABLE "products" ADD CONSTRAINT "products_name_chk"
  CHECK (length(btrim("name")) > 0);

-- Money and quantities are never negative (BR-08).
ALTER TABLE "products" ADD CONSTRAINT "products_prices_chk"
  CHECK ("cost_price" >= 0 AND "selling_price" >= 0);
ALTER TABLE "products" ADD CONSTRAINT "products_reorder_level_chk"
  CHECK ("reorder_level" >= 0);

-- Tracking-mode consistency: serialized products declare an identifier policy
-- (1-2 identifiers per unit); quantity products must not.
ALTER TABLE "products" ADD CONSTRAINT "products_tracking_policy_chk"
  CHECK (
    ("tracking_mode" = 'SERIALIZED' AND "identifier_type" IS NOT NULL
       AND "identifiers_per_unit" BETWEEN 1 AND 2)
    OR
    ("tracking_mode" = 'QUANTITY' AND "identifier_type" IS NULL
       AND "identifiers_per_unit" IS NULL)
  );

-- Specifications must be a JSON object.
ALTER TABLE "products" ADD CONSTRAINT "products_specifications_chk"
  CHECK (jsonb_typeof("specifications") = 'object');

-- SKU and tracking policy are immutable after creation (D9) — enforced in the
-- database too, so no code path (or manual SQL) can change them.
CREATE FUNCTION "products_prevent_immutable_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."sku" IS DISTINCT FROM OLD."sku"
     OR NEW."tracking_mode" IS DISTINCT FROM OLD."tracking_mode"
     OR NEW."identifier_type" IS DISTINCT FROM OLD."identifier_type"
     OR NEW."identifiers_per_unit" IS DISTINCT FROM OLD."identifiers_per_unit" THEN
    RAISE EXCEPTION 'sku, tracking_mode and identifier policy are immutable'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "products_immutable_fields"
  BEFORE UPDATE ON "products"
  FOR EACH ROW EXECUTE FUNCTION "products_prevent_immutable_change"();
