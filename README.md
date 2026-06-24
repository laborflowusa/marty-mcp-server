# MARTY MCP Server

> Universal Retail Arbitrage Scanner — Now inside your AI agent

Scan products, compare prices across 7 retailers, and get instant profit analysis inside Claude, Cursor, and any MCP-compatible AI agent.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Install

### For Claude Desktop

Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "marty": {
      "command": "npx",
      "args": ["-y", "@martyscan/mcp"],
      "env": {
        "RETAILERAPI_KEY": "your_api_key_here"
      }
    }
  }
}
