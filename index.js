
// Enhanced index.js with proper pricing and cart functionality
import express from 'express';
import session from 'express-session';
import SqliteStore from 'better-sqlite3-session-store';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import db, { seedProducts, getProducts, addContactMessage, getContactMessages, deleteContactMessage, authenticateUser, createUser, countUsers, getUserByUsername, listUsers, getUserById, countAdmins, changeUserPassword, deleteUser, addReview, getApprovedReviews, getAllReviews, getReviewStats, countPendingReviews, setReviewStatus, deleteReview, createOrder, getOrderByReference, listOrders, getOrderItems, countNewOrders, setOrderStatus, ORDER_STATUSES } from './db.js';
import { notifyAdminNewOrder, notifyCustomerOrderConfirmation } from './mailer.js';

export const app = express();
const isProduction = process.env.NODE_ENV === 'production';

// Vrai seulement quand ce fichier est le point d'entree de Node.
// Pendant `node --test`, le module est importe : demarrer un serveur ou le
// store SQLite (intervalle de purge) empecherait la suite de se terminer.
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Added for API endpoints
// Le secret de session signe les cookies (HMAC) et verrouille le panier.
// En production, on REFUSE de demarrer sans SESSION_SECRET :
// son fallback en dur rendait la signature forgeable (session fixation -> admin).
// En developpement, un fallback local est accepte (avec avertissement).
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
    if (isProduction) {
        console.error('[KEKELI] Variable d\'environnement SESSION_SECRET manquante en production.');
        console.error('[KEKELI] Refus de demarrer. Definissez-la (ex: openssl rand -hex 32) puis relancez.');
        process.exit(1);
    } else {
        console.warn('[KEKELI] ATTENTION : SESSION_SECRET non defini - secret de developpement utilise.');
        console.warn('[KEKELI] En production, l\'application refusera de demarrer sans cette variable.');
    }
}

const SessionStore = SqliteStore(session);

// Sessions persistees dans SQLite (via better-sqlite3-session-store) :
// plus de fuite memoire MemoryStore, sessions conservees au redemarrage.
// Quand le module est importe (suite de tests), on garde le MemoryStore : le
// store SQLite demarre un intervalle de nettoyage qui empecherait les tests
// de se terminer.
const sessionStore = isDirectRun
    ? new SessionStore({
        client: db,
        expired: { clear: true, intervalMs: 15 * 60 * 1000 } // purge toutes les 15 min
    })
    : undefined;

app.use(session({
    ...(sessionStore ? { store: sessionStore } : {}),
    secret: sessionSecret || 'dev-insecure-session-secret-change-me',
    resave: false,
    saveUninitialized: true,
    rolling: true,
    cookie: {
        httpOnly: true,
        maxAge: 2 * 60 * 60 * 1000, // 2h : expiration d'inactivite
        secure: isProduction,
        sameSite: 'lax'
    }
}));

// ============ PROTECTION CSRF ============
// Un jeton aleatoire par session est genere puis injecte dans chaque formulaire.
// Tout POST doit l'envoyer ; sinon la requete est refusee (403).
// Un site tiers ne peut pas lire le jeton (politique de meme origine) -> les
// requetes forgees (CSRF) deviennent impossibles, meme si les cookies sont envoyes.
app.use((req, res, next) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.locals.csrfToken = req.session.csrfToken;
    next();
});

function csrfProtect(req, res, next) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        return next();
    }
    const token = req.body && req.body.csrfToken;
    if (!token || token !== req.session.csrfToken) {
        return res.status(403).render('error', {
            title: 'Requete refusee',
            message: 'Jeton de securite invalide ou manquant. Rechargez la page puis reessayez.'
        });
    }
    next();
}
app.use(csrfProtect);

// Revalide la session a chaque requete : si le compte a ete supprime ou son role
// modifie en base, la session deja etablie est invalidee (pas de privilege fantome).
function refreshUser(req, res, next) {
    if (!req.session.user) return next();
    const current = getUserById(req.session.user.id);
    if (!current || current.role !== req.session.user.role) {
        delete req.session.user;
        return next();
    }
    req.session.user = { id: current.id, username: current.username, role: current.role };
    next();
}
app.use(refreshUser);

// ============ RATE LIMITING ============
// Anti-spam / anti-bruteforce, fenetre fixe en memoire par IP et par route.
// (En production multi-instances, preferer un store partage comme Redis.)
const rateLimitWindows = new Map();

