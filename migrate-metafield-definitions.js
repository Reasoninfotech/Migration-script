import { CONFIG } from "./config.js";
import { shopifyRequest } from "./api.js";

async function getDefinitions(shop, token) {
  const query = `
    query {
      metafieldDefinitions(first: 100, ownerType: PRODUCT) {
        edges {
          node {
            name
            namespace
            key
            description
            type {
              name
            }
          }
        }
      }
    }
  `;
  try {
    const res = await shopifyRequest(shop, token, query);
    return (res.metafieldDefinitions?.edges || []).map(e => e.node);
  } catch (err) {
    console.error(`Error fetching product definitions from ${shop}:`, err.message);
    throw err;
  }
}

async function createDefinition(shop, token, definition) {
  const mutation = `
    mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition {
          id
          name
          namespace
          key
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    definition: {
      name: definition.name,
      namespace: definition.namespace,
      key: definition.key,
      description: definition.description,
      type: definition.type.name,
      ownerType: "PRODUCT"
    }
  };

  try {
    const res = await shopifyRequest(shop, token, mutation, variables);
    const result = res.metafieldDefinitionCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating metafield definition '${definition.namespace}.${definition.key}' on ${shop}:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }

    console.log(`✅ Metafield Definition '${result.createdDefinition.name}' (${result.createdDefinition.namespace}.${result.createdDefinition.key}) created successfully on ${shop}.`);
    return result.createdDefinition;
  } catch (err) {
    console.error(`❌ Request error creating metafield definition '${definition.namespace}.${definition.key}' on ${shop}:`, err.message);
    return null;
  }
}

export async function run() {
  const { source, target } = CONFIG;

  console.log("=== STEP 1.5: Migrating Product Metafield Definitions ===");

  // 1. Fetch from source
  const sourceDefs = await getDefinitions(source.shop, source.accessToken);
  if (sourceDefs.length === 0) {
    console.log("No product metafield definitions found on source store.");
    return;
  }

  // 2. Fetch from target to avoid duplicates
  let targetDefs = [];
  try {
    targetDefs = await getDefinitions(target.shop, target.accessToken);
  } catch (err) {
    console.log("Could not fetch target product metafield definitions. Proceeding...");
  }

  const targetKeys = new Set(targetDefs.map(d => `${d.namespace}.${d.key}`));

  // 3. Migrate definitions that don't exist in target
  for (const sourceDef of sourceDefs) {
    const fullKey = `${sourceDef.namespace}.${sourceDef.key}`;
    if (targetKeys.has(fullKey)) {
      console.log(`⏭️ Product Metafield Definition for '${fullKey}' already exists on target store. Skipping.`);
      continue;
    }

    // Skip Shopify system reserved namespaces to avoid Access Denied errors
    if (sourceDef.namespace === "shopify" || sourceDef.namespace.startsWith("shopify")) {
      console.log(`⏭️ Skipping reserved Shopify system namespace for definition '${fullKey}'.`);
      continue;
    }

    console.log(`Creating product metafield definition for '${fullKey}'...`);
    await createDefinition(target.shop, target.accessToken, sourceDef);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("=== Product Metafield Definitions Migration Complete ===\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('migrate-metafield-definitions.js')) {
  run().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
