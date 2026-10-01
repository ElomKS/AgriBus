// ============ NOTIFICATIONS EMAIL (Brevo) ============
// L'API HTTP de Brevo est appelee directement avec fetch : aucune dependance
// supplementaire, et le jeton ne transite jamais dans une bibliothe tierce.
//
// Regles importantes :
// - un envoi qui echoue ne doit JAMAIS faire echouer une commande ;
// - les identifiants sont lus dans l'environnement, jamais codees en dur ;
// - sans configuration, l'envoi est desactive et l'application fonctionne
//   normalement (developpement local).

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const apiKey = process.env.BREVO_API_KEY || '';
const senderEmail = process.env.MAIL_FROM || '';
const senderName = process.env.MAIL_FROM_NAME || 'Kekeli Ferme';
const adminEmails = (process.env.ADMIN_EMAIL || '')
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean);

if (!apiKey) {
    console.warn('[MAIL] BREVO_API_KEY absent : notifications par email desactivees.');
} else if (adminEmails.length === 0) {
    console.warn('[MAIL] ADMIN_EMAIL absent : aucun destinataire pour les notifications de commande.');
} else {
    if (!senderEmail) {
        console.warn('[MAIL] MAIL_FROM absent : les emails ne pourront pas partir.');
    }
    console.log(`[MAIL] Notifications Brevo actives vers ${adminEmails.join(', ')}`);
}

// Echappement HTML : les donnees viennent d'un formulaire client, elles doivent
// etre echappees avant d'etre injectees dans le corps du message.
function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatCfa(amount) {
    return `${Number(amount).toLocaleString('fr-FR')} FCFA`;
}

function buildItemsTable(items) {
    const rows = items.map((item) => `
        <tr>
            <td style="padding:6px 10px;border-bottom:1px solid #eee">${escapeHtml(item.nom)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:center">${item.quantity}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatCfa(item.prix)}</td>
            <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${formatCfa(item.prix * item.quantity)}</td>
        </tr>`).join('');

    return `
        <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">
            <thead>
                <tr style="background:#f0f7f1">
                    <th align="left" style="padding:8px 10px">Produit</th>
                    <th align="center" style="padding:8px 10px">Qte</th>
                    <th align="right" style="padding:8px 10px">Prix</th>
                    <th align="right" style="padding:8px 10px">Total</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>`;
}

function orderSummaryHtml(order) {
    return `
        <p><strong>Reference :</strong> ${escapeHtml(order.reference)}</p>
        <p><strong>Client :</strong> ${escapeHtml(order.nom)}<br>
           <strong>Email :</strong> ${escapeHtml(order.email)}<br>
           <strong>Telephone :</strong> ${escapeHtml(order.telephone)}<br>
           <strong>Adresse :</strong> ${escapeHtml(order.adresse)}</p>
        <p><strong>Livraison :</strong> ${escapeHtml(order.delivery_method)} &nbsp;|&nbsp;
           <strong>Paiement :</strong> ${escapeHtml(order.payment_method)}</p>
        ${order.instructions ? `<p><strong>Instructions :</strong> ${escapeHtml(order.instructions)}</p>` : ''}
        ${buildItemsTable(order.items)}
        <p style="margin-top:12px"><strong>Sous-total :</strong> ${formatCfa(order.subtotal)}<br>
           <strong>Livraison (TVA) :</strong> ${formatCfa(order.tax)}<br>
           <strong>Total :</strong> ${formatCfa(order.total)}</p>`;
}

async function sendMail({ to, subject, html }) {
    if (!apiKey || !senderEmail || to.length === 0) {
        return { skipped: true };
    }

    const response = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': apiKey,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: { name: senderName, email: senderEmail },
            to: to.map((email) => ({ email })),
            subject,
            htmlContent: html
        })
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Brevo HTTP ${response.status}: ${body.slice(0, 300)}`);
    }

    return await response.json();
}

// Aucune de ces deux fonctions ne leve d'exception : l'appelant fait du
// fire-and-forget, la commande reste enregistree meme si le mail echoue.
async function attempt(label, payload) {
    try {
        const result = await sendMail(payload);
        if (result.skipped) {
            console.warn(`[MAIL] ${label} non envoye (configuration incomplete).`);
        } else {
            console.log(`[MAIL] ${label} envoye.`);
        }
    } catch (err) {
        console.error(`[MAIL] Echec ${label} : ${err.message}`);
    }
}

// Email a l'admin : une commande vient d'etre enregistree
export function notifyAdminNewOrder(order) {
    return attempt('notification admin', {
        to: adminEmails,
        subject: `Nouvelle commande ${order.reference} - ${formatCfa(order.total)}`,
        html: `
            <h2 style="font-family:Arial,sans-serif;color:#2e7d32">Nouvelle commande</h2>
            ${orderSummaryHtml(order)}`
    });
}

// Email de confirmation au client
export function notifyCustomerOrderConfirmation(order) {
    if (!order.email) {
        return Promise.resolve({ skipped: true });
    }
    return attempt('confirmation client', {
        to: [order.email],
        subject: `Commande ${order.reference} bien recue - Kekeli Ferme`,
        html: `
            <h2 style="font-family:Arial,sans-serif;color:#2e7d32">Merci pour votre commande</h2>
            <p>Bonjour ${escapeHtml(order.nom)},</p>
            <p>Nous avons bien recu votre commande. Voici son recapitulatif :</p>
            ${orderSummaryHtml(order)}
            <p>Nous vous contacterons pour convenir du paiement et de la livraison.</p>
            <p>A bientot,<br>${escapeHtml(senderName)}</p>`
    });
}