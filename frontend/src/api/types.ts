/** Backend response contracts (docs/05-api/08-api-contract.md). Money is always a decimal string. */

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export interface Envelope<T> {
  data: T
  meta: { requestId?: string; pagination?: Pagination }
}

export interface ErrorBody {
  statusCode: number
  code: string
  message: string
  requestId: string
  details?: { field: string; messages: string[] }[]
}

export type RoleKey =
  | 'SYSTEM_ADMIN'
  | 'MANAGER'
  | 'INVENTORY_OFFICER'
  | 'PROCUREMENT_OFFICER'
  | 'CASHIER'
  | 'TECHNICIAN'
  | 'AUDITOR'

export interface SessionUser {
  id: string
  email: string
  fullName: string
  role: RoleKey
  permissions: string[]
  branchIds: string[]
  allBranches: boolean
}

export interface Branch {
  id: string
  code: string
  name: string
  address: string | null
  phone: string | null
  isActive: boolean
}

export type TrackingMode = 'SERIALIZED' | 'QUANTITY'
export type IdentifierType = 'IMEI' | 'SERIAL'

export interface Identifier {
  type: IdentifierType
  value: string
  isPrimary: boolean
}

export interface CatalogueItem {
  id: string
  sku: string
  name: string
  brand: string
  category: string
  trackingMode: TrackingMode
  identifierType: IdentifierType | null
  identifiersPerUnit: number | null
  sellingPrice: string
  currency: string
  priceIncludesTax: false
  available: number
  inStock: boolean
}

export interface PosUnit {
  id: string
  productId: string
  sku: string
  identifiers: Identifier[]
}

export interface QuoteLine {
  lineNumber: number
  productId: string
  sku: string
  name: string
  trackingMode: TrackingMode
  quantity: number
  unitPrice: string
  lineTotal: string
  unit: { id: string; identifiers: Identifier[] } | null
}

export interface Quote {
  branch: { id: string; code: string }
  currency: string
  priceIncludesTax: false
  taxRatePercent: string
  lines: QuoteLine[]
  subtotal: string
  taxAmount: string
  total: string
  notice: string
}

export type PaymentMethod = 'CASH' | 'CARD' | 'MOBILE_MONEY' | 'BANK_TRANSFER'

export interface PaymentInput {
  method: PaymentMethod
  amount: string
  amountTendered?: string
  reference?: string
}

export interface SaleDetail {
  id: string
  receiptNumber: string
  status: 'COMPLETED'
  businessName: string
  branch: Branch | { id: string; code: string; name: string; address: string | null; phone: string | null }
  cashier: { id: string; fullName: string }
  customer: { id: string; name: string; phone?: string | null } | null
  completedAt: string
  businessDate: string
  businessDateTime: string
  timeZone: string
  currency: string
  priceIncludesTax: false
  lines: {
    lineNumber: number
    productId: string
    sku: string
    productName: string
    quantity: number
    unitPrice: string
    lineTotal: string
    unit: { id: string; identifiers: Identifier[] } | null
    costAtSale?: string
  }[]
  subtotal: string
  discountTotal: string
  taxRatePercent: string
  taxAmount: string
  total: string
  payments: {
    method: PaymentMethod
    amount: string
    amountTendered: string | null
    reference: string | null
  }[]
  amountPaid: string
  changeGiven: string
}

export interface SaleListItem {
  id: string
  receiptNumber: string
  completedAt: string
  businessDateTime: string
  branch: { id: string; code: string }
  cashier: { id: string; fullName: string }
  customer: { id: string; name: string } | null
  lineCount: number
  total: string
  paymentMethods: PaymentMethod[]
}

export interface SalesSummary {
  date: string
  timeZone: string
  currency: string
  branches: { id: string; code: string; name: string }[]
  saleCount: number
  unitsSold: number
  subtotal: string
  taxAmount: string
  total: string
  byPaymentMethod: { method: PaymentMethod; count: number; amount: string }[]
  byCashier: {
    cashier: { id: string; fullName: string | null }
    saleCount: number
    total: string
  }[]
  costOfGoodsSold?: string
  grossProfit?: string
}

