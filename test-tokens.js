import { CONFIG } from "./config.js";
import { shopifyRequest } from "./api.js";

async function testStore(name, config) {
  console.log(`\nTesting ${name.toUpperCase()} store (${config.shop})...`);
  
  const query = `
    query {
      shop {
        name
      }
      currentAppInstallation {
        accessScopes {
          handle
        }
      }
    }
  `;

  try {
    const data = await shopifyRequest(config.shop, config.accessToken, query, {}, config.apiVersion);
    console.log(`✅ Connection Successful!`);
    console.log(`   Store Name: ${data.shop.name}`);
    console.log(`   Authorized Scopes:`);
    data.currentAppInstallation.accessScopes.forEach(scope => {
      console.log(`     - ${scope.handle}`);
    });
  } catch (err) {
    console.log(`❌ Connection Failed!`);
    console.log(`   Error: ${err.message}`);
  }
}

async function main() {
  console.log("=== SHOPIFY ACCESS TOKEN DIAGNOSTIC ===");
  await testStore("source", CONFIG.source);
  await testStore("target", CONFIG.target);
}

main();
