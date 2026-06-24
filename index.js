#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const RETAILERAPI_KEY = process.env.RETAILERAPI_KEY || '';
const RETAILERAPI_URL = 'https://api.retailerapi.com/v1';

// Create MCP Server
const server = new Server(
  {
    name: 'marty-mcp',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'scan_product',
        description: 'Scan a product UPC/EAN/ASIN and get instant profit analysis with deal score, ROI, and 7 retailer comparison',
        inputSchema: {
          type: 'object',
          properties: {
            upc: {
              type: 'string',
              description: 'Product UPC, EAN, ISBN, or ASIN (e.g., 195908578864)',
            },
            cost: {
              type: 'number',
              description: 'Your store cost in dollars (optional, but recommended for profit calculation)',
            },
            store: {
              type: 'string',
              description: 'Store name (Walmart, Target, Goodwill, TJ Maxx, Burlington, etc.)',
              enum: ['walmart', 'target', 'goodwill', 'tjmaxx', 'burlington', 'ross', 'dollargeneral', 'costco', 'samsclub', 'bestbuy', 'homedepot', 'lowes', 'other'],
            },
          },
          required: ['upc'],
        },
      },
      {
        name: 'compare_retailers',
        description: 'Compare product price across 7 retailers (Walmart, Amazon, eBay, Target, Home Depot, Best Buy, Lowe\'s)',
        inputSchema: {
          type: 'object',
          properties: {
            upc: {
              type: 'string',
              description: 'Product UPC/EAN/ASIN',
            },
          },
          required: ['upc'],
        },
      },
      {
        name: 'get_deal_score',
        description: 'Get a deal score (0-100) for a product based on profit potential, ROI, demand, and competition',
        inputSchema: {
          type: 'object',
          properties: {
            upc: {
              type: 'string',
              description: 'Product UPC/EAN/ASIN',
            },
            cost: {
              type: 'number',
              description: 'Your store cost in dollars',
            },
          },
          required: ['upc', 'cost'],
        },
      },
      {
        name: 'check_eligibility',
        description: 'Check if product is gated (restricted on Amazon/Walmart), hazmat, or has IP/trademark risks',
        inputSchema: {
          type: 'object',
          properties: {
            upc: {
              type: 'string',
              description: 'Product UPC/EAN/ASIN',
            },
          },
          required: ['upc'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;
    switch (name) {
      case 'scan_product':
        result = await scanProduct(args);
        break;
      case 'compare_retailers':
        result = await compareRetailers(args);
        break;
      case 'get_deal_score':
        result = await getDealScore(args);
        break;
      case 'check_eligibility':
        result = await checkEligibility(args);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: error.message,
            success: false,
          }, null, 2),
        },
      ],
    };
  }
});


// ============================================
// TOOL IMPLEMENTATIONS
// ============================================

