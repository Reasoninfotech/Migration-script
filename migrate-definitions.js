import { CONFIG } from "./config.js";
import { shopifyRequest, fetchPaginated } from "./api.js";

async function getDefinitions(shop, token) {
  const queryStr = `
    name
    type
    displayNameKey
    fieldDefinitions {
      name
      key
      description
      type {
        name
      }
      required
      validations {
        name
        value
      }
    }
  `;

  console.log(`Fetching Metaobject Definitions from ${shop}...`);
  try {
    const definitions = await fetchPaginated(shop, token, "metaobjectDefinitions", queryStr);
    console.log(`Successfully fetched ${definitions.length} definitions from ${shop}.`);
    return definitions;
  } catch (err) {
    console.error(`Error fetching definitions from ${shop}:`, err.message);
    throw err;
  }
}

async function createDefinition(shop, token, definition) {
  const mutation = `
    mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
      metaobjectDefinitionCreate(definition: $definition) {
        metaobjectDefinition {
          id
          type
          name
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const fieldDefinitionsInput = definition.fieldDefinitions.map(fd => {
    const input = {
      name: fd.name,
      key: fd.key,
      type: fd.type.name,
      description: fd.description,
      required: fd.required
    };
    if (fd.validations && fd.validations.length > 0) {
      input.validations = fd.validations.map(v => ({
        name: v.name,
        value: v.value
      }));
    }
    return input;
  });

  const variables = {
    definition: {
      name: definition.name,
      type: definition.type,
      displayNameKey: definition.displayNameKey,
      fieldDefinitions: fieldDefinitionsInput
    }
  };

  try {
    const res = await shopifyRequest(shop, token, mutation, variables);
    const result = res.metaobjectDefinitionCreate;

    if (result.userErrors && result.userErrors.length > 0) {
      console.error(`❌ User errors creating definition '${definition.type}' on ${shop}:`);
      result.userErrors.forEach(err => {
        console.error(`  - ${err.field.join(".")}: ${err.message}`);
      });
      return null;
    }

    console.log(`✅ Definition '${result.metaobjectDefinition.name}' (${result.metaobjectDefinition.type}) created successfully on ${shop}.`);
    return result.metaobjectDefinition;
  } catch (err) {
    console.error(`❌ Request error creating definition '${definition.type}' on ${shop}:`, err.message);
    return null;
  }
}

export async function run() {
  const { source, target } = CONFIG;

  console.log("=== STEP 1: Migrating Metaobject Definitions ===");

  // 1. Fetch from source
  const sourceDefs = await getDefinitions(source.shop, source.accessToken);
  if (sourceDefs.length === 0) {
    console.log("No metaobject definitions found on source store.");
    return;
  }

  // 2. Fetch from target to avoid duplicates
  let targetDefs = [];
  try {
    targetDefs = await getDefinitions(target.shop, target.accessToken);
  } catch (err) {
    console.log("Could not fetch target definitions (maybe none exist yet or token is invalid). Proceeding...");
  }

  const targetTypes = new Set(targetDefs.map(d => d.type));

  // 3. Migrate definitions that don't exist in target
  for (const sourceDef of sourceDefs) {
    if (targetTypes.has(sourceDef.type)) {
      console.log(`⏭️ Definition for '${sourceDef.type}' already exists on target store. Skipping.`);
      continue;
    }

    console.log(`Creating definition for '${sourceDef.type}'...`);
    await createDefinition(target.shop, target.accessToken, sourceDef);
    // Be gentle with rate limit
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log("=== Metaobject Definitions Migration Complete ===\n");
}

// Support running this script directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] && process.argv[1].endsWith('migrate-definitions.js')) {
  run().catch(err => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
