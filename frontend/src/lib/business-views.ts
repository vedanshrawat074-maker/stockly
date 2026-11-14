export function isClothingAnalyticsRoute(shopType: string | undefined, pathname: string): boolean {
  return shopType === "clothing" && pathname !== "/forecasts";
}

export function isClothingRestockingRoute(shopType: string | undefined): boolean {
  return shopType === "clothing";
}
