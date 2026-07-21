
// Enhanced index.js with proper pricing and cart functionality
import express from 'express';
import session from 'express-session';

const app = express();

app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); // Added for API endpoints
app.use(session({
    secret: 'your-secret-key-change-in-production',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false } // Set to true in production with HTTPS
}));

// Enhanced products with realistic pricing
const items = [
    { id: 1, nom: 'Laitues', prix: 3.50, image: "./images/laitue.jpg", description: "Laitues fraîches cultivées biologiquement", stock: 25 },
    { id: 2, nom: 'Tomates', prix: 5.75, image: "./images/tomate.png", description: "Tomates juteuses et savoureuses", stock: 30 },
    { id: 3, nom: 'Betteraves', prix: 4.25, image: "./images/Beetroot.png", description: "Betteraves rouges fraîches", stock: 20 },
    { id: 4, nom: 'Concombres', prix: 2.80, image: "./images/cucumbers.png", description: "Concombres croquants", stock: 15 },
    { id: 5, nom: 'Oignons', prix: 3.20, image: "./images/onion.png", description: "Oignons parfumés de notre terre", stock: 40 },
    { id: 6, nom: 'Carottes', prix: 3.75, image: "./images/carrotte1.jpeg", description: "Carottes douces et nutritives", stock: 35 },
    { id: 7, nom: 'Poissons', prix: 12.50, image: "./images/tilapia.jpg", description: "Poissons frais d'élevage durable", stock: 8 },
    { id: 8, nom: 'Poulets', prix: 15.00, image: "./images/volailes.jpg", description: "Poulets fermiers élevés au grain", stock: 5 },
    { id: 9, nom: 'Œufs', prix: 6.25, image: "./images/oeuf.jpg", description: "Œufs frais de nos poules élevées au sol", stock: 50 }
];

// Helper function to initialize cart
function initializeCart(req) {
    if (!req.session.basket) {
        req.session.basket = [];
    }
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
        cartCount: cartTotals.totalItems 
    });
});

app.get('/produits', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.render('produits', { 
        title: 'Nos Produits', 
        items: items,
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
        items: items,
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
    
    const item = items.find(i => i.id === productId);
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
app.post('/checkout', (req, res) => {
    const orderId = Date.now(); // Generate a simple order ID
    const { nom, email, telephone, adresse } = req.body;

    if (!nom || !email || !telephone || !adresse) {
        return res.redirect('/checkout');
    }

    // Create order object
    const order = {
        orderId: orderId,
        customerInfo: { nom, email, telephone, adresse },
        items: req.session.basket || [],
        total: req.session.total || 0
    };

    // Clear the cart
    req.session.basket = [];
    req.session.total = 0;

    // Redirect to confirmation page with order details
    res.render('confirmation', { 
        title: 'Confirmation de commande',
        order: order,
        orderId: orderId
    });
});

app.get('/confirmation/:orderId', (req, res) => {
    // In a real app, you would fetch the order details from your database
    const order = {
        orderId: req.params.orderId,
        items: req.session.basket || [],
        total: req.session.total || 0
    };
    
    // Clear the basket after successful order
    req.session.basket = [];
    req.session.total = 0;
    
    res.render('confirmation', { 
        title: 'Confirmation de commande',
        order: order,
        orderId: req.params.orderId
    });
});

// API endpoint for cart count (for AJAX updates)
app.get('/api/cart-count', (req, res) => {
    initializeCart(req);
    const cartTotals = calculateCartTotals(req.session.basket);
    res.json({ count: cartTotals.totalItems });
});

// Error handling middleware
app.use((err, req, res, next) => {
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
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // console.log('Available routes:');
    // console.log('- GET  / (home)');
    // console.log('- GET  /produits (products list)');
    // console.log('- GET  /histoire (our story)');
    // console.log('- GET  /acheter (shopping)');
    // console.log('- GET  /panier (cart)');
    // console.log('- GET  /checkout (checkout)');
    // console.log('- POST /panier/add (add to cart)');
    // console.log('- POST /panier/update (update cart)');
    // console.log('- POST /panier/remove (remove from cart)');
});