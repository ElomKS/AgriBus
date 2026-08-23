import { createUser } from '../db.js';

const [username, password, role] = process.argv.slice(2).filter(a => a !== '--');

if (!username || !password || !['admin', 'staff'].includes(role)) {
    console.error('Usage : npm run add-user -- <identifiant> <motDePasse> <admin|staff>');
    console.error('Exemple : npm run add-user -- admin MonMotDePasse123 admin');
    process.exit(1);
}

if (password.length < 8) {
    console.error('Mot de passe trop court : 8 caracteres minimum.');
    process.exit(1);
}

createUser(username, password, role);
console.log(`Compte ${role} "${username}" cree/mis a jour dans la base.`);