async function fetchProduct(upc) {
  try {
    const response = await fetch(
      `${RETAILERAPI_URL}/lookup?upc=${encodeURIComponent(upc)}&include_offers_reviews=true&include_cross_retailer=true`,
      {
        headers: {
          'Authorization': `Bearer ${RETAILERAPI_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching product:', error.message);
    return null;
  }
}

async function scanProduct(args) {
  const { upc, cost = 0, store = 'other' } = args;

  const productData = await fetchProduct(upc);
  
  if (!productData) {
    throw new Error(`No product found for UPC: ${upc}`);
  }

  const wmPrice = productData.current_price || 0;
  const allPrices = productData.cross_retailer || {};
  
  // Build price list
  const prices = [
    { retailer: 'Walmart', price: wmPrice },
    { retailer: 'Amazon', price: allPrices.amazon?.price || 0 },
    { retailer: 'eBay', price: allPrices.ebay?.price || 0 },
    { retailer: 'Target', price: allPrices.target?.price || 0 },
    { retailer: 'Home Depot', price: allPrices.homedepot?.price || 0 },
    { retailer: 'Best Buy', price: allPrices.bestbuy?.price || 0 },
    { retailer: "Lowe's", price: allPrices.lowes?.price || 0 },
  ].filter(p => p.price > 0);

  // Find best price
  const bestPrice = prices.length > 0 ? 
    prices.reduce((a, b) => a.price < b.price ? a : b) : 
    { retailer: 'None', price: 0 };

  // Calculate profit
  const userCost = cost || bestPrice.price;
  const sweetSpot = bestPrice.price > 0 ? Math.floor(bestPrice.price * 1.15) + 0.99 : 0;
  const profit = sweetSpot - userCost;
  const roi = userCost > 0 ? (profit / userCost) * 100 : 0;

  // Determine verdict
  let verdict = 'PASS';
  if (profit >= 5 && roi >= 25) verdict = 'BUY';
  else if (profit >= 3 && roi >= 15) verdict = 'MAYBE';

  // Store tips
  const storeTips = {
    walmart: 'Check clearance aisles for yellow tags. Use the Walmart app to verify in-store prices.',
    target: 'Check the clearance endcaps. Target often marks down 30-50%.',
    goodwill: 'Check the color tag of the week (usually 50% off). Ask about their price rotation schedule.',
    tjmaxx: 'Check the yellow tags first, then the red tags. Ask for a price check on unmarked items.',
    burlington: 'Check the "Last Act" clearance racks. Prices drop every few weeks.',
    ross: 'Ross has the lowest prices but limited selection.',
    dollargeneral: 'Check the DG clearance section. They often have 50% off discontinued items.',
    costco: 'Check the .97 and .00 price endings — these are clearance items.',
    samsclub: 'Check the "Manager\'s Special" section.',
    bestbuy: 'Check the clearance section. Best Buy often has open-box items.',
    homedepot: 'Check the "Clearance" bays. Look for items ending in .00 or .03.',
    lowes: 'Check the "Clearance" section. Lowes marks down seasonal items heavily.',
    other: 'Always compare against Walmart and Amazon prices.',
  };

  return {
    success: true,
    product: {
      name: productData.title || 'Unknown Product',
      upc: productData.upc || upc,
      brand: productData.brand || '',
      imageUrl: productData.image_url || '',
    },
    pricing: {
      walmartPrice: wmPrice,
      bestPrice: bestPrice.price,
      bestRetailer: bestPrice.retailer,
      sweetSpot: sweetSpot,
    },
    profit: {
      yourCost: userCost,
      profit: profit,
      roi: roi,
      verdict: verdict,
    },
    retailers: prices,
    storeTip: storeTips[store] || storeTips.other,
    timestamp: new Date().toISOString(),
  };
}

async function compareRetailers(args) {
  const { upc } = args;

  const productData = await fetchProduct(upc);
  
  if (!productData) {
    throw new Error(`No product found for UPC: ${upc}`);
  }

  const allPrices = productData.cross_retailer || {};
  const wmPrice = productData.current_price || 0;

  const retailers = [
    { name: 'Walmart', price: wmPrice },
    { name: 'Amazon', price: allPrices.amazon?.price || 0 },
    { name: 'eBay', price: allPrices.ebay?.price || 0 },
    { name: 'Target', price: allPrices.target?.price || 0 },
    { name: 'Home Depot', price: allPrices.homedepot?.price || 0 },
    { name: 'Best Buy', price: allPrices.bestbuy?.price || 0 },
    { name: "Lowe's", price: allPrices.lowes?.price || 0 },
  ].filter(r => r.price > 0);

  const bestPrice = retailers.length > 0 ?
    retailers.reduce((a, b) => a.price < b.price ? a : b) :
    { name: 'None', price: 0 };

  return {
    success: true,
    product: productData.title || 'Unknown Product',
    upc: productData.upc || upc,
    retailers: retailers,
    bestPrice: bestPrice,
    timestamp: new Date().toISOString(),
  };
}

async function getDealScore(args) {
  const { upc, cost } = args;

  if (!cost || cost <= 0) {
    throw new Error('Please provide a valid store cost');
  }

  const productData = await fetchProduct(upc);
  
  if (!productData) {
    throw new Error(`No product found for UPC: ${upc}`);
  }

  const wmPrice = productData.current_price || 0;
  const profit = wmPrice - cost;
  const roi = cost > 0 ? (profit / cost) * 100 : 0;

  // Deal score calculation
  let score = 0;
  let reasons = [];

  // ROI (max 35 points)
  if (roi >= 50) { score += 35; reasons.push('✅ Excellent ROI (50%+)'); }
  else if (roi >= 25) { score += 20; reasons.push('✅ Good ROI (25-50%)'); }
  else if (roi >= 15) { score += 10; reasons.push('⚠️ Moderate ROI (15-25%)'); }
  else { score += 5; reasons.push('❌ Low ROI (<15%)'); }

  // Profit (max 25 points)
  if (profit >= 20) { score += 25; reasons.push('✅ High profit ($20+)'); }
  else if (profit >= 10) { score += 15; reasons.push('✅ Good profit ($10-20)'); }
  else if (profit >= 5) { score += 8; reasons.push('⚠️ Moderate profit ($5-10)'); }
  else { score += 3; reasons.push('❌ Low profit (<$5)'); }

  // Demand (max 20 points)
  const category = (productData.categories?.[0] || '').toLowerCase();
  const highDemand = ['electronics', 'toy', 'game', 'home', 'kitchen', 'tool'];
  if (highDemand.some(c => category.includes(c))) {
    score += 20;
    reasons.push('✅ High demand category');
  } else {
    score += 10;
    reasons.push('⚠️ Standard demand');
  }

  // Competition (max 20 points)
  const retailerCount = Object.keys(productData.cross_retailer || {}).length;
  if (retailerCount >= 4) {
    score += 20;
    reasons.push('✅ Low risk - multiple retailers');
  } else if (retailerCount >= 2) {
    score += 12;
    reasons.push('⚠️ Moderate risk - limited retailers');
  } else {
    score += 5;
    reasons.push('❌ High risk - single retailer');
  }

  const finalScore = Math.min(100, Math.max(0, score));
  const verdict = finalScore >= 70 ? 'BUY' : finalScore >= 45 ? 'MAYBE' : 'PASS';
  const color = finalScore >= 70 ? '#10b981' : finalScore >= 45 ? '#f59e0b' : '#ef4444';

  return {
    success: true,
    product: productData.title || 'Unknown Product',
    upc: productData.upc || upc,
    dealScore: finalScore,
    verdict: verdict,
    color: color,
    emoji: finalScore >= 70 ? '✅' : finalScore >= 45 ? '⚠️' : '❌',
    reasons: reasons.slice(0, 4),
    breakdown: {
      roiScore: Math.round(score * 0.35),
      profitScore: Math.round(score * 0.25),
      demandScore: Math.round(score * 0.20),
      competitionScore: Math.round(score * 0.20),
    },
    timestamp: new Date().toISOString(),
  };
}

async function checkEligibility(args) {
  const { upc } = args;

  const productData = await fetchProduct(upc);
  
  if (!productData) {
    throw new Error(`No product found for UPC: ${upc}`);
  }

  const brand = (productData.brand || '').toLowerCase();
  const category = (productData.categories?.[0] || '').toLowerCase();
  const name = (productData.title || '').toLowerCase();

  // Gating checks
  const gatedBrands = ['nike', 'adidas', 'apple', 'samsung', 'sony', 'lululemon', 'chanel', 'gucci', 'prada'];
  const gatedCategories = ['jewelry', 'watch', 'fine art', 'collectible'];
  const hazmatKeywords = ['hazmat', 'flammable', 'battery', 'lithium', 'alcohol', 'tobacco', 'insecticide', 'pesticide', 'spray', 'aerosol'];
  const ipKeywords = ['lego', 'star wars', 'marvel', 'disney', 'pokemon', 'nintendo', 'hello kitty'];

  const isGatedAmazon = gatedBrands.some(b => brand.includes(b)) || 
                        gatedCategories.some(c => category.includes(c));
  const isGatedWalmart = ['nike', 'adidas', 'apple', 'samsung'].some(b => brand.includes(b));
  const isHazmat = hazmatKeywords.some(k => name.includes(k) || category.includes(k));
  const hasIpRisk = ipKeywords.some(k => name.includes(k) || brand.includes(k));

  const workarounds = [];
  if (isGatedAmazon) {
    workarounds.push('Sell on eBay (no gating)');
    workarounds.push('Apply for ungating on Amazon');
  }
  if (isGatedWalmart) {
    workarounds.push('Apply for Walmart Marketplace');
  }
  if (isGatedAmazon || isGatedWalmart) {
    workarounds.push('Sell on Facebook Marketplace');
  }

  return {
    success: true,
    product: productData.title || 'Unknown Product',
    upc: productData.upc || upc,
    brand: productData.brand || '',
    category: productData.categories?.[0] || '',
    gatingStatus: {
      amazon: isGatedAmazon,
      walmart: isGatedWalmart,
      ebay: false,
    },
    hazmat: isHazmat,
    ipRisk: hasIpRisk,
    workarounds: workarounds,
    summary: (isGatedAmazon || isGatedWalmart) ? 
      '⚠️ This product may be gated on Amazon or Walmart. Consider alternative selling platforms.' : 
      '✅ This product appears to be ungated and ready to sell.',
    timestamp: new Date().toISOString(),
  };
}

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('🚀 MARTY MCP Server running...');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
