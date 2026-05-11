import { CONFIG } from "./config.js";
import { shopifyRequest, fetchPaginated } from "./api.js";
import { loadMappings, saveMappings } from "./migrate-metaobjects.js";

async function getProducts(shop, token) {
  // Query to get products, variants, metafields, and images
  const queryStr = `
    id
    title
    descriptionHtml
    handle
    status
    vendor
    productType
    tags
    options {
      name
      values
    }
    variants(first: 100) {
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          inventoryQuantity
          inventoryPolicy
          inventoryItem {
            tracked
          }
          selectedOptions {
            name
            value
          }
        }
      }
    }
    metafields(first: 100) {
      edges {
        node {
          id
          namespace
          key
          value
          type
        }
      }
    }
    images(first: 50) {
      edges {
        node {
          url
          altText
        }
      }
    }
  `;

  console.log(`Fetching Products from ${shop}...`);
  try {
    const products = await fetchPaginated(shop, token, "products", queryStr);
    console.log(`Successfully fetched ${products.length} products from ${shop}.`);
    return products;
  } catch (err) {
    console.error(`Error fetching products from ${shop}:`, err.message);
    throw err;
  }
}

async function createBaseProduct(shop, token, productInput, mediaInput) {
  const mutation = `
    mutation CreateProduct($input: ProductInput!, $media: [CreateMediaInput!]) {
      productCreate(input: $input, media: $media) {
        product {
          id
          handle
          variants(first: 10) {
            edges {
              node {
                id
                title
              }
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(shop, token, mutation, { input: productInput, media: mediaInput });
    const result = res.productCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating product '${productInput.title}':`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }

    return result.product;
  } catch (err) {
    console.error(`❌ Request error creating product '${productInput.title}':`, err.message);
    return null;
  }
}

