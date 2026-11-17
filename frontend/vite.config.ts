import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type HtmlTagDescriptor, type Plugin } from 'vite'

/**
 * The API is reached through a same-origin proxy (`/api` → backend), as
 * Caddy does in production. The refresh cookie is SameSite=Strict and
 * scoped to /api/v1/auth, so the browser must see one origin.
 * VITE_API_PROXY overrides the target (e.g. the test backend on :3100).
 */
const target = process.env.VITE_API_PROXY || 'https://electronics-businness-management-system-syhf-4e4oweewp.vercel.app'

/**
 * Social-sharing metadata that needs the public origin (canonical URL,
 * og:url, og:image, twitter:image). Crawlers require ABSOLUTE https URLs,
 * so they come from VITE_SITE_URL (e.g. https://your-domain) at build time.
 * Without it the build still succeeds (local/dev/test) with a relative
 * image path and no canonical/og:url, and a warning is printed.
 */
function siteMetadata(siteUrl: string | undefined): Plugin {
  let base: string | null = null
  if (siteUrl) {
    const u = new URL(siteUrl)
    if (u.protocol !== 'https:') throw new Error(`VITE_SITE_URL must be an https:// URL (got ${u.protocol})`)
    if (u.search || u.hash) throw new Error('VITE_SITE_URL must not contain a query or fragment')
    base = `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  }
  return {
    name: 'ebms-site-metadata',
    configResolved(config) {
      if (!base && config.command === 'build') {
        config.logger.warn(
          '\n[ebms-site-metadata] VITE_SITE_URL is not set: canonical/og:url are omitted and the share image is relative.\n' +
            '  Social previews (WhatsApp, Facebook, LinkedIn, Telegram) need it. Build with e.g.\n' +
            '  VITE_SITE_URL=https://<your-domain> npm run build\n',
        )
      }
    },
    transformIndexHtml() {
      const image = base ? `${base}/og-thumbnail.png` : '/og-thumbnail.png'
      const page = base ? `${base}/` : null
      const tags: HtmlTagDescriptor[] = [
        { tag: 'meta', attrs: { property: 'og:image', content: image }, injectTo: 'head' },
        { tag: 'meta', attrs: { name: 'twitter:image', content: image }, injectTo: 'head' },
      ]
      if (base) tags.push({ tag: 'meta', attrs: { property: 'og:image:secure_url', content: image }, injectTo: 'head' })
      if (page) {
        tags.push(
          { tag: 'link', attrs: { rel: 'canonical', href: page }, injectTo: 'head' },
          { tag: 'meta', attrs: { property: 'og:url', content: page }, injectTo: 'head' },
        )
      }
      return tags
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), siteMetadata(process.env.VITE_SITE_URL || env.VITE_SITE_URL || undefined)],
    server: {
      proxy: { '/api': { target, changeOrigin: false } },
    },
    preview: {
      proxy: { '/api': { target, changeOrigin: false } },
    },
  }
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': { target, changeOrigin: false } },
  },
  preview: {
    proxy: { '/api': { target, changeOrigin: false } },
  },
})
