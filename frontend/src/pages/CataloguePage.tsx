import { useState, type FormEvent } from 'react'
import { ApiError } from '../api/client.ts'
import type { Named, Product } from '../api/types.ts'
import { api } from '../app/api.ts'
import { useSession } from '../app/session-context.ts'
import { Alert, Empty, ErrorAlert, Field, Modal, Money, PageHeader, Pager, Spinner, StatusBadge, Tabs } from '../components/ui.tsx'
import { useApi, useDebounced } from '../lib/hooks.ts'
import { isMoney } from '../lib/money.ts'
import { hasPermission } from '../lib/permissions.ts'

type Tab = 'products' | 'categories' | 'brands'

/**
 * Product catalogue (Module 3, D5 field-level rules enforced by the server):
 * - catalogue:write  → create products; edit name, category, brand, reorder level, status
 * - catalogue:price  → change selling/cost price after creation (manager)
 * - catalogue:cost_read → cost price is visible at all (never to cashiers/technicians)
 */
export function CataloguePage() {
  const [tab, setTab] = useState<Tab>('products')
  return (
    <>
      <PageHeader title="Products" subtitle="Catalogue, categories and brands" />
      <Tabs
        tabs={[
          { key: 'products', label: 'Products' },
          { key: 'categories', label: 'Categories' },
          { key: 'brands', label: 'Brands' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'products' && <ProductsTab />}
      {tab === 'categories' && <ClassificationTab kind="categories" />}
      {tab === 'brands' && <ClassificationTab kind="brands" />}
    </>
  )
}

function ProductsTab() {
  const { user } = useSession()
  const canWrite = hasPermission(user, 'catalogue:write')
  const canPrice = hasPermission(user, 'catalogue:price')
  const seeCost = hasPermission(user, 'catalogue:cost_read')
  const [q, setQ] = useState('')
  const [active, setActive] = useState('true')
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const list = useApi<Product[]>('/products', {
    q: query.trim() || undefined,
    isActive: active || undefined,
    page,
    limit: 25,
  })
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <>
      <div className="toolbar">
        <input
          type="search"
          placeholder="Search name, SKU, brand or category"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          aria-label="Search products"
          data-testid="product-search"
        />
        <select
          value={active}
          onChange={(e) => {
            setActive(e.target.value)
            setPage(1)
          }}
          aria-label="Status"
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
          <option value="">All</option>
        </select>
        {canWrite && (
          <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid="product-new">
            New product
          </button>
        )}
      </div>
      {notice && <Alert kind="success" testId="product-notice">{notice}</Alert>}
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>No products match.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table" data-testid="products-table">
            <thead>
              <tr>
                <th>SKU</th>
                <th>Name</th>
                <th>Category</th>
                <th>Brand</th>
                <th>Tracking</th>
                {seeCost && <th className="num">Cost</th>}
                <th className="num">Selling (excl. VAT)</th>
                <th className="num">Reorder at</th>
                <th>Status</th>
                {(canWrite || canPrice) && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.sku}</td>
                  <td>{p.name}</td>
                  <td>{p.category.name}</td>
                  <td>{p.brand.name}</td>
                  <td>{p.trackingMode === 'SERIALIZED' ? `${p.identifierType} ×${p.identifiersPerUnit}` : 'Quantity'}</td>
                  {seeCost && (
                    <td className="num">
                      <Money value={p.costPrice} />
                    </td>
                  )}
                  <td className="num">
                    <Money value={p.sellingPrice} />
                  </td>
                  <td className="num">{p.reorderLevel}</td>
                  <td>
                    <StatusBadge active={p.isActive} />
                  </td>
                  {(canWrite || canPrice) && (
                    <td>
                      <button className="btn btn-small" onClick={() => setEditing(p)} data-testid={`product-edit-${p.sku}`}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
      {editing && (
        <ProductForm
          product={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null)
            setNotice(text)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: (t: string) => void }) {
  const { user } = useSession()
  const canWrite = hasPermission(user, 'catalogue:write')
  const canPrice = hasPermission(user, 'catalogue:price')
  const seeCost = hasPermission(user, 'catalogue:cost_read')
  const categories = useApi<Named[]>('/categories', { isActive: true, limit: 100 })
  const brands = useApi<Named[]>('/brands', { isActive: true, limit: 100 })
  const creating = !product
  // Ordinary fields: catalogue:write. Prices: anyone may set them at creation; afterwards catalogue:price only.
  const editDetails = creating || canWrite
  const editPrices = creating || canPrice
  const [f, setF] = useState({
    sku: product?.sku ?? '',
    name: product?.name ?? '',
    description: product?.description ?? '',
    categoryId: product?.category.id ?? '',
    brandId: product?.brand.id ?? '',
    trackingMode: product?.trackingMode ?? 'QUANTITY',
    identifierType: product?.identifierType ?? 'IMEI',
    identifiersPerUnit: String(product?.identifiersPerUnit ?? 1),
    costPrice: product?.costPrice ?? '',
    sellingPrice: product?.sellingPrice ?? '',
    reorderLevel: String(product?.reorderLevel ?? 0),
    isActive: product?.isActive ?? true,
  })
  const [error, setError] = useState<unknown>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fe = (k: string) => (error instanceof ApiError ? error.fieldMessages(k) : [])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setFormError(null)
    if (editPrices && (!isMoney(f.sellingPrice) || (seeCost && !isMoney(f.costPrice)))) {
      setFormError('Prices must be amounts such as 1750000 or 1750000.50.')
      return
    }
    setBusy(true)
    try {
      if (creating) {
        await api.post('/products', {
          sku: f.sku.trim().toUpperCase(),
          name: f.name.trim(),
          description: f.description.trim() || undefined,
          categoryId: f.categoryId,
          brandId: f.brandId,
          trackingMode: f.trackingMode,
          ...(f.trackingMode === 'SERIALIZED'
            ? { identifierType: f.identifierType, identifiersPerUnit: Number(f.identifiersPerUnit) }
            : {}),
          costPrice: f.costPrice.trim(),
          sellingPrice: f.sellingPrice.trim(),
          reorderLevel: Number(f.reorderLevel) || 0,
        })
        onSaved(`${f.sku.trim().toUpperCase()} created.`)
      } else {
        // Send only fields that changed AND that this role may change.
        const body: Record<string, unknown> = {}
        if (canWrite) {
          if (f.name.trim() !== product.name) body.name = f.name.trim()
          if ((f.description.trim() || null) !== (product.description ?? null)) body.description = f.description.trim() || null
          if (f.categoryId !== product.category.id) body.categoryId = f.categoryId
          if (f.brandId !== product.brand.id) body.brandId = f.brandId
          if (Number(f.reorderLevel) !== product.reorderLevel) body.reorderLevel = Number(f.reorderLevel)
          if (f.isActive !== product.isActive) body.isActive = f.isActive
        }
        if (canPrice) {
          if (f.sellingPrice.trim() !== product.sellingPrice) body.sellingPrice = f.sellingPrice.trim()
          if (seeCost && product.costPrice !== undefined && f.costPrice.trim() !== product.costPrice) body.costPrice = f.costPrice.trim()
        }
        if (Object.keys(body).length === 0) {
          onSaved('Nothing changed.')
          return
        }
        await api.request('PATCH', `/products/${product.id}`, { body })
        onSaved(`${product.sku} updated.`)
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={product ? `Edit ${product.sku}` : 'New product'} onClose={onClose} testId="product-form" wide>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">
          <Field label="SKU" hint="Upper case letters, digits, . _ -; permanent" error={fe('sku')}>
            <input value={f.sku} disabled={!creating} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} data-testid="pf-sku" />
          </Field>
          <Field label="Name" error={fe('name')}>
            <input value={f.name} disabled={!editDetails} onChange={set('name')} data-testid="pf-name" />
          </Field>
          <Field label="Category" error={fe('categoryId')}>
            <select value={f.categoryId} disabled={!editDetails} onChange={set('categoryId')} data-testid="pf-category">
              <option value="">Choose…</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
              {product && !categories.data?.some((c) => c.id === product.category.id) && (
                <option value={product.category.id}>{product.category.name}</option>
              )}
            </select>
          </Field>
          <Field label="Brand" error={fe('brandId')}>
            <select value={f.brandId} disabled={!editDetails} onChange={set('brandId')} data-testid="pf-brand">
              <option value="">Choose…</option>
              {brands.data?.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
              {product && !brands.data?.some((b) => b.id === product.brand.id) && (
                <option value={product.brand.id}>{product.brand.name}</option>
              )}
            </select>
          </Field>
          <Field label="Tracking" hint="Permanent after creation" error={fe('trackingMode')}>
            <select value={f.trackingMode} disabled={!creating} onChange={set('trackingMode')} data-testid="pf-tracking">
              <option value="QUANTITY">By quantity (accessories)</option>
              <option value="SERIALIZED">Individual devices (IMEI / serial)</option>
            </select>
          </Field>
          {f.trackingMode === 'SERIALIZED' && (
            <>
              <Field label="Identifier" error={fe('identifierType')}>
                <select value={f.identifierType} disabled={!creating} onChange={set('identifierType')} data-testid="pf-ident">
                  <option value="IMEI">IMEI (phones)</option>
                  <option value="SERIAL">Serial number</option>
                </select>
              </Field>
              <Field label="Identifiers per device" hint="2 for dual-SIM phones" error={fe('identifiersPerUnit')}>
                <select value={f.identifiersPerUnit} disabled={!creating} onChange={set('identifiersPerUnit')}>
                  <option value="1">1</option>
                  <option value="2">2</option>
                </select>
              </Field>
            </>
          )}
          {(creating || seeCost) && (
            <Field label="Cost price (TZS, excl. VAT)" error={fe('costPrice')}>
              <input value={f.costPrice} inputMode="decimal" disabled={!editPrices} onChange={set('costPrice')} data-testid="pf-cost" />
            </Field>
          )}
          <Field label="Selling price (TZS, excl. VAT)" error={fe('sellingPrice')}>
            <input value={f.sellingPrice} inputMode="decimal" disabled={!editPrices} onChange={set('sellingPrice')} data-testid="pf-price" />
          </Field>
          <Field label="Reorder level" error={fe('reorderLevel')}>
            <input type="number" min={0} value={f.reorderLevel} disabled={!editDetails} onChange={set('reorderLevel')} />
          </Field>
          <Field label="Description (optional)" error={fe('description')}>
            <input value={f.description} maxLength={2000} disabled={!editDetails} onChange={set('description')} />
          </Field>
        </div>
        {product && canWrite && (
          <label className="check">
            <input type="checkbox" checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} />
            Active (inactive products cannot be sold or ordered)
          </label>
        )}
        {product && !canPrice && <p className="muted small">Price changes after creation are made by a manager.</p>}
        {product && !canWrite && <p className="muted small">You can change prices only.</p>}
        {formError && <Alert kind="error">{formError}</Alert>}
        <ErrorAlert error={error} testId="pf-error" />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid="pf-save">
            {busy ? 'Saving…' : 'Save product'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}

function ClassificationTab({ kind }: { kind: 'categories' | 'brands' }) {
  const { user } = useSession()
  const canWrite = hasPermission(user, 'catalogue:write')
  const [page, setPage] = useState(1)
  const list = useApi<Named[]>(`/${kind}`, { page, limit: 50 })
  const [editing, setEditing] = useState<Named | 'new' | null>(null)
  const label = kind === 'categories' ? 'category' : 'brand'

  return (
    <>
      {canWrite && (
        <div className="toolbar">
          <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid={`${label}-new`}>
            New {label}
          </button>
        </div>
      )}
      <ErrorAlert error={list.error} />
      {list.loading && !list.data && <Spinner />}
      {list.data && list.data.length === 0 && <Empty>None yet.</Empty>}
      {list.data && list.data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                {kind === 'categories' && <th>Description</th>}
                <th>Status</th>
                {canWrite && <th />}
              </tr>
            </thead>
            <tbody>
              {list.data.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  {kind === 'categories' && <td>{c.description ?? '—'}</td>}
                  <td>
                    <StatusBadge active={c.isActive} />
                  </td>
                  {canWrite && (
                    <td>
                      <button className="btn btn-small" onClick={() => setEditing(c)}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager pagination={list.pagination} page={page} onPage={setPage} />
      {editing && (
        <NamedForm
          kind={kind}
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            list.reload()
          }}
        />
      )}
    </>
  )
}

function NamedForm({
  kind,
  item,
  onClose,
  onSaved,
}: {
  kind: 'categories' | 'brands'
  item?: Named
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item?.name ?? '')
  const [description, setDescription] = useState(item?.description ?? '')
  const [isActive, setIsActive] = useState(item?.isActive ?? true)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const label = kind === 'categories' ? 'category' : 'brand'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body: Record<string, unknown> = { name: name.trim() }
      if (kind === 'categories') body.description = description.trim() || (item ? null : undefined)
      if (item) {
        body.isActive = isActive
        await api.request('PATCH', `/${kind}/${item.id}`, { body })
      } else await api.post(`/${kind}`, body)
      onSaved()
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={item ? `Edit ${label}` : `New ${label}`} onClose={onClose} testId={`${label}-form`}>
      <form className="stack" onSubmit={submit} noValidate>
        <Field label="Name">
          <input value={name} maxLength={100} onChange={(e) => setName(e.target.value)} data-testid={`${label}-name`} />
        </Field>
        {kind === 'categories' && (
          <Field label="Description (optional)">
            <input value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        )}
        {item && (
          <label className="check">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            Active
          </label>
        )}
        <ErrorAlert error={error} />
        <div className="form-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} data-testid={`${label}-save`}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={onClose}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  )
}