export interface StockBalance {
  product: { id: string; sku: string; name: string; trackingMode: TrackingMode }
  branch: { id: string; code: string }
  onHand: number
  reserved: number
  available: number
  inTransit: number
  reorderLevel: number
  lowStock: boolean
}

export type PurchaseStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'REJECTED'
  | 'PARTIALLY_RECEIVED'
  | 'RECEIVED'
  | 'CANCELLED'
  | 'CLOSED'

export interface PurchaseItem {
  id: string
  lineNumber: number
  productId: string
  sku: string
  productName: string
  trackingMode: TrackingMode
  identifierType: IdentifierType | null
  identifiersPerUnit: number | null
  quantityOrdered: number
  quantityReceived: number
}

export interface Purchase {
  id: string
  reference: string
  status: PurchaseStatus
  branch: { id: string; code: string; name: string }
  supplier: { id: string; name: string }
  items: PurchaseItem[]
  createdAt: string
}

export interface GoodsReceipt {
  id: string
  reference: string
  purchase: { id: string; reference?: string; status: PurchaseStatus }
  items: {
    productId?: string
    sku?: string
    quantity: number
    units?: { id: string; identifiers: Identifier[] }[]
  }[]
}

export interface TaxCurrent {
  configured: boolean
  name?: string
  ratePercent?: string
  effectiveFrom?: string
  setBy?: { id: string; fullName: string } | null
}

export interface UserRecord {
  id: string
  email: string
  fullName: string
  isActive: boolean
  isLocked: boolean
  lastLoginAt: string | null
  createdAt: string
  role: { key: RoleKey; name: string }
  branches: { id: string; code: string; name: string }[]
}

export interface RoleRecord {
  id: string
  key: RoleKey
  name: string
  description: string
  maxBranches: number | null
  permissions: string[]
}

export interface Named {
  id: string
  name: string
  description?: string | null
  isActive: boolean
}

export interface Product {
  id: string
  sku: string
  name: string
  description: string | null
  category: { id: string; name: string }
  brand: { id: string; name: string }
  trackingMode: TrackingMode
  identifierType: IdentifierType | null
  identifiersPerUnit: number | null
  costPrice?: string
  sellingPrice: string
  currency: string
  reorderLevel: number
  isActive: boolean
}

export interface Supplier {
  id: string
  name: string
  contactPerson: string | null
  phone: string | null
  email: string | null
  address: string | null
  tin: string | null
  notes: string | null
  isActive: boolean
}

export interface Customer {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  isActive: boolean
}

export interface PurchaseDetail extends Purchase {
  currency: string
  subtotal: string
  supplierReference: string | null
  expectedDeliveryDate: string | null
  notes: string | null
  items: (PurchaseItem & { unitCost?: string; lineTotal?: string })[]
  createdBy: { id: string; fullName: string } | null
  submittedBy: { id: string; fullName: string } | null
  submittedAt: string | null
  approvedBy: { id: string; fullName: string } | null
  approvedAt: string | null
  approvalNote: string | null
  rejectedBy: { id: string; fullName: string } | null
  rejectionReason?: string | null
  cancelledBy?: { id: string; fullName: string } | null
  cancellationReason?: string | null
}

export interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string | null
  branchId: string | null
  metadata: Record<string, unknown> | null
  requestId: string | null
  createdAt: string
  actor: { id: string; email: string; fullName: string } | null
}

export interface Movement {
  id: string
  createdAt: string
  movementType: string
  productId: string
  sku: string
  branchId: string
  branchCode: string
  quantityDelta: number
  unitCost?: string
  valueDelta?: string
  productUnitId: string | null
  referenceType: string
  referenceId: string
  actor: { id: string; fullName: string } | null
}

export interface UnitRecord {
  id: string
  status: string
  product: { id: string; sku: string; name: string }
  branch: { id: string; code: string }
  identifiers: Identifier[]
  unitCost?: string
  createdAt: string
}

export interface Valuation {
  method: string
  currency: string
  lines: { branch: { id: string; code: string }; product: { id: string; sku: string }; onHand: number; averageCost: string; value: string }[]
  totals: { onHandValue: string; inTransitValue: string; totalValue: string }
}