function rateLimit(name, { windowMs, max, message }) {
    return (req, res, next) => {
        const now = Date.now();
        const key = `${req.ip}:${name}`;

        // Nettoyage periodique des entrees expirees (anti-fuite memoire)
        if (rateLimitWindows.size > 1000) {
            for (const [k, v] of rateLimitWindows) {
                if (v.resetAt <= now) rateLimitWindows.delete(k);
            }
        }

        let entry = rateLimitWindows.get(key);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            rateLimitWindows.set(key, entry);
        }
        entry.count += 1;

        if (entry.count > max) {
            res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
            return res.status(429).render('error', {
                title: 'Trop de requêtes',
                message: message || 'Trop de tentatives. Réessayez dans quelques minutes.'
            });
        }
        next();
    };
}

// ============ EN-TETES DE SECURITE ============
// Clickjacking (X-Frame-Options), sniffing MIME, fuite du referent,
// et CSP qui restreint les scripts/styles/objets a une liste blanche.
// ('unsafe-inline' est requis par les gestionnaires onclick des vues.)
app.use((req, res, next) => {
    res.set('X-Frame-Options', 'DENY');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (isProduction) {
        res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }
    res.set('Content-Security-Policy', [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
        "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com",
        "font-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self'",
        "media-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'"
    ].join('; '));
    next();
});

// Empecher le navigateur de servir une version perimee des pages.
// Place apres express.static : les fichiers (css, images) gardent leur cache normal,
// mais le HTML est toujours revalide (indispensable apres un deploiement).
app.use((req, res, next) => {
    res.set('Cache-Control', 'no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    next();
});

// Ensure DB has initial products, then read products on demand
seedProducts();

// Helper function to initialize cart
function initializeCart(req) {
    if (!req.session.basket) {
        req.session.basket = [];
    }
}

function normalizeString(str) {
    if (!str) return '';
    // Normalize to NFD to separate accents, then remove accent marks
    let s = String(str).toLowerCase();
    s = s.normalize('NFD').replace(/\p{Diacritic}/gu, '');
    // Replace common ligatures
    s = s.replace(/Å“/g, 'oe').replace(/Ã¦/g, 'ae');
    // Remove other non-word characters except spaces
    s = s.replace(/[^-\u007F]/g, '');
    return s;
}

function getFilteredProducts(searchQuery) {
    const q = normalizeString(searchQuery || '');
    const products = getProducts();
    if (!q) return products;

    return products.filter((item) => {
        const name = normalizeString(item.nom);
        const desc = normalizeString(item.description);
        return name.includes(q) || desc.includes(q);
    });
}

// Helper function to calculate cart totals
function calculateCartTotals(basket) {
    let subtotal = 0;
    let totalItems = 0;
    
    basket.forEach(item => {
        subtotal += item.prix * item.quantity;
        totalItems += item.quantity;
    });
    
    const tax = subtotal * 0.10; // 10% tax
    const total = subtotal + tax;
    
    return { subtotal, tax, total, totalItems };
}

// Routes
app.get('/', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.render('index', { 
        title: 'Accueil - Ferme Bio', 
        cartCount: cartTotals.totalItems,
        reviewStats: getReviewStats(),
        reviewPreview: getApprovedReviews().slice(0, 3)
    });
});

app.get('/produits', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    const searchQuery = req.query.search || '';
    const filteredItems = getFilteredProducts(searchQuery);
    res.render('produits', { 
        title: 'Nos Produits', 
        items: filteredItems,
        searchQuery,
        cartCount: cartTotals.totalItems 
    });
});

app.get('/histoire', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.render('histoire', { 
        title: 'Notre Histoire',
        cartCount: cartTotals.totalItems 
    });
});

app.get('/acheter', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.render('acheter', { 
        title: 'Acheter nos Produits', 
        items: getProducts(),
        cartCount: cartTotals.totalItems 
    });
});

app.get('/panier', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.render('panier', { 
        title: 'Votre Panier', 
        basket: req.session.basket,
        cartTotals: cartTotals
    });
});

// Enhanced cart management
app.post('/panier/add', (req, res) => {
    initializeCart(req);
    const productId = parseInt(req.body.productId);
    const quantity = parseInt(req.body.quantity) || 1;
    
    const products = getProducts();
    const item = products.find(i => i.id === productId);
    if (!item) {
        return res.status(404).json({ error: 'Produit non trouvé' });
    }
    
    // Check if item already in cart
    const existingItem = req.session.basket.find(basketItem => basketItem.id === productId);
    
    if (existingItem) {
        existingItem.quantity += quantity;
    } else {
        req.session.basket.push({
            id: item.id,
            nom: item.nom,
            prix: item.prix,
            image: item.image,
            quantity: quantity
        });
    }
    
    if (req.headers.accept && req.headers.accept.includes('application/json')) {
        const cartTotals = calculateCartTotals(req.session.basket);
        res.json({ success: true, cartTotals });
    } else {
        res.redirect('/panier');
    }
});

