-- Module 6 (ADR-031): ledger movement type for completed sales.
-- Kept in its own migration: PostgreSQL requires a new enum value to be
-- committed before it can be used.
-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'SALE';
