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

// ================================================================
// PLANS & ADD-ONS CONFIG
// ================================================================
const PLANS = {
    solo: {
        monthly: { priceId: process.env.STRIPE_PRICE_SOLO_MONTHLY, display: 25 },
        annual:  { priceId: process.env.STRIPE_PRICE_SOLO_ANNUAL,  display: 199 },
        label: 'Solo',
        description: '1 grožio specialistas',
        mediaAllowance: { images: 20, storageMB: 500 },
    },
    team: {
        monthly: { priceId: process.env.STRIPE_PRICE_TEAM_MONTHLY, display: 59 },
        annual:  { priceId: process.env.STRIPE_PRICE_TEAM_ANNUAL,  display: 399 },
        label: 'Team',
        description: 'Keli darbuotojai',
        mediaAllowance: { images: 50, storageMB: 2048 },
    },
};

const ADDONS = {
    giftcards: {
        monthly: { priceId: process.env.STRIPE_PRICE_ADDON_GIFTCARDS_MONTHLY, display: 9 },
        annual:  { priceId: process.env.STRIPE_PRICE_ADDON_GIFTCARDS_ANNUAL,  display: 79 },
        label: 'Dovanų kortelės',
        icon: 'fa-gift',
        description: 'Parduokite dovanų korteles internetu',
    },
    memberships: {
        monthly: { priceId: process.env.STRIPE_PRICE_ADDON_MEMBERSHIPS_MONTHLY, display: 9 },
        annual:  { priceId: process.env.STRIPE_PRICE_ADDON_MEMBERSHIPS_ANNUAL,  display: 79 },
        label: 'Narystės',
        icon: 'fa-id-card',
        description: 'Mėnesinės narystės ir lojalumo programos',
    },
    sms: {
        monthly: { priceId: process.env.STRIPE_PRICE_ADDON_SMS_MONTHLY, display: 7 },
        annual:  { priceId: process.env.STRIPE_PRICE_ADDON_SMS_ANNUAL,  display: 59 },
        label: 'SMS priminimai',
        icon: 'fa-comment-sms',
        description: 'Automatiniai vizitų priminimai SMS žinutėmis',
    },
    inventory: {
        monthly: { priceId: process.env.STRIPE_PRICE_ADDON_INVENTORY_MONTHLY, display: 12 },
        annual:  { priceId: process.env.STRIPE_PRICE_ADDON_INVENTORY_ANNUAL,  display: 99 },
        label: 'Inventoriaus valdymas',
        icon: 'fa-boxes-stacked',
        description: 'Sekite produktų atsargas ir užsakymus',
    },
    products: {
        monthly: { priceId: process.env.STRIPE_PRICE_ADDON_PRODUCTS_MONTHLY, display: 15 },
        annual:  { priceId: process.env.STRIPE_PRICE_ADDON_PRODUCTS_ANNUAL,  display: 129 },
        label: 'Produktų katalogas',
        icon: 'fa-bag-shopping',
        description: 'Parduokite grožio produktus per svetainę',
        extraMedia: { productImages: 30 },
    },
};

// Build valid price ID set and reverse lookup
const ALL_ITEMS = { ...PLANS, ...ADDONS };
const VALID_PRICE_IDS = new Set(
    Object.values(ALL_ITEMS)
        .flatMap(item => [item.monthly?.priceId, item.annual?.priceId])
        .filter(Boolean)
);
const PRICE_TO_KEY = {};
for (const [key, item] of Object.entries(ALL_ITEMS)) {
    if (item.monthly?.priceId) PRICE_TO_KEY[item.monthly.priceId] = key;
    if (item.annual?.priceId) PRICE_TO_KEY[item.annual.priceId] = key;
}
const PLAN_KEYS = new Set(Object.keys(PLANS));
const PLAN_PRICE_IDS = new Set(
    Object.values(PLANS).flatMap(p => [p.monthly?.priceId, p.annual?.priceId]).filter(Boolean)
);

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
                    plan: session.metadata?.plan || '',
                    addons: session.metadata?.addons || '',
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
// API: Return public catalog (plans + add-ons)
// ================================================================
app.get('/api/prices', (req, res) => {
    const publicPlan = (p) => ({
        monthly: { priceId: p.monthly.priceId, display: p.monthly.display },
        annual:  { priceId: p.annual.priceId,  display: p.annual.display },
        label: p.label,
        description: p.description,
    });
    const publicAddon = (a) => ({
        monthly: { priceId: a.monthly.priceId, display: a.monthly.display },
        annual:  { priceId: a.annual.priceId,  display: a.annual.display },
        label: a.label,
        icon: a.icon,
        description: a.description,
    });

    res.json({
        plans: Object.fromEntries(Object.entries(PLANS).map(([k, v]) => [k, publicPlan(v)])),
        addons: Object.fromEntries(Object.entries(ADDONS).map(([k, v]) => [k, publicAddon(v)])),
    });
});

// ================================================================
// API: Create Stripe Checkout Session (multi-item)
// ================================================================
app.post('/create-checkout-session', async (req, res) => {
    const { priceIds } = req.body;

    if (!Array.isArray(priceIds) || priceIds.length === 0 || priceIds.length > 6) {
        return res.status(400).json({ error: 'Neteisingi kainų ID.' });
    }

    // Validate all IDs exist
    for (const id of priceIds) {
        if (!VALID_PRICE_IDS.has(id)) {
            return res.status(400).json({ error: 'Neteisingas kainų ID.' });
        }
    }

    // Ensure exactly 1 plan
    const selectedPlans = priceIds.filter(id => PLAN_PRICE_IDS.has(id));
    if (selectedPlans.length !== 1) {
        return res.status(400).json({ error: 'Turi būti pasirinktas lygiai 1 planas.' });
    }

    // Build metadata
    const itemKeys = priceIds.map(id => PRICE_TO_KEY[id]).filter(Boolean);
    const planKey = itemKeys.find(k => PLAN_KEYS.has(k));
    const addonKeys = itemKeys.filter(k => !PLAN_KEYS.has(k));

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            line_items: priceIds.map(priceId => ({ price: priceId, quantity: 1 })),
            success_url: `${SITE_URL}/thank-you?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${SITE_URL}/#kainos`,
            locale: 'lt',
            billing_address_collection: 'auto',
            metadata: {
                plan: planKey,
                addons: addonKeys.join(','),
            },
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