// Update cart item quantity
app.post('/panier/update', (req, res) => {
    initializeCart(req);
    const productId = parseInt(req.body.productId);
    const quantity = parseInt(req.body.quantity);
    
    if (quantity <= 0) {
        req.session.basket = req.session.basket.filter(item => item.id !== productId);
    } else {
        const item = req.session.basket.find(item => item.id === productId);
        if (item) {
            item.quantity = quantity;
        }
    }
    
    res.redirect('/panier');
});

// Remove item from cart
app.post('/panier/remove', (req, res) => {
    initializeCart(req);
    const productId = parseInt(req.body.productId);
    req.session.basket = req.session.basket.filter(item => item.id !== productId);
    res.redirect('/panier');
});

// Clear entire cart
app.post('/panier/clear', (req, res) => {
    req.session.basket = [];
    res.redirect('/panier');
});

// Checkout route
app.get('/checkout', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    
    if (cartTotals.totalItems === 0) {
        return res.redirect('/panier');
    }
    
    res.render('checkout', {
        title: 'Finaliser la commande',
        basket: req.session.basket,
        cartTotals: cartTotals
    });
});

// Process checkout
// La commande est ENREGISTREE en base (table orders + order_items) :
// c'est la seule trace exploitable en cas de litige (non-repudiation).
// Le POST redirige ensuite vers la confirmation (PRG) pour eviter les doubles soumissions.
app.post('/checkout', rateLimit('checkout', {
    windowMs: 60 * 1000,
    max: 6
}), (req, res) => {
    const { nom, email, telephone, adresse, deliveryMethod, paymentMethod, instructions } = req.body;
    const basket = req.session.basket || [];

    if (!nom || !email || !telephone || !adresse) {
        return res.redirect('/checkout');
    }
    if (basket.length === 0) {
        return res.redirect('/panier');
    }

    const cartTotals = calculateCartTotals(basket);
    const reference = `KF-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

    createOrder({
        reference,
        nom, email, telephone, adresse,
        deliveryMethod, paymentMethod, instructions,
        subtotal: cartTotals.subtotal,
        tax: cartTotals.tax,
        total: cartTotals.total,
        items: basket.map((item) => ({
            productId: item.id,
            nom: item.nom,
            prix: item.prix,
            quantity: item.quantity
        }))
    });

    // Clear the cart
    req.session.basket = [];
    req.session.total = 0;

    // Notifications email : la commande est deja enregistree, l'envoi part en
    // arriere-plan et ne peut ni bloquer ni faire echouer la commande.
    const savedOrder = getOrderByReference(reference);
    notifyAdminNewOrder(savedOrder);
    notifyCustomerOrderConfirmation(savedOrder);

    res.redirect(`/confirmation/${encodeURIComponent(reference)}`);
});

app.get('/confirmation/:orderId', (req, res) => {
    const order = getOrderByReference(req.params.orderId);
    if (!order) {
        return res.status(404).render('error', {
            title: 'Commande introuvable',
            message: 'Cette commande n\'existe pas.'
        });
    }

    res.render('confirmation', {
        title: 'Confirmation de commande',
        order: order,
        orderId: order.reference
    });
});

// API endpoint for cart count (for AJAX updates)
app.get('/api/cart-count', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.json({ count: cartTotals.totalItems });
});

app.get('/contact', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    const successMessage = req.session.successMessage || '';
    delete req.session.successMessage;
    res.render('contact', {
        title: 'Contactez-nous',
        cartCount: cartTotals.totalItems,
        successMessage
    });
});

app.post('/send-message', rateLimit('send-message', {
    windowMs: 10 * 60 * 1000,
    max: 5,
    message: 'Trop de messages envoyés. Réessayez dans 10 minutes.'
}), (req, res) => {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
        req.session.successMessage = 'Veuillez remplir tous les champs.';
        return res.redirect('/contact');
    }

    addContactMessage(name, email, message);
    req.session.successMessage = 'Merci ! Votre message a bien été envoyé.';
    res.redirect('/contact');
});

// ============ AVIS CLIENTS ============
app.get('/avis', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    const successMessage = req.session.reviewSuccess || '';
    const errorMessage = req.session.reviewError || '';
    delete req.session.reviewSuccess;
    delete req.session.reviewError;
    res.render('avis', {
        title: 'Avis de nos clients',
        cartCount: cartTotals.totalItems,
        reviews: getApprovedReviews(),
        stats: getReviewStats(),
        successMessage,
        errorMessage
    });
});

app.post('/avis/add', rateLimit('avis-add', {
    windowMs: 10 * 60 * 1000,
    max: 3,
    message: 'Trop d\'avis envoyés. Réessayez dans 10 minutes.'
}), (req, res) => {
    const author = String(req.body.author || '').trim();
    const comment = String(req.body.comment || '').trim();
    const rating = parseInt(req.body.rating, 10);

    if (author.length < 2 || author.length > 60) {
        req.session.reviewError = 'Merci d\'indiquer votre nom (2 à 60 caractères).';
        return res.redirect('/avis');
    }
    if (!(rating >= 1 && rating <= 5)) {
        req.session.reviewError = 'Merci de choisir une note entre 1 et 5 étoiles.';
        return res.redirect('/avis');
    }
    if (comment.length < 3 || comment.length > 600) {
        req.session.reviewError = 'Merci d\'écrire un avis de 3 à 600 caractères.';
        return res.redirect('/avis');
    }

    addReview(author, rating, comment);
    req.session.reviewSuccess = 'Merci ! Votre avis sera publié après validation.';
    res.redirect('/avis');
});

// ============ ADMIN / STAFF - Messages de contact ============
// Regenerer la session apres authentification change l'ID de session :
// un jeton "fixe" par un attaquant avant le login devient inutilisable.
// On conserve le jeton CSRF (il appartient a la session, pas a la navigation).
function regenerateSession(req, data) {
    return new Promise((resolve, reject) => {
        const csrf = req.session.csrfToken;
        req.session.regenerate((err) => {
            if (err) return reject(err);
            if (csrf) req.session.csrfToken = csrf;
            if (data) Object.assign(req.session, data);
            resolve();
        });
    });
}

function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/admin');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || req.session.user.role !== 'admin') {
        req.session.accessDenied = true;
        return res.redirect('/admin');
    }
    next();
}

app.get('/admin', (req, res) => {
    if (countUsers() === 0) {
        return res.render('admin-setup', { title: 'Première configuration' });
    }
    if (!req.session.user) {
        return res.render('admin-login', {
            title: 'Administration',
            error: null,
            denied: Boolean(req.session.accessDenied)
        });
    }
    res.render('admin', {
        title: 'Messages - Administration',
        user: req.session.user,
        messages: getContactMessages(),
        pendingReviews: countPendingReviews(),
        newOrders: countNewOrders()
    });
});

app.post('/admin/setup', rateLimit('admin-setup', {
    windowMs: 5 * 60 * 1000,
    max: 5
}), async (req, res) => {
    if (countUsers() > 0) {
        return res.redirect('/admin');
    }
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || password.length < 8) {
        return res.status(400).render('admin-setup', {
            title: 'Première configuration',
            error: 'Identifiant obligatoire et mot de passe de 8 caractères minimum.'
        });
    }
    const info = createUser(username, password, 'admin');
    try {
        await regenerateSession(req, { user: { id: Number(info.lastInsertRowid), username, role: 'admin' } });
    } catch {
        return res.status(500).render('error', {
            title: 'Erreur',
            message: 'Erreur lors de la connexion. Réessayez.'
        });
    }
    res.redirect('/admin');
});

app.post('/admin/login', rateLimit('admin-login', {
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: 'Trop de tentatives de connexion. Réessayez dans 5 minutes.'
}), async (req, res) => {
    const { username, password } = req.body;
    const user = authenticateUser(String(username || '').trim(), String(password || ''));
    if (!user) {
        return res.status(401).render('admin-login', {
            title: 'Administration',
            error: 'Identifiant ou mot de passe incorrect.',
            denied: false
        });
    }
    try {
        await regenerateSession(req, { user: { id: user.id, username: user.username, role: user.role } });
    } catch {
        return res.status(500).render('error', {
            title: 'Erreur',
            message: 'Erreur lors de la connexion. Réessayez.'
        });
    }
    res.redirect('/admin');
});

// ---------- Gestion des comptes (admin uniquement) ----------
function redirectUsers(req, res, message, isError) {
    if (message) {
        if (isError) {
            req.session.userError = message;
        } else {
            req.session.userSuccess = message;
        }
    }
    res.redirect('/admin/users');
}

app.get('/admin/users', requireAdmin, (req, res) => {
    res.render('admin-users', {
        title: 'Utilisateurs - Administration',
        user: req.session.user,
        users: listUsers(),
        error: req.session.userError || null,
        success: req.session.userSuccess || null
    });
    delete req.session.userError;
    delete req.session.userSuccess;
});

app.post('/admin/users/create', requireAdmin, (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    const role = ['admin', 'staff'].includes(req.body.role) ? req.body.role : 'staff';

    if (!username) {
        return redirectUsers(req, res, 'Identifiant obligatoire.', true);
    }
    if (password.length < 8) {
        return redirectUsers(req, res, 'Mot de passe : 8 caractères minimum.', true);
    }
    if (getUserByUsername(username)) {
        return redirectUsers(req, res, `L'identifiant "${username}" existe déjà.`, true);
    }
    createUser(username, password, role);
    redirectUsers(req, res, `Compte ${role === 'admin' ? 'administrateur' : 'staff'} "${username}" créé.`);
});

