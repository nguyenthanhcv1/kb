import {
  createPageAction,
  listChildPagesAction,
  movePageAction,
  type PageActionResult,
  renamePageAction,
  trashPageAction,
} from "@/server/pages/actions";
import type {
  CreatePageInput,
  ListChildPagesInput,
  MovePageInput,
  PageIdInput,
  PageSummary,
  PageTreeNode,
  RenamePageInput,
} from "@/server/pages";

/**
 * What the tree needs from the server — the T2.2 Server Actions by default; tests and previews
 * pass an in-memory implementation.
 */
export type PageTreeApi = {
  listChildren(input: ListChildPagesInput): Promise<PageActionResult<PageTreeNode[]>>;
  create(input: CreatePageInput): Promise<PageActionResult<PageSummary>>;
  rename(input: RenamePageInput): Promise<PageActionResult<PageSummary>>;
  move(input: MovePageInput): Promise<PageActionResult<PageSummary>>;
  trash(input: PageIdInput): Promise<PageActionResult<PageSummary>>;
};

export const serverPageTreeApi: PageTreeApi = {
  listChildren: listChildPagesAction,
  create: createPageAction,
  rename: renamePageAction,
  move: movePageAction,
  trash: trashPageAction,
};
