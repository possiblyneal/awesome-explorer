import { describe, expect, it } from "vitest";
import type { GraphQLResponse } from "../src/server/github.ts";
import { fetchStarLists } from "../src/server/star-lists.ts";

const page = <T>(nodes: T[], endCursor: string | null = null) => ({
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
  nodes,
});

describe("fetchStarLists", () => {
  it("pages through lists and through a list's items by its id", async () => {
    const calls: Record<string, unknown>[] = [];
    const github = {
      graphql: async <T>(query: string, variables: Record<string, unknown>) => {
        calls.push(variables);
        const data = query.includes("node(id")
          ? { node: { items: page([{ nameWithOwner: "c/three" }]) } }
          : variables.after === null
            ? {
                viewer: {
                  lists: page(
                    [
                      {
                        id: "L1",
                        name: "Tools",
                        items: page(
                          [{ nameWithOwner: "A/One" }, {}],
                          "items-1",
                        ),
                      },
                    ],
                    "lists-1",
                  ),
                },
              }
            : {
                viewer: {
                  lists: page([
                    {
                      id: "L2",
                      name: "Fun",
                      items: page([{ nameWithOwner: "a/one" }]),
                    },
                  ]),
                },
              };
        return { data, errors: [] } as unknown as GraphQLResponse<T>;
      },
    };
    const lists = await fetchStarLists(github);
    expect(Object.fromEntries(lists)).toEqual({
      "a/one": ["Tools", "Fun"],
      "c/three": ["Tools"],
    });
    expect(calls).toEqual([
      { after: null },
      { id: "L1", after: "items-1" },
      { after: "lists-1" },
    ]);
  });

  it("fails on a GraphQL error", async () => {
    const github = {
      graphql: async <T>() =>
        ({
          data: null,
          errors: [{ type: "INTERNAL", message: "boom" }],
        }) as unknown as GraphQLResponse<T>,
    };
    await expect(fetchStarLists(github)).rejects.toThrow("boom");
  });
});
