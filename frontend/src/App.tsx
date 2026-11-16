import { useEffect } from 'react'
import { useSession } from './app/session-context.ts'
import { Layout } from './components/Layout.tsx'
import { Alert, Spinner } from './components/ui.tsx'
import { DashboardPage } from './pages/DashboardPage.tsx'
import { InventoryPage } from './pages/InventoryPage.tsx'
import { LoginPage } from './pages/LoginPage.tsx'
import { PosPage } from './pages/PosPage.tsx'
import { ReceiptPage } from './pages/ReceiptPage.tsx'
import { ReceiveOrderPage, ReceivingListPage } from './pages/ReceivingPage.tsx'
import { SalesPage, SummaryPage } from './pages/SalesPage.tsx'
import { VatSettingsPage } from './pages/VatSettingsPage.tsx'
import { canOpen } from './lib/permissions.ts'
import { matchPath, navigate, useRoute, type Route } from './lib/router.ts'

function Page({ route }: { route: Route }) {
  const { path, query } = route
  let params: Record<string, string> | null
  if (path === '/dashboard') return <DashboardPage />
  if (path === '/pos') return <PosPage />
  if (path === '/sales') return <SalesPage />
  if (path === '/summary') return <SummaryPage />
  if (path === '/inventory') return <InventoryPage initialLowStock={query.get('lowStock') === '1'} />
  if (path === '/receiving') return <ReceivingListPage />
  if ((params = matchPath('/receiving/:id', path))) return <ReceiveOrderPage purchaseId={params.id} key={params.id} />
  if ((params = matchPath('/sales/:id/receipt', path))) {
    return <ReceiptPage saleId={params.id} isNew={query.get('new') === '1'} key={params.id} />
  }
  if (path === '/settings/vat') return <VatSettingsPage />
  return <Alert kind="info">Page not found. <a href="#/dashboard">Go to the dashboard</a>.</Alert>
}

export default function App() {
  const { status, user, branches, branch, setBranchId, logout } = useSession()
  const route = useRoute()

  useEffect(() => {
    if (status === 'authenticated' && (route.path === '/' || route.path === '/login')) {
      navigate('/dashboard')
    }
  }, [status, route.path])

  if (status === 'loading') {
    return (
      <div className="splash">
        <Spinner label="Starting ElectroCore…" />
      </div>
    )
  }
  if (status === 'anonymous' || !user) {
    const next = route.path === '/' || route.path === '/login' ? undefined : route.path
    return <LoginPage next={next} />
  }

  return (
    <Layout
      user={user}
      path={route.path}
      branches={branches}
      branch={branch}
      onBranch={setBranchId}
      onLogout={() => void logout()}
    >
      {canOpen(user, route.path) ? (
        <Page route={route} />
      ) : (
        <Alert kind="error" testId="forbidden">
          Your role does not have access to this page. <a href="#/dashboard">Back to the dashboard</a>.
        </Alert>
      )}
    </Layout>
  )
}
