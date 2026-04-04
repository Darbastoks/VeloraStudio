require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const https = require('https');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

// Stripe setup
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Price ID map — values come from .env
const PRICES = {
    solo:   { monthly: process.env.STRIPE_PRICE_SOLO_MONTHLY,   annual: process.env.STRIPE_PRICE_SOLO_ANNUAL   },
    growth: { monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY, annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL },
    team:   { monthly: process.env.STRIPE_PRICE_TEAM_MONTHLY,   annual: process.env.STRIPE_PRICE_TEAM_ANNUAL   },
};

// All valid price IDs (used for validation)
const VALID_PRICE_IDS = new Set(Object.values(PRICES).flatMap(p => [p.monthly, p.annual]).filter(Boolean));

// ================================================================
// STRIPE WEBHOOK — must come BEFORE express.json()
// Uses raw body so Stripe signature verification works
// ================================================================
app.post('/webhook/stripe',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const sig = req.headers['stripe-signature'];
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        let event;
        try {
            event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } catch (err) {
            console.error('Stripe webhook signature error:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            console.log('Payment completed:', session.customer_email, session.amount_total);

            // Forward to n8n (fire and forget)
            const n8nUrl = process.env.N8N_WEBHOOK_URL;
            if (n8nUrl) {
                const payload = JSON.stringify({
                    event: 'checkout.session.completed',
                    customer_email: session.customer_email,
                    customer_name: session.customer_details?.name || '',
                    amount_total: session.amount_total,
                    currency: session.currency,
                    session_id: session.id,
                    subscription_id: session.subscription,
                    timestamp: new Date().toISOString(),
                });

                try {
                    const url = new URL(n8nUrl);
                    const lib = url.protocol === 'https:' ? https : http;
                    const options = {
                        hostname: url.hostname,
                        port: url.port || (url.protocol === 'https:' ? 443 : 80),
                        path: url.pathname + url.search,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                    };
                    const req2 = lib.request(options);
                    req2.on('error', (e) => console.error('n8n notification error:', e.message));
                    req2.write(payload);
                    req2.end();
                } catch (e) {
                    console.error('Failed to send n8n notification:', e.message);
                }
            }
        }

        res.json({ received: true });
    }
);

// ================================================================
// GENERAL MIDDLEWARE
// ================================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ================================================================
// API: Return public price IDs (not secret — safe to expose)
// ================================================================
app.get('/api/prices', (req, res) => {
    res.json(PRICES);
});

// ================================================================
// API: Create Stripe Checkout Session
// ================================================================
app.post('/create-checkout-session', async (req, res) => {
    const { priceId } = req.body;

    if (!priceId || !VALID_PRICE_IDS.has(priceId)) {
        return res.status(400).json({ error: 'Neteisingas plano ID.' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${SITE_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${SITE_URL}/#kainos`,
            locale: 'lt',
            billing_address_collection: 'auto',
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout error:', err.message);
        res.status(500).json({ error: 'Nepavyko sukurti mokėjimo sesijos.' });
    }
});

// ================================================================
// STATIC FILES & PAGES
// ================================================================
app.use(express.static(path.join(__dirname)));

app.get('/thank-you', (req, res) => {
    res.sendFile(path.join(__dirname, 'thank-you.html'));
});

// SPA fallback
app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ================================================================
// START SERVER
// ================================================================
app.listen(PORT, () => {
    console.log(`Velora Studio server running on port ${PORT}`);
    if (!process.env.STRIPE_SECRET_KEY) {
        console.warn('WARNING: STRIPE_SECRET_KEY not set. Payments will not work.');
    }
});
