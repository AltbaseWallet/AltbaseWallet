export const hasLoadedHistoryPage = (
  itemCount: number,
  currentPage: number,
  pageSize: number,
) => itemCount > Math.max(1, currentPage) * Math.max(1, pageSize)
