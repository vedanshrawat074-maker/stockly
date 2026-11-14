export function isClothingAnalyticsRoute(shopType: string | undefined, pathname: string): boolean {
  return shopType === "clothing" && pathname !== "/forecasts";
}
