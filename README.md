# RecoverAI – AI-Powered Payment Recovery Platform

**Turn failed payments into recovered revenue.**

RecoverAI is an AI-powered payment recovery platform designed to help small businesses understand failed payments, identify recovery opportunities, and take informed action to recover lost revenue.

Built for the **PayPal AI Hackathon**, RecoverAI combines PayPal Sandbox integration, payment analytics, and an AI-powered recovery copilot to make payment recovery smarter, safer, and more efficient.

---

## 🌐 Live Demo

- **Frontend:** https://recoverai-frontend-lg06.onrender.com
- **Backend API:** https://recoverai-backend-2f41.onrender.com

---

## 🚨 The Problem

Failed, pending, and abandoned payments create revenue losses for small businesses.

Merchants often struggle to understand why payments fail, which customers need attention first, and what action they should take next.

Manual payment tracking and follow-ups consume time, while a lack of actionable insights can lead to missed recovery opportunities.

## 💡 Our Solution

RecoverAI provides a centralized platform that helps merchants monitor payment activity, understand payment failures, and manage recovery workflows.

Instead of simply displaying failed transactions, RecoverAI helps merchants understand what happened and what they can do next.

## ✨ Key Features

### 1. Payment Monitoring Dashboard
- Monitor completed, failed, and pending payments.
- View payment performance and revenue metrics.
- Track payment success rates.
- Identify payments that need attention.

### 2. Payment Tracking
- View payment transactions and their statuses.
- Search and monitor payment records.
- Examine recorded payment failure information.
- Review payment attempts and transaction details.

### 3. AI Recovery Copilot
- Analyze recorded payment failure information.
- Explain possible reasons behind payment failures.
- Recommend relevant recovery actions.
- Generate personalized payment recovery message drafts.
- Provide rule-based fallback responses when AI service availability is limited.

### 4. PayPal Integration
- Create PayPal Sandbox checkout orders.
- Verify payment status through the backend.
- Capture payments after customer approval.
- Store verified payment information.
- Support PayPal webhook event processing.

### 5. Recovery Management
- Generate recovery recommendations.
- Create and track recovery actions.
- Generate recovery checkout links.
- Verify and capture approved recovery payments.
- Update payment and recovery statuses consistently.

---

## 🧠 How RecoverAI Works

1. **Monitor:** The merchant views payment activity in the dashboard.
2. **Identify:** The system identifies payments that require attention.
3. **Analyze:** The AI Recovery Copilot analyzes recorded payment and failure information.
4. **Recommend:** RecoverAI suggests an appropriate recovery action.
5. **Recover:** The merchant initiates a recovery checkout workflow.
6. **Verify:** The backend verifies the PayPal transaction before updating payment records.

**Important:** AI-generated explanations and recommendations do not determine payment status. Payment outcomes are verified using PayPal data on the backend. Recovery captures require customer approval and an explicit capture action.

---

## 🏗️ Technology Stack

| Category | Technologies |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | PostgreSQL |
| Payment Integration | PayPal REST API, PayPal Sandbox |
| AI Integration | Google Gemini API |
| Authentication | JSON Web Tokens (JWT) |
| API Architecture | REST API |
| Deployment | Render |

---

## 🏛️ System Architecture

```text
             MERCHANT
                 |
                 v
        FRONTEND APPLICATION
          HTML / CSS / JS
                 |
                 v
          EXPRESS REST API
                 |
       +---------+----------+
       |         |          |
       v         v          v
   PostgreSQL  PayPal    AI Service
   Database    API       Gemini API
       |         |          |
       +---------+----------+
                 |
                 v
        PAYMENT RECOVERY
             ENGINE
                 |
                 v
       VERIFIED PAYMENT STATUS
```

---

## 🔐 Security and Reliability

- JWT-based authentication.
- Merchant-scoped access to payment and recovery data.
- Sensitive API credentials stored in environment variables.
- Payment status verified through PayPal's backend API.
- No storage of customer card details.
- Customer approval required before recovery payment capture.
- Duplicate recovery actions are guarded against.
- Database transactions and locking help maintain payment and recovery consistency.

---

## 🗄️ Database

RecoverAI uses PostgreSQL to manage merchant accounts, customer information, payment records, recovery recommendations, and transaction history.

Core database tables include:

- `users`
- `customers`
- `payments`
- `payment_attempts`
- `failure_analysis`
- `recovery_recommendations`
- `recovery_actions`
- `notifications`
- `webhook_events`

---

## 📂 Project Structure

```text
RecoverAI/
│
├── backend/
│   ├── database/
│   │   └── schema.sql
│   │
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── middleware/
│   │   ├── routes/
│   │   ├── services/
│   │   └── server.js
│   │
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── package-lock.json
│
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── styles.css
│
├── .gitignore
└── README.md
```

---

## ⚙️ Local Installation and Setup

### Prerequisites

- Node.js and npm
- PostgreSQL
- Git
- A PayPal Developer Sandbox account

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
cd RecoverAI
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment variables

Create a `.env` file inside the `backend` directory using `.env.example` as a reference.

Configure the following variables:

```env
PORT=5000
DATABASE_URL=your_postgresql_connection_string
JWT_SECRET=your_jwt_secret
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_WEBHOOK_ID=your_paypal_webhook_id
GEMINI_API_KEY=your_gemini_api_key
For security purpose the id and other keys are not revealed publicly.
```

Use your own credentials. Never commit `.env` or expose API secrets publicly. 

### 4. Set up the database

Create a PostgreSQL database and execute the SQL schema from:

```text
backend/database/schema.sql
```

### 5. Start the backend

```bash
npm run dev
```

The backend runs locally at:

```text
http://localhost:5000
```

### 6. Run the frontend

Open `frontend/index.html` using VS Code Live Server.

The frontend communicates with the backend REST API.

---

## 🧪 Testing

RecoverAI uses PayPal Sandbox for payment testing.

The project supports testing of:

- Merchant authentication.
- Payment monitoring.
- Payment analysis.
- Recovery recommendation generation.
- Recovery action creation.
- PayPal checkout creation.
- Customer-approved payment capture.
- Payment and recovery status consistency.

Use Sandbox accounts and test transactions rather than real customer payments.

---

## 🏆 Hackathon Highlights

- Addresses a practical financial problem affecting small businesses.
- Combines AI assistance with verified payment information.
- Integrates PayPal Sandbox payment workflows.
- Converts payment failure information into actionable recovery recommendations.
- Provides a complete recovery workflow from analysis to verified capture.
- Includes fallback analysis and message generation when the AI provider is unavailable.

---

## 🔮 Future Improvements

- Production-ready email and notification integrations.
- More advanced payment failure prediction.
- Improved recovery prioritization.
- Additional payment provider integrations.
- Expanded merchant analytics.
- Production-grade monitoring and observability.

---

## 👨‍💻 Built For

**PayPal AI Hackathon**

Developed as a solo project.

## 💬 Our Vision

We believe a failed payment should not automatically mean lost revenue.

**RecoverAI aims to make every payment recovery opportunity smarter, simpler, and more actionable.**

---

*RecoverAI — Recover revenue. Restore opportunities.*
