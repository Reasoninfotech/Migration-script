import fs from "fs";
import { CONFIG } from "./config.js";
import { shopifyRequest, fetchPaginated } from "./api.js";

const MAPPINGS_FILE = "./id-mappings.json";

// Helper to load existing mappings
export function loadMappings() {
  if (fs.existsSync(MAPPINGS_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
    } catch (e) {
      return {};
    }
  }
  return {};
}

// Helper to save mappings
export function saveMappings(mappings) {
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2), "utf8");
}

async function getMetaobjects(shop, token) {
  console.log(`Fetching Metaobject Definitions from ${shop} to identify types...`);
  
  const definitionsQuery = `
    query {
      metaobjectDefinitions(first: 50) {
        edges {
          node {
            type
          }
        }
      }
    }
  `;

  let types = [];
  try {
    const res = await shopifyRequest(shop, token, definitionsQuery);
    types = res.metaobjectDefinitions.edges.map(e => e.node.type);
    console.log(`Identified ${types.length} metaobject types: ${types.join(", ")}`);
  } catch (err) {
    console.error(`Error fetching metaobject definitions from ${shop}:`, err.message);
    throw err;
  }

  let allMetaobjects = [];
  
  for (const type of types) {
    console.log(`Fetching Metaobjects of type '${type}' from ${shop}...`);

    try {
      let hasNextPage = true;
      let cursor = null;

      while (hasNextPage) {
        const paginatedQuery = `
          query GetPaginated($first: Int!, $after: String, $type: String!) {
            metaobjects(first: $first, after: $after, type: $type) {
              pageInfo {
                hasNextPage
                endCursor
              }
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

        const res = await shopifyRequest(shop, token, paginatedQuery, { first: 50, after: cursor, type });
        const connection = res.metaobjects;

        if (connection) {
          const nodes = connection.edges.map(e => e.node);
          allMetaobjects = allMetaobjects.concat(nodes);
          hasNextPage = connection.pageInfo.hasNextPage;
          cursor = connection.pageInfo.endCursor;
        } else {
          hasNextPage = false;
        }

        if (hasNextPage) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    } catch (err) {
      console.error(`Error fetching metaobjects of type '${type}' from ${shop}:`, err.message);
    }
  }

  console.log(`Successfully fetched a total of ${allMetaobjects.length} metaobjects from ${shop}.`);
  return allMetaobjects;
}

async function createMetaobject(shop, token, type, handle, fields) {
  const mutation = `
    mutation CreateMetaobject($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          id
          handle
          type
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const variables = {
    metaobject: {
      type,
      handle,
      fields: fields
        .filter(f => f.value !== null && f.value !== undefined)
        .map(f => ({ key: f.key, value: f.value }))
    }
  };

  try {
    const res = await shopifyRequest(shop, token, mutation, variables);
    const result = res.metaobjectCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating metaobject (${type}/${handle}) on ${shop}:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }

    return result.metaobject;
  } catch (err) {
    console.error(`❌ Request error creating metaobject (${type}/${handle}) on ${shop}:`, err.message);
    return null;
  }
}

// Check if metaobject exists on target by type and handle
async function findMetaobjectOnTarget(shop, token, type, handle) {
  const query = `
    query FindMetaobject($type: String!, $handle: String!) {
      metaobjectByHandle(handle: { type: $type, handle: $handle }) {
        id
      }
    }
  `;
  try {
    const res = await shopifyRequest(shop, token, query, { type, handle });
    return res.metaobjectByHandle ? res.metaobjectByHandle.id : null;
  } catch (err) {
    return null;
  }
}

async function resolveMediaImage(sourceShop, sourceToken, targetShop, targetToken, sourceId, mappings) {
  if (mappings[sourceId]) {
    return mappings[sourceId];
  }

  console.log(`🔍 Resolving source MediaImage references for ${sourceId}...`);
  const query = `
    query GetMediaImage($id: ID!) {
      node(id: $id) {
        ... on MediaImage {
          image {
            url
          }
        }
      }
    }
  `;

  try {
    const res = await shopifyRequest(sourceShop, sourceToken, query, { id: sourceId });
    const imageUrl = res.node?.image?.url;
    if (!imageUrl) {
      console.warn(`⚠️ Could not retrieve image URL for ${sourceId}`);
      return null;
    }

    console.log(`📤 Uploading image ${imageUrl} to target store...`);
    const mutation = `
      mutation CreateFile($files: [FileCreateInput!]!) {
        fileCreate(files: $files) {
          files {
            id
            fileStatus
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const fileRes = await shopifyRequest(targetShop, targetToken, mutation, {
      files: [{
        alt: "Migrated Image",
        contentType: "IMAGE",
        originalSource: imageUrl
      }]
    });

    const fileResult = fileRes.fileCreate;
    if (fileResult.userErrors && fileResult.userErrors.length > 0) {
      console.error(`❌ Errors creating file on target:`, JSON.stringify(fileResult.userErrors));
      return null;
    }

    const newId = fileResult.files?.[0]?.id;
    if (newId) {
      console.log(`✅ Successfully uploaded and registered file on target: ${newId}`);
      mappings[sourceId] = newId;
      saveMappings(mappings);
      return newId;
    }
  } catch (err) {
    console.error(`❌ Error resolving MediaImage reference:`, err.message);
  }
  return null;
}

export async function run() {
  const { source, target } = CONFIG;
  const mappings = loadMappings();

  console.log("=== STEP 2: Migrating Metaobject Entries ===");

  const sourceMetaobjects = await getMetaobjects(source.shop, source.accessToken);
  if (sourceMetaobjects.length === 0) {
    console.log("No metaobjects found on source store.");
    return;
  }

  // Pass 1: Create all metaobjects, ignoring reference resolution for now
  // This gets us the list of new IDs
  console.log("Starting Pass 1: Creating Metaobject Entries...");
  for (const item of sourceMetaobjects) {
    const sourceId = item.id;

    // Check if we already mapped this ID
    if (mappings[sourceId]) {
      console.log(`⏭️ Metaobject ${item.type}/${item.handle} already migrated. Skipping.`);
      continue;
    }

    // Check if it already exists on target store with the same type and handle
    const existingTargetId = await findMetaobjectOnTarget(target.shop, target.accessToken, item.type, item.handle);
    if (existingTargetId) {
      console.log(`🔗 Metaobject ${item.type}/${item.handle} already exists on target. Recording ID mapping.`);
      mappings[sourceId] = existingTargetId;
      saveMappings(mappings);
      continue;
    }

    console.log(`Creating metaobject ${item.type}/${item.handle}...`);
    
    // Scan and resolve any MediaImage references before creating the metaobject entry
    const cleanedFields = [];
    for (const field of item.fields) {
      let val = field.value;
      if (val) {
        const mediaRegex = /gid:\/\/shopify\/MediaImage\/\d+/g;
        const matches = val.match(mediaRegex);
        if (matches) {
          for (const oldId of matches) {
            const targetId = await resolveMediaImage(source.shop, source.accessToken, target.shop, target.accessToken, oldId, mappings);
            if (targetId) {
              val = val.replace(oldId, targetId);
            }
          }
        }
      }
      cleanedFields.push({ key: field.key, value: val });
    }

    const created = await createMetaobject(target.shop, target.accessToken, item.type, item.handle, cleanedFields);
    if (created) {
      console.log(`✅ Created metaobject: ${created.id}`);
      mappings[sourceId] = created.id;
      saveMappings(mappings);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Pass 2: Resolve references
  // If a metaobject has a field referencing another metaobject, update the field to use the target's metaobject ID.
  console.log("\nStarting Pass 2: Resolving Metaobject References...");
  for (const item of sourceMetaobjects) {
    const targetId = mappings[item.id];
    if (!targetId) continue;

    let hasReference = false;
    const updatedFields = item.fields.map(f => {
      let val = f.value;
      if (!val) return f;

      // Check if value contains any source Shopify GID that we have a mapping for
      // E.g., gid://shopify/Metaobject/123456
      const gidRegex = /gid:\/\/shopify\/[A-Za-z0-9]+\/\d+/g;
      const matches = val.match(gidRegex);

      if (matches) {
        for (const oldGid of matches) {
          if (mappings[oldGid]) {
            console.log(`🔄 Mapping reference ${oldGid} -> ${mappings[oldGid]} in ${item.type}/${item.handle}`);
            val = val.replace(oldGid, mappings[oldGid]);
            hasReference = true;
          }
        }
      }

      return { key: f.key, value: val };
    });

    if (hasReference) {
      console.log(`Updating references for metaobject ${item.type}/${item.handle}...`);
      const mutation = `
        mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
          metaobjectUpdate(id: $id, metaobject: $metaobject) {
            metaobject {
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
        const res = await shopifyRequest(target.shop, target.accessToken, mutation, {
          id: targetId,
          metaobject: { fields: updatedFields }
        });
        const errors = res.metaobjectUpdate.userErrors;
        if (errors && errors.length > 0) {
          console.error(`❌ Errors updating references for ${targetId}:`, JSON.stringify(errors));
        } else {
          console.log(`✅ References updated successfully for ${targetId}`);
        }
      } catch (err) {
        console.error(`❌ Request error updating references for ${targetId}:`, err.message);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log("=== Metaobjects Migration Complete ===\n");
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('migrate-metaobjects.js')) {
  run().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
