import { ApiError } from '../api/client.ts'

/** Human message for an API error (with field details and support id). */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const details = e.details.flatMap((d) => d.messages)
    return details.length ? `${e.message}: ${details.join('; ')}` : e.message
  }
  return e instanceof Error ? e.message : 'Something went wrong.'
}

export function todayInDar(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' }).format(new Date())
}

export const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
}
