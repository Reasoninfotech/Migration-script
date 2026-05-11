import { CONFIG } from "./config.js";
import https from "https";

/**
 * Lightweight, native HTTPS fetch replacement to bypass Undici's WebAssembly memory allocations on restricted shared hosting
 */
function nativeFetch(url, options) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      method: options.method || "GET",
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      headers: options.headers || {}
    };

    const req = https.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          headers: {
            get: (name) => res.headers[name.toLowerCase()]
          },
          text: async () => data
        });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

/**
 * Generic GraphQL client for Shopify Admin API
 * @param {string} shop - Store myshopify.com URL
 * @param {string} token - Admin API Access Token
 * @param {string} query - GraphQL Query / Mutation
 * @param {object} variables - Variables for the query
 * @param {string} apiVersion - Shopify API version
 */
export async function shopifyRequest(shop, token, query, variables = {}, apiVersion = CONFIG.source.apiVersion) {
  const url = `https://${shop}/admin/api/${apiVersion}/graphql.json`;

  if (!token || token.includes("YOUR_")) {
    throw new Error(`Invalid access token for ${shop}. Please configure config.js with actual tokens.`);
  }

  const response = await nativeFetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": token,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  });

  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse JSON response from ${shop}: ${text}`);
  }

  if (response.status === 429) {
    // Rate limit hit, wait and retry
    const retryAfter = response.headers.get("Retry-After") || 2;
    console.log(`Rate limit hit (429). Waiting ${retryAfter} seconds...`);
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return shopifyRequest(shop, token, query, variables, apiVersion);
  }

  if (json.errors) {
    throw new Error(`Shopify API Errors for ${shop}: ${JSON.stringify(json.errors, null, 2)}`);
  }

  return json.data;
}

/**
 * Fetch all items from a paginated Shopify GraphQL connection
 * @param {string} shop
 * @param {string} token
 * @param {string} connectionName - Name of connection inside root (e.g., 'metaobjectDefinitions', 'products')
 * @param {string} queryStr - Query body inside edges/node
 * @param {object} variables - Initial query variables
 */
export async function fetchPaginated(shop, token, connectionName, queryStr, variables = {}) {
  let allNodes = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const paginatedQuery = `
      query GetPaginated($first: Int!, $after: String) {
        ${connectionName}(first: $first, after: $after) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            cursor
            node {
              ${queryStr}
            }
          }
        }
      }
    `;

    const vars = { ...variables, first: 50, after: cursor };
    const res = await shopifyRequest(shop, token, paginatedQuery, vars);
    const connection = res[connectionName];

    if (!connection) {
      break;
    }

    const nodes = connection.edges.map(e => e.node);
    allNodes = allNodes.concat(nodes);

    hasNextPage = connection.pageInfo.hasNextPage;
    cursor = connection.pageInfo.endCursor;

    if (hasNextPage) {
      // Small sleep to be friendly to API limits (2 requests/sec)
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return allNodes;
}
