export interface ShopeeOrderRaw {
  orderSn: string;
  orderStatus: string;
  createdAtShopee?: string;
  productName: string;
  sku?: string;
  quantity: number;
  totalAmount: number;
  shippingCarrier?: string;
  shippingStatus?: string;
}

export interface ShopeeOrderRecord extends ShopeeOrderRaw {
  id?: string;
  syncedAt?: Date;
}

export interface SyncOptions {
  maxPages?: number;
  delayMinMs?: number;
  delayMaxMs?: number;
  searchQuery?: string;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  errorCount: number;
  message?: string;
}

export interface AuthStatus {
  isLoggedIn: boolean;
  username?: string;
  errorMessage?: string;
}
