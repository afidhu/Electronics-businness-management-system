import { ApiClient } from '../api/client.ts'

/** One client per tab; the access token never leaves this object (memory only). */
export const api = new ApiClient('/api/v1')
