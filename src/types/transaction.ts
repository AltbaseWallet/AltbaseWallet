export type TransactionType = 'incoming' | 'outgoing'
export type TransactionStatus = 'pending' | 'confirmed' | 'failed'

export type Transaction = {
  id: string
  coinId: string
  type: TransactionType
  amount: string
  fee?: string
  status: TransactionStatus
  txHash: string
  from?: string
  to?: string
  internal?: boolean
  spent?: boolean
  createdAt: string
  confirmations?: number
  blockHeight?: number
  spentOutpoints?: Array<{ txid: string; vout: number; satoshis?: number }>
  balanceBefore?: string
  expectedBalanceAfter?: string
}

export type SendPayload = {
  coinId: string
  to: string
  amount: string
  fee?: string
  comment?: string
  sendMax?: boolean
}