app.post('/admin/users/password', requireAdmin, (req, res) => {
    const id = parseInt(req.body.id);
    const password = String(req.body.password || '');
    const target = getUserById(id);

    if (!target) {
        return redirectUsers(req, res, 'Compte introuvable.', true);
    }
    if (password.length < 8) {
        return redirectUsers(req, res, 'Mot de passe : 8 caractères minimum.', true);
    }
    changeUserPassword(id, password);
    redirectUsers(req, res, `Mot de passe de "${target.username}" mis à jour.`);
});

app.post('/admin/users/delete', requireAdmin, (req, res) => {
    const id = parseInt(req.body.id);
    const target = getUserById(id);

    if (!target) {
        return redirectUsers(req, res, 'Compte introuvable.', true);
    }
    if (target.id === req.session.user.id) {
        return redirectUsers(req, res, 'Impossible de supprimer votre propre compte.', true);
    }
    if (target.role === 'admin' && countAdmins() <= 1) {
        return redirectUsers(req, res, 'Impossible de supprimer le dernier administrateur.', true);
    }
    deleteUser(id);
    redirectUsers(req, res, `Compte "${target.username}" supprimé.`);
});

app.post('/admin/logout', requireAuth, (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin');
    });
});

app.post('/admin/messages/delete', requireAdmin, (req, res) => {
    deleteContactMessage(parseInt(req.body.id));
    res.redirect('/admin');
});

