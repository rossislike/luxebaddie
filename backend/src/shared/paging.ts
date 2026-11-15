/** Which page of a list to read. `cursor` comes from the previous page's `nextCursor`. */
export type PageRequest = {
  limit: number;
  cursor?: string;
};
