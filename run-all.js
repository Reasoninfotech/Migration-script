import { CONFIG } from "./config.js";
import { run as runDefinitions } from "./migrate-definitions.js";
import { run as runMetaobjects } from "./migrate-metaobjects.js";
import { run as runProducts } from "./migrate-products.js";
import { run as runCollections } from "./migrate-collections.js";

async function main() {
  console.log("================================================");
  console.log("🚀 STARTING SHOPIFY STORE MIGRATION");
  console.log(`Source Store: ${CONFIG.source.shop}`);
  console.log(`Target Store: ${CONFIG.target.shop}`);
  console.log("================================================");

  try {
    // Step 1: Migrate Definitions
    await runDefinitions();

    // Step 2: Migrate Metaobjects (Entries)
    await runMetaobjects();

    // Step 3: Migrate Products & Metafields
    await runProducts();

    // Step 4: Migrate Collections
    await runCollections();

    console.log("================================================");
    console.log("🎉 ALL MIGRATION STEPS COMPLETED SUCCESSFULLY!");
    console.log("================================================");
  } catch (err) {
    console.error("================================================");
    console.error("❌ MIGRATION FAILED!");
    console.error(err.message);
    console.error("================================================");
    process.exit(1);
  }
}

main();
