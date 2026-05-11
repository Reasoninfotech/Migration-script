import { CONFIG } from "./config.js";
import { shopifyRequest, fetchPaginated } from "./api.js";
import { loadMappings, saveMappings } from "./migrate-metaobjects.js";

async function getCollections(shop, token) {
  const queryStr = `
    id
    title
    descriptionHtml
    handle
    sortOrder
    ruleSet {
      appliedDisjunctively
      rules {
        column
        relation
        condition
      }
    }
    products(first: 100) {
      edges {
        node {
          id
        }
      }
    }
  `;

  console.log(`Fetching Collections from ${shop}...`);
  try {
    const collections = await fetchPaginated(shop, token, "collections", queryStr);
    console.log(`Successfully fetched ${collections.length} collections from ${shop}.`);
    return collections;
  } catch (err) {
    console.error(`Error fetching collections from ${shop}:`, err.message);
    throw err;
  }
}

async function createCollection(shop, token, collectionInput) {
  const mutation = `
    mutation CreateCollection($input: CollectionInput!) {
      collectionCreate(input: $input) {
        collection {
          id
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(shop, token, mutation, { input: collectionInput });
    const result = res.collectionCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating collection '${collectionInput.title}':`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }

    return result.collection;
  } catch (err) {
    console.error(`❌ Request error creating collection '${collectionInput.title}':`, err.message);
    return null;
  }
}

async function addProductsToCollection(shop, token, collectionId, productIds) {
  const mutation = `
    mutation CollectionAddProducts($id: ID!, $productIds: [ID!]!) {
      collectionAddProducts(id: $id, productIds: $productIds) {
        collection {
          id
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(shop, token, mutation, { id: collectionId, productIds });
    const result = res.collectionAddProducts;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors adding products to collection '${collectionId}':`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return false;
    }

    return true;
  } catch (err) {
    console.error(`❌ Request error adding products to collection '${collectionId}':`, err.message);
    return false;
  }
}

async function findCollectionOnTarget(shop, token, handle) {
  const query = `
    query FindCollection($handle: String!) {
      collectionByHandle(handle: $handle) {
        id
      }
    }
  `;
  try {
    const res = await shopifyRequest(shop, token, query, { handle });
    return res.collectionByHandle ? res.collectionByHandle.id : null;
  } catch (err) {
    return null;
  }
}

export async function run() {
  const { source, target } = CONFIG;
  const mappings = loadMappings();

  console.log("=== STEP 4: Migrating Collections ===");

  const sourceCollections = await getCollections(source.shop, source.accessToken);
  if (sourceCollections.length === 0) {
    console.log("No collections found on source store.");
    return;
  }

  for (const item of sourceCollections) {
    const sourceCollectionId = item.id;

    // Check if we already mapped this collection
    if (mappings[sourceCollectionId]) {
      console.log(`⏭️ Collection '${item.title}' (${item.handle}) already migrated. Skipping.`);
      continue;
    }

    // Check if collection exists on target store by handle
    let targetCollectionId = await findCollectionOnTarget(target.shop, target.accessToken, item.handle);

    if (!targetCollectionId) {
      console.log(`Creating collection '${item.title}'...`);

      // 1. Build CollectionInput
      const collectionInput = {
        title: item.title,
        descriptionHtml: item.descriptionHtml,
        handle: item.handle,
        sortOrder: item.sortOrder
      };

      // 2. Add ruleSet if it is an automated collection
      if (item.ruleSet) {
        collectionInput.ruleSet = {
          appliedDisjunctively: item.ruleSet.appliedDisjunctively,
          rules: item.ruleSet.rules.map(r => ({
            column: r.column,
            relation: r.relation,
            condition: r.condition
          }))
        };
      }

      // 3. Create collection on target
      const createdCollection = await createCollection(target.shop, target.accessToken, collectionInput);
      if (createdCollection) {
        console.log(`✅ Created collection on target: ${createdCollection.id}`);
        targetCollectionId = createdCollection.id;
        mappings[sourceCollectionId] = targetCollectionId;
        saveMappings(mappings);
      }
    } else {
      console.log(`🔗 Collection '${item.title}' already exists on target. Recording ID mapping.`);
      mappings[sourceCollectionId] = targetCollectionId;
      saveMappings(mappings);
    }

    // 4. For manual collections, map and add products
    if (targetCollectionId && !item.ruleSet) {
      const sourceProductIds = item.products.edges.map(e => e.node.id);
      if (sourceProductIds.length > 0) {
        console.log(`Mapping and adding products for manual collection '${item.title}'...`);
        const targetProductIds = sourceProductIds
          .map(sid => mappings[sid])
          .filter(Boolean); // Only include product IDs that successfully migrated

        if (targetProductIds.length > 0) {
          const success = await addProductsToCollection(target.shop, target.accessToken, targetCollectionId, targetProductIds);
          if (success) {
            console.log(`✅ Added ${targetProductIds.length} products to manual collection '${item.title}'.`);
          }
        } else {
          console.log(`⚠️ No migrated products found for manual collection '${item.title}'.`);
        }
      }
    }

    // Be friendly to API limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("=== Collections Migration Complete ===\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('migrate-collections.js')) {
  run().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
