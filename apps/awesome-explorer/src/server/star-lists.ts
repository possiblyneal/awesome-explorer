// The operator's star lists: the named groups GitHub lets a user sort starred
// repositories into. GitHub answers 32 lists of up to 100 repositories each
// with a 502, so lists are read LIST_PAGE at a time, and a list holding more
// than ITEM_PAGE repositories is read on by its node id.

import { graphqlData, type GitHub } from "./github.ts";

const LIST_PAGE = 10;
const ITEM_PAGE = 100;

interface Page<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: (T | null)[];
}

type Items = Page<{ nameWithOwner?: string }>;

interface RawList {
  id: string;
  name: string;
  items: Items;
}

const ITEMS = `pageInfo { hasNextPage endCursor } nodes { ... on Repository { nameWithOwner } }`;

const LISTS = `
query($after: String) {
  viewer {
    lists(first: ${LIST_PAGE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { id name items(first: ${ITEM_PAGE}) { ${ITEMS} } }
    }
  }
}`;

const MORE_ITEMS = `
query($id: ID!, $after: String) {
  node(id: $id) { ... on UserList { items(first: ${ITEM_PAGE}, after: $after) { ${ITEMS} } } }
}`;

/** Lowercased `owner/name` to the names of the star lists holding it. */
export async function fetchStarLists(
  github: Pick<GitHub, "graphql">,
): Promise<Map<string, string[]>> {
  const byRepo = new Map<string, string[]>();
  let after: string | null = null;
  do {
    const data: { viewer: { lists: Page<RawList> } } = await graphqlData(
      github,
      LISTS,
      { after },
    );
    const lists = data.viewer.lists;
    for (const list of lists.nodes) {
      if (!list) continue;
      let items = list.items;
      for (;;) {
        for (const item of items.nodes) {
          if (!item?.nameWithOwner) continue;
          const key = item.nameWithOwner.toLowerCase();
          byRepo.set(key, [...(byRepo.get(key) ?? []), list.name]);
        }
        if (!items.pageInfo.hasNextPage) break;
        const more: { node: { items: Items } } = await graphqlData(
          github,
          MORE_ITEMS,
          { id: list.id, after: items.pageInfo.endCursor },
        );
        items = more.node.items;
      }
    }
    after = lists.pageInfo.hasNextPage ? lists.pageInfo.endCursor : null;
  } while (after);
  return byRepo;
}
