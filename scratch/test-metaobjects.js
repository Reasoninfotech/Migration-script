import { CONFIG } from "../config.js";
import { shopifyRequest } from "../api.js";

async function test() {
  const { source } = CONFIG;
  console.log("Querying source store for metaobjects of type 'trr'...");
  
  const query = `
    query {
      metaobjects(first: 10, type: "trr") {
        edges {
          node {
            id
            handle
            type
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(source.shop, source.accessToken, query);
    console.log("Raw Response for 'trr':", JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  }

  console.log("\nQuerying source store for metaobjects of type 'team_member'...");
  const query2 = `
    query {
      metaobjects(first: 10, type: "team_member") {
        edges {
          node {
            id
            handle
            type
            fields {
              key
              value
            }
          }
        }
      }
    }
  `;

  try {
    const res2 = await shopifyRequest(source.shop, source.accessToken, query2);
    console.log("Raw Response for 'team_member':", JSON.stringify(res2, null, 2));
  } catch (err) {
    console.error("Error:", err.message);
  }
}

test();
