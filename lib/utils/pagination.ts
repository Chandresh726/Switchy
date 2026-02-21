export type PageNumber = number | "ellipsis";

export function getPageNumbers(currentPage: number, totalPages: number): PageNumber[] {
  const pages: PageNumber[] = [];

  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i += 1) {
      pages.push(i);
    }
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push("ellipsis");

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);

    for (let i = start; i <= end; i += 1) {
      pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push("ellipsis");
    pages.push(totalPages);
  }

  return pages;
}