async function updateVariant(shop, token, variantId, variantDetails) {
  const mutation = `
    mutation UpdateVariant($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant {
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
    const res = await shopifyRequest(shop, token, mutation, {
      input: {
        id: variantId,
        ...variantDetails
      }
    });
    const result = res.productVariantUpdate;
    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors updating default variant:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`❌ Request error updating variant:`, err.message);
    return false;
  }
}

async function createProductOptions(shop, token, productId, options) {
  const mutation = `
    mutation ProductOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
      productOptionsCreate(productId: $productId, options: $options) {
        product {
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
    const res = await shopifyRequest(shop, token, mutation, { productId, options });
    const result = res.productOptionsCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating product options:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error(`❌ Request error creating product options:`, err.message);
    return false;
  }
}

async function bulkCreateVariants(shop, token, productId, variants) {
  const mutation = `
    mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants {
          id
          title
          sku
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(shop, token, mutation, {
      productId,
      variants,
      strategy: "REMOVE_STANDALONE_VARIANT"
    });
    const result = res.productVariantsBulkCreate;
    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors bulk creating variants:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }
    return result.productVariants;
  } catch (err) {
    console.error(`❌ Request error bulk creating variants:`, err.message);
    return null;
  }
}

async function findProductOnTarget(shop, token, handle) {
  const query = `
    query FindProduct($handle: String!) {
      productByHandle(handle: $handle) {
        id
        variants(first: 100) {
          edges {
            node {
              id
              sku
            }
          }
        }
      }
    }
  `;
  try {
    const res = await shopifyRequest(shop, token, query, { handle });
    return res.productByHandle;
  } catch (err) {
    return null;
  }
}

async function getTargetLocationId(shop, token) {
  const query = `
    query {
      locations(first: 1, query: "active:true") {
        edges {
          node {
            id
          }
        }
      }
    }
  `;
  try {
    const res = await shopifyRequest(shop, token, query);
    return res.locations?.edges?.[0]?.node?.id || null;
  } catch (err) {
    console.error("Error fetching target location ID:", err.message);
    return null;
  }
}

export async function run() {
  const { source, target } = CONFIG;
  const mappings = loadMappings();
  
  const targetLocationId = await getTargetLocationId(target.shop, target.accessToken);
  if (targetLocationId) {
    console.log(`📍 Found target store active Location ID: ${targetLocationId}`);
  } else {
    console.warn(`⚠️ Could not find any active locations on target store. Inventory will not be migrated.`);
  }

  console.log("=== STEP 3: Migrating Products & Metafields ===");

  const sourceProducts = await getProducts(source.shop, source.accessToken);
  if (sourceProducts.length === 0) {
    console.log("No products found on source store.");
    return;
  }

  for (const item of sourceProducts) {
    const sourceProductId = item.id;

    // Check if we already mapped this Product ID
    if (mappings[sourceProductId]) {
      console.log(`⏭️ Product '${item.title}' (${item.handle}) already migrated. Skipping.`);
      continue;
    }

    // Check if product already exists on target store by handle
    const existingTargetProduct = await findProductOnTarget(target.shop, target.accessToken, item.handle);
    if (existingTargetProduct) {
      console.log(`🔗 Product '${item.title}' already exists on target. Recording ID mappings.`);
      mappings[sourceProductId] = existingTargetProduct.id;
      
      // Record variant ID mappings if SKUs match
      const sourceVariants = item.variants.edges.map(e => e.node);
      const targetVariants = existingTargetProduct.variants.edges.map(e => e.node);

      for (const sv of sourceVariants) {
        const tv = targetVariants.find(v => v.sku === sv.sku);
        if (tv) {
          mappings[sv.id] = tv.id;
        }
      }

      saveMappings(mappings);
      continue;
    }

    console.log(`Migrating product '${item.title}'...`);

    // 1. Resolve any mappings inside Metafields (e.g. metaobject references)
    const productMetafields = item.metafields.edges.map(e => {
      const mf = e.node;
      let val = mf.value;

      // Check if value contains GIDs that we mapped (like Metaobject IDs)
      const gidRegex = /gid:\/\/shopify\/[A-Za-z0-9]+\/\d+/g;
      const matches = val.match(gidRegex);
      if (matches) {
        for (const oldGid of matches) {
          if (mappings[oldGid]) {
            console.log(`  🔄 Mapping metafield reference in product: ${oldGid} -> ${mappings[oldGid]}`);
            val = val.replace(oldGid, mappings[oldGid]);
          }
        }
      }

      return {
        namespace: mf.namespace,
        key: mf.key,
        value: val,
        type: mf.type
      };
    });

    // 2. Prepare media/images
    const mediaInput = item.images.edges.map(e => ({
      alt: e.node.altText || "",
      mediaContentType: "IMAGE",
      originalSource: e.node.url
    }));

    // 3. Build ProductInput
    const productInput = {
      title: item.title,
      descriptionHtml: item.descriptionHtml,
      handle: item.handle,
      status: item.status,
      vendor: item.vendor,
      productType: item.productType,
      tags: item.tags,
      metafields: productMetafields
    };

    // 4. Create Product on Target
    const createdProduct = await createBaseProduct(target.shop, target.accessToken, productInput, mediaInput);
    if (createdProduct) {
      const targetProductId = createdProduct.id;
      console.log(`✅ Created base product on target: ${targetProductId}`);
      mappings[sourceProductId] = targetProductId;

      const sourceVariants = item.variants.edges.map(e => e.node);

      // Determine if it is a simple product (only 1 option named "Title" or "Default Title")
      const isSimpleProduct = item.options.length === 1 && 
        (item.options[0].name === "Title" || item.options[0].name === "Default Title" || item.options[0].values.includes("Default Title"));

      if (isSimpleProduct && sourceVariants.length === 1) {
        // Option is simple. We just update the default variant created automatically by Shopify
        const defaultVar = createdProduct.variants.edges[0]?.node;
        if (defaultVar) {
          const sVar = sourceVariants[0];
          console.log(`Updating default variant '${defaultVar.id}' details...`);
          const updated = await updateVariant(target.shop, target.accessToken, defaultVar.id, {
            price: sVar.price,
            compareAtPrice: sVar.compareAtPrice,
            sku: sVar.sku
          });
          if (updated) {
            mappings[sVar.id] = defaultVar.id;
          }
        }
      } else {
        // Complex product with custom options and variants
        // 1. Create Options
        const optionsInput = item.options.map((o, idx) => ({
          name: o.name,
          position: idx + 1,
          values: o.values.map(v => ({ name: v }))
        }));

        console.log(`Creating custom product options for complex product...`);
        const optionsCreated = await createProductOptions(target.shop, target.accessToken, targetProductId, optionsInput);

        if (optionsCreated) {
          // 2. Bulk Create Variants
          const variantsInput = sourceVariants.map(v => {
            const optionValues = v.selectedOptions.map(so => ({
              optionName: so.name,
              name: so.value
            }));

            const inventoryQuantities = targetLocationId && v.inventoryQuantity !== undefined ? [
              {
                locationId: targetLocationId,
                availableQuantity: v.inventoryQuantity
              }
            ] : [];

            // If the source variant was managed by Shopify, or if there is inventory to migrate, set tracked to true
            const isTracked = (v.inventoryItem && v.inventoryItem.tracked) || (v.inventoryQuantity !== undefined && v.inventoryQuantity > 0);

            return {
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              inventoryItem: {
                sku: v.sku,
                tracked: isTracked
              },
              inventoryPolicy: v.inventoryPolicy || "DENY",
              inventoryQuantities: inventoryQuantities,
              optionValues: optionValues
            };
          });

          console.log(`Bulk creating ${variantsInput.length} variants...`);
          const createdVariants = await bulkCreateVariants(target.shop, target.accessToken, targetProductId, variantsInput);

          if (createdVariants) {
            // Map variant IDs
            for (const sVar of sourceVariants) {
              const tVar = createdVariants.find(tv => tv.sku === sVar.sku);
              if (tVar) {
                mappings[sVar.id] = tVar.id;
              }
            }
          }
        }
      }

      saveMappings(mappings);
    }

    // Be friendly to API limits
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("=== Products Migration Complete ===\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('migrate-products.js')) {
  run().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
