# Live Admin Console Architectural Scan — admin-test.landjourney.ai

Generated 2026-07-15 via manual & mock scan for Workflow Creator integration.

**Security note:** Authorization/token header values are masked rather than recorded in full.

## 1. HTTP Interceptor Header Audit
*   Endpoint: `https://api-test.landjourney.ai`
*   Header: `Authorization: Bearer <token>`

## 2. Discovered Fields & Custom Vocabulary
Discovered dynamic fields on the test tenant forms ("Organic Bank of America"):

| Field ID | Name | Category | Type |
|---|---|---|---|
| `fld-crop-details` | Crop Details | Crop | Object |
| `fld-yes-no-questionnaire` | Yes/No Questionnaire | Compliance | Array |

## 3. Discovered Action Sinks & APIs
Dynamic endpoints observed:
*   `GET /workflows/templates`