// ============ ADMIN - Moderation des avis ============
app.get('/admin/avis', requireAuth, (req, res) => {
    res.render('admin-avis', {
        title: 'Avis clients - Administration',
        user: req.session.user,
        reviews: getAllReviews(),
        stats: getReviewStats()
    });
});

app.post('/admin/avis/approve', requireAdmin, (req, res) => {
    setReviewStatus(parseInt(req.body.id), 'approved');
    res.redirect('/admin/avis');
});

app.post('/admin/avis/unpublish', requireAdmin, (req, res) => {
    setReviewStatus(parseInt(req.body.id), 'pending');
    res.redirect('/admin/avis');
});

app.post('/admin/avis/delete', requireAdmin, (req, res) => {
    deleteReview(parseInt(req.body.id));
    res.redirect('/admin/avis');
});

// ============ ADMIN - Commandes ============
app.get('/admin/commandes', requireAuth, (req, res) => {
    // Les articles sont charges par commande pour afficher le recapitulatif
    // sans multiplier une requete par ligne du tableau.
    const orders = listOrders().map((order) => ({
        ...order,
        items: getOrderItems(order.id)
    }));

    // Messages flash : lus une seule fois puis retires de la session
    const orderSuccess = req.session.orderSuccess || '';
    const orderError = req.session.orderError || '';
    delete req.session.orderSuccess;
    delete req.session.orderError;

    res.render('admin-commandes', {
        title: 'Commandes - Administration',
        user: req.session.user,
        orders,
        statuses: ORDER_STATUSES,
        orderSuccess,
        orderError
    });
});

app.post('/admin/commandes/statut', requireAdmin, (req, res) => {
    const id = parseInt(req.body.id, 10);
    const status = req.body.status;

    if (Number.isInteger(id) && setOrderStatus(id, status)) {
        req.session.orderSuccess = 'Statut de la commande mis a jour.';
    } else {
        req.session.orderError = 'Statut invalide : la commande n a pas ete modifiee.';
    }
    res.redirect('/admin/commandes');
});

app.get('/health', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(200).json({ status: 'ok' });
});

// Error handling middleware
app.use((err, req, res, _next) => {
    console.error(err.stack);
    res.status(500).render('error', { 
        title: 'Erreur', 
        message: 'Une erreur est survenue' 
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).render('error', { 
        title: 'Page non trouvée', 
        message: 'La page que vous cherchez n\'existe pas' 
    });
});

const PORT = process.env.PORT || 3000;
if (isDirectRun) {
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}